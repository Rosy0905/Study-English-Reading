#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
measure-skew3.py · 直接旋转搜索法（最终版，前面两版都弃用）
-----------------------------------------------------------------------------
measure-skew.py  ：质心拟合，残差 35-67°，题目页直接拟合失败 → 弃用
measure-skew2.py ：shear 近似 + 粗步长 0.05，结果全被压成 0.00 → 弃用
本版：真的把图旋转一点点，找行投影二阶差分（行边界最锐）时的角度。
      直接、无近似、结果可复现。慢一点但每张 1-2 秒，136 张也就几分钟。
"""
import os, sys
import numpy as np
from PIL import Image

LIB = r"D:\WB工作记录\英语项目\英语真题阅读资料库\library"
INK = 170
STEP = 0.02        # 扫描步长
RANGE = 1.0        # 扫描范围 ±1°（她只要零点几度，够了）


def sharpness(dark):
    """行投影的二阶差分绝对值和 —— 行界越锐，值越大"""
    rows = dark.sum(axis=1).astype(np.float64)
    if len(rows) < 3:
        return 0.0
    d2 = np.abs(np.diff(rows, 2))
    return float(d2.sum())


def scan(im, rmin=-RANGE, rmax=RANGE, step=STEP):
    """返回 (最佳旋转角, 锐度列表)"""
    ths = np.arange(rmin, rmax + 1e-9, step)
    scores = []
    for t in ths:
        rot = im.rotate(t, resample=Image.BILINEAR, fillcolor=255)
        d = np.array(rot) < INK
        scores.append(sharpness(d))
    return ths, scores


def best(path, verbose=False):
    im = Image.open(path).convert("L")
    # 下采样一半，加速 4 倍，对 0.02° 精度完全够
    im = im.resize((im.width // 2, im.height // 2), Image.BILINEAR)
    ths, scores = scan(im)
    bi = int(np.argmax(scores))
    t0 = ths[bi]
    # 峰附近精修 ±2 步
    ths2 = np.arange(t0 - 2 * STEP, t0 + 2 * STEP + 1e-9, STEP / 2)
    s2 = []
    for t in ths2:
        rot = im.rotate(t, resample=Image.BILINEAR, fillcolor=255)
        s2.append(sharpness(np.array(rot) < INK))
    t_best = ths2[int(np.argmax(s2))]
    return t_best, ths, scores, bi


def main():
    years, rest = [], None
    for a in sys.argv[1:]:
        if a.isdigit():
            years.append(a)
        else:
            rest = a
    print(f"{'文件':<40}{'最佳角°':>9}{'锐度':>12}  说明")
    print("-" * 82)
    for y in years:
        d = os.path.join(LIB, y)
        for f in sorted(os.listdir(d)):
            if not f.endswith(".png"):
                continue
            if rest and rest not in f:
                continue
            p = os.path.join(d, f)
            t, ths, scores, bi = best(p)
            peak = max(scores)
            mean = sum(scores) / len(scores)
            # 峰是否明显：峰/均值 > 1.02 才算可信
            sharp_ratio = peak / mean if mean else 1
            if sharp_ratio < 1.005:
                note = f"峰不锐({sharp_ratio:.3f}) 结果不可信"
            elif abs(t) < 0.03:
                note = "基本正"
            elif t > 0:
                note = f"顺时针 {t:.2f}° 最锐 → 需逆时针 {t:.2f}° 校正"
            else:
                note = f"逆时针 {abs(t):.2f}° 最锐 → 需顺时针 {abs(t):.2f}° 校正"
            print(f"{y}/{f:<32}{t:>9.2f}{peak:>12.0f}  {note}")


if __name__ == "__main__":
    main()
