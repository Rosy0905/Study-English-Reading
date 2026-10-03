# -*- coding: utf-8 -*-
"""
probe-margins.py · 实测每张底稿图的上/下留白占比
她 2026-10-03 反馈 2024"上面太贴边、下面空太多"，2026"上下还略要加留白"。
先用数据说话，别凭印象乱调。
"""
import os, sys
import numpy as np
from PIL import Image

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库\library"


def margins(path):
    im = Image.open(path).convert("L")
    a = np.array(im)
    h, w = a.shape
    dark = (a < 200)
    rows = dark.sum(axis=1)
    nz = np.nonzero(rows > max(2, w * 0.002))[0]
    if len(nz) == 0:
        return None
    top, bot = nz[0], nz[-1]
    # 内容列范围（顺便看左右）
    cols = np.nonzero(dark.sum(axis=0) > max(2, h * 0.002))[0]
    return dict(h=h, w=w, top=top / h * 100, bot=(h - 1 - bot) / h * 100,
                left=cols[0] / w * 100, right=(w - 1 - cols[-1]) / w * 100)


def main():
    years = sys.argv[1:] or [str(y) for y in range(2010, 2027)]
    print(f"{'文件':<34}{'高':>6}{'宽':>6}{'上留白%':>9}{'下留白%':>9}{'左%':>7}{'右%':>7}")
    print("-" * 80)
    for y in years:
        d = os.path.join(ROOT, y)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".png"):
                continue
            m = margins(os.path.join(d, f))
            if not m:
                print(f"{f:<34}  (空白)")
                continue
            print(f"{f:<34}{m['h']:>6}{m['w']:>6}{m['top']:>9.2f}{m['bot']:>9.2f}"
                  f"{m['left']:>7.2f}{m['right']:>7.2f}")
        print()


if __name__ == "__main__":
    main()
