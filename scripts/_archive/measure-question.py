#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
measure-question.py · 题目页专用倾斜测量
-----------------------------------------------------------------------------
题目页用 measure-skew3 的锐度法测不准 —— 选项只有 (A)(B)(C)(D) 四个短行，
行投影被切成很多碎段，二阶差分的峰值不在真实倾角上。
实测：2019-t2-question 原图锐度 8192 反而最高，但它确实歪 —— 指标失效。

改用直接几何法：只取图片下半部分的选项行（长且规整），
用最小二乘拟合每行左右两端的基线高度差，对角度非常敏感。
"""
import os, sys
import numpy as np
from PIL import Image

LIB = r"D:\WB工作记录\英语项目\英语真题阅读资料库\library"
INK = 170


def fit_line_slope(path, y_lo=0.55, y_hi=0.95):
    """在图片纵向 [y_lo, y_hi] 区间内，找文本行并拟合左右端高度差"""
    im = Image.open(path).convert("L")
    a = np.array(im)
    h, w = a.shape
    dark = a < INK
    rows = dark.sum(axis=1)
    thr = max(2, w * 0.0015)     # 题目页行短，阈值放低才能切出选项行

    # 切行（限制在指定纵向区间）
    lo, hi = int(h * y_lo), int(h * y_hi)
    seg_rows = rows[lo:hi]
    lines = []
    i = 0
    while i < len(seg_rows):
        if seg_rows[i] > thr:
            j = i
            while j < len(seg_rows) and seg_rows[j] > thr:
                j += 1
            if (j - i) >= 6:
                lines.append((lo + i, lo + j))
            i = j
        else:
            i += 1
    if len(lines) < 5:
        return None, 0, 0.0

    xs, ys = [], []
    for (t, b) in lines:
        seg = dark[t:b]
        cols = np.nonzero(seg.sum(axis=0) > 0)[0]
        if len(cols) < w * 0.35:      # 太短的（页码、"26."）跳过
            continue
        # 取左端 15% 和右端 15% 区域，比较两者的墨迹重心高度
        lw = max(4, int(w * 0.15))
        left_cols = cols[cols < w * 0.30]
        right_cols = cols[cols > w * 0.70]
        if len(left_cols) < 3 or len(right_cols) < 3:
            continue
        # 逐列求墨迹重心，再对两端求均值
        def centroid(c1, c2):
            sub = seg[:, c1:c2]
            rr = np.nonzero(sub.any(axis=1))[0]
            if len(rr) < 2:
                return None
            wt = sub.sum(axis=1)[rr]
            return float((rr * wt).sum() / wt.sum()) + t
        yl = centroid(0, int(w * 0.32))
        yr = centroid(int(w * 0.68), w)
        if yl is None or yr is None:
            continue
        xl, xr = left_cols.mean(), right_cols.mean()
        if xr - xl < w * 0.3:
            continue
        xs.extend([xl, xr])
        ys.extend([yl, yr])
    if len(xs) < 10:
        return None, len(lines), 0.0
    xs = np.array(xs, float)
    ys = np.array(ys, float)
    A = np.vstack([xs, np.ones_like(xs)]).T
    sol, *_ = np.linalg.lstsq(A, ys, rcond=None)
    resid = ys - A @ sol
    return np.degrees(np.arctan(sol[0])), len(lines), float(np.std(resid))


def main():
    years, rest = [], None
    for x in sys.argv[1:]:
        if x.isdigit():
            years.append(x)
        else:
            rest = x
    print(f"{'文件':<40}{'倾斜角°':>10}{'残差°':>9}{'行数':>6}  方向")
    print("-" * 84)
    for y in years:
        d = os.path.join(LIB, y)
        for f in sorted(os.listdir(d)):
            if not f.endswith("-question.png"):
                continue
            if rest and rest not in f:
                continue
            p = os.path.join(d, f)
            ang, n, res = fit_line_slope(p)
            if ang is None:
                print(f"{y}/{f:<32}  (选项行不足，无法拟合)")
                continue
            if abs(ang) < 0.06:
                dirn = "基本正"
            elif ang > 0:
                dirn = "顺时针歪 → 需逆时针校正"
            else:
                dirn = "逆时针歪 → 需顺时针校正"
            print(f"{y}/{f:<32}{ang:>10.3f}{res:>9.3f}{n:>6}  {dirn}")


if __name__ == "__main__":
    main()
