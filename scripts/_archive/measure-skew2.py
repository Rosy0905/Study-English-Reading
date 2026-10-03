#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
measure-skew2.py · 投影方差法测倾斜角（比 measure-skew.py 稳得多）
-----------------------------------------------------------------------------
第一版用"左右半区墨点质心"拟合，残差高达 35-67°，完全不可信 —— 因为
题目页的选项字母(A)(B)、页码、图表会严重干扰。弃用。

第二版用投影方差法（业界标准做法）：
  1. 二值化
  2. 对每个候选角度 θ ∈ [-1.5°, +1.5°]（步长 0.01°）：
       把图按 θ 旋转 → 重新行投影 → 计算行内空白/墨迹的方差
  3. 方差最大（行最平直、界限最清晰）的 θ 即最佳角度
  4. 用细步长在峰值附近再精修一次

输出的是"应施加的校正角"，正值 = 需顺时针转（与 PIL rotate 正值一致）。
不自动写入，只报数让她确认。
"""
import os, sys
import numpy as np
from PIL import Image

LIB = r"D:\WB工作记录\英语项目\英语真题阅读资料库\library"
INK = 170
COARSE = 0.05       # 粗扫步长
FINE = 0.01         # 精修步长
RANGE = 1.5


def score(dark, theta):
    """把二值图按 theta(度, 正=顺时针) 反向补偿旋转，返回行投影的锐度"""
    h, w = dark.shape
    a = np.deg2rad(theta)
    # 旋转后 y' = y·cosθ - (x-cx)·sinθ  —— 用坐标变换做 shear，比真旋转快很多
    yy = np.arange(h, dtype=np.float32)[:, None]
    xx = np.arange(w, dtype=np.float32)[None, :]
    # 对每个输出行，取对应的源行
    proj = np.zeros(h, dtype=np.float64)
    cy = h / 2.0
    # 只在文本行附近累加：用 8 行一组的粗投影
    rowsum_src = dark.sum(axis=1).astype(np.float32)
    for oy in range(h):
        sy = oy * np.cos(np.deg2rad(theta)) + 0  # 简化：仅做垂直方向的错切
        syi = int(round(sy))
        if 0 <= syi < h:
            proj[oy] = rowsum_src[syi]
    # 锐度 = 一阶差分的平方和（行边界清晰时大）
    d = np.diff(proj)
    return float((d * d).sum())


def best_angle(path):
    im = Image.open(path).convert("L")
    dark = np.array(im) < INK
    h, w = dark.shape
    # 降采样加速，尺寸太大时 4x 下采
    step = 4
    small = dark[::step, ::step]
    sh, sw = small.shape
    rowsum = small.sum(axis=1).astype(np.float64)
    nz = np.nonzero(rowsum > sw * 0.004)[0]
    if len(nz) < 10:
        return None
    t0, b0 = nz[0], nz[-1]
    rowsum = rowsum[t0:b0 + 1]

    def sc(theta):
        # 垂直错切：proj[oy] = rowsum[oy - shift]，shift 随 oy 线性变化
        idx = np.arange(len(rowsum)) - np.arange(len(rowsum)) * np.tan(np.deg2rad(theta))
        i0 = np.floor(idx).astype(int)
        frac = idx - i0
        valid = (i0 >= 0) & (i0 < len(rowsum) - 1)
        if valid.sum() < 10:
            return -1
        v = rowsum[i0[valid]] * (1 - frac[valid]) + rowsum[i0[valid] + 1] * frac[valid]
        d = np.diff(v)
        return float((d * d).sum())

    # 粗扫
    ths = np.arange(-RANGE, RANGE + 1e-9, COARSE)
    scores = [sc(t) for t in ths]
    bi = int(np.argmax(scores))
    lo, hi = ths[max(0, bi - 2)], ths[min(len(ths) - 1, bi + 2)]
    # 精修
    ths2 = np.arange(lo, hi + 1e-9, FINE)
    s2 = [sc(t) for t in ths2]
    bj = int(np.argmax(s2))
    return ths2[bj], sh, sw


def main():
    years = []
    rest = None
    for a in sys.argv[1:]:
        if a.isdigit():
            years.append(a)
        else:
            rest = a
    print(f"{'文件':<40}{'校正角°':>9}  说明")
    print("-" * 78)
    for y in years:
        d = os.path.join(LIB, y)
        for f in sorted(os.listdir(d)):
            if not f.endswith(".png"):
                continue
            if rest and rest not in f:
                continue
            r = best_angle(os.path.join(d, f))
            if not r:
                print(f"{y}/{f:<32}  (文本行不足)")
                continue
            ang, sh, sw = r
            if abs(ang) < 0.02:
                note = "基本正"
            elif ang > 0:
                note = f"需顺时针 {ang:.2f}°"
            else:
                note = f"需逆时针 {abs(ang):.2f}°"
            print(f"{y}/{f:<32}{ang:>9.2f}  {note}")


if __name__ == "__main__":
    main()
