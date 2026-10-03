#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""skew-score.py · 列出各候选角度的文字锐度，客观评判哪个最"正"

锐度 = 行投影二阶差分绝对值和。文字行越平直，行边界越锐，值越大。
数值最高的那个角度就是最正的，肉眼不用纠结。
"""
import os, sys, importlib.util
import numpy as np
from PIL import Image

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
_spec = importlib.util.spec_from_file_location(
    "msk3", os.path.join(os.path.dirname(os.path.abspath(__file__)), "measure-skew3.py"))
_m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)
sharpness, INK = _m.sharpness, _m.INK


def score(im, ang):
    r = im if ang is None else im.rotate(ang, resample=Image.BILINEAR, fillcolor=255)
    return sharpness(np.array(r) < INK)


def main():
    rel = sys.argv[1]
    angs = [None] + [float(a) for a in sys.argv[2:]]
    p = os.path.join(ROOT, "library", rel + ".png")
    im = Image.open(p).convert("L")
    im = im.resize((im.width // 2, im.height // 2), Image.BILINEAR)
    res = []
    print(f"{'角度':<22}{'锐度':>10}")
    print("-" * 34)
    for a in angs:
        s = score(im, a)
        lab = "原图" if a is None else (f"逆时针 {a}°" if a > 0 else f"顺时针 {abs(a)}°")
        print(f"{lab:<22}{s:>10.0f}")
        res.append((s, lab))
    best = max(res)
    print("-" * 34)
    print(f"最正：{best[1]}（锐度 {best[0]:.0f}）")


if __name__ == "__main__":
    main()
