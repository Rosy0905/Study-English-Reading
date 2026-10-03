#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
measure-skew.py · 测量底稿图的文字行倾斜角
-----------------------------------------------------------------------------
她 2026-10-03 要求 2019t2 题目页"再多转 0.2°"、2019t3 文章页"顺时针 0.2°"。
上次批量自动纠偏方向搞反被骂，所以这里只做一件事：客观量出每张图
文字基线的倾斜角，用数字说话，方向和角度仍由她确认。

算法：
  1. 二值化 → 行投影切出文本行
  2. 每行取该行墨点的 x 范围中位数位置与行中心 y
  3. 最小二乘拟合 y = a·x + b，角度 = atan(a)
坐标 y 向下，所以 a > 0 表示"向右下倾斜" = 视觉上的顺时针。
注意：PIL 的 im.rotate() 正值是逆时针，与这里的符号相反。
"""
import os, sys
import numpy as np
from PIL import Image

LIB = r"D:\WB工作记录\英语项目\英语真题阅读资料库\library"
INK = 160          # 比正文更深的墨才算文字（排除浅灰底纹/水印）
MIN_ROW_PX = 6     # 一行至少 6 像素高
MIN_LINE_H = 8


def measure(path):
    im = Image.open(path).convert("L")
    a = np.array(im)
    h, w = a.shape
    dark = a < INK
    rows = dark.sum(axis=1)
    # 切出连续文本行
    lines = []
    i = 0
    thr = max(3, w * 0.004)
    while i < h:
        if rows[i] > thr:
            j = i
            while j < h and rows[j] > thr:
                j += 1
            if (j - i) >= MIN_LINE_H:
                lines.append((i, j))
            i = j
        else:
            i += 1
    if len(lines) < 8:
        return None
    xs, ys = [], []
    for (t, b) in lines:
        seg = dark[t:b]
        cols = np.nonzero(seg.sum(axis=0) > 0)[0]
        if len(cols) < w * 0.15:      # 太窄的（页码/单字）不参与
            continue
        # 用墨点重心拟合更稳：分左右两半，比较两半的质心高度
        mid = w // 2
        left = np.nonzero(seg[:, :mid].any(axis=0))[0]
        right = np.nonzero(seg[:, mid:].any(axis=0))[0] + mid
        if len(left) < 5 or len(right) < 5:
            continue
        yl = t + seg[:, :mid].mean()
        yr = t + seg[:, mid:].mean()
        xl, xr = left.mean(), right.mean()
        if xr - xl < w * 0.3:
            continue
        xs.extend([xl, xr])
        ys.extend([yl, yr])
    if len(xs) < 16:
        return None
    xs = np.array(xs, dtype=float)
    ys = np.array(ys, dtype=float)
    A = np.vstack([xs, np.ones_like(xs)]).T
    sol, *_ = np.linalg.lstsq(A, ys, rcond=None)
    slope = sol[0]
    resid = ys - A @ sol
    return np.degrees(np.arctan(slope)), np.degrees(np.std(resid)), len(lines)


def main():
    targets = []
    for a in sys.argv[1:]:
        if "-" in a and a.split("-")[0].isdigit():
            y, rest = a.split("-", 1)
            targets.append((y, rest))
        else:
            targets.append((a, None))
    print(f"{'文件':<40}{'倾斜角°':>9}{'残差°':>8}{'行数':>6}  方向")
    print("-" * 82)
    for year, rest in targets:
        d = os.path.join(LIB, year)
        for f in sorted(os.listdir(d)):
            if not f.endswith(".png"):
                continue
            if rest and rest not in f:
                continue
            p = os.path.join(d, f)
            r = measure(p)
            if not r:
                print(f"{year}/{f:<32}  (行数不足，无法拟合)")
                continue
            ang, res, n = r
            if abs(ang) < 0.03:
                dirn = "基本水平"
            elif ang > 0:
                dirn = "顺时针歪（需逆时针校正）"
            else:
                dirn = "逆时针歪（需顺时针校正）"
            print(f"{year}/{f:<32}{ang:>9.3f}{res:>8.3f}{n:>6}  {dirn}")


if __name__ == "__main__":
    main()
