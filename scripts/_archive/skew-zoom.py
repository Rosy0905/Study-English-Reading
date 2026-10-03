#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
skew-zoom.py · 旋转效果特写对比（放大文字行，差异才看得出来）
-----------------------------------------------------------------------------
0.5° 在整页预览里几乎看不出（上次就因为这个她无法判断）。
这里裁出图中间 260px 高的一条，放大 2.6 倍并排，几行字的倾斜立刻分明。
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
LIB = os.path.join(ROOT, "library")
OUT = os.path.join(ROOT, ".probe")
os.makedirs(OUT, exist_ok=True)

# 裁中间一条，避开页眉页脚
BAND_H = 300
ZOOM = 2.4


def recenter(rot, orig):
    a = np.array(rot.convert("L"))
    mask = a < 200
    if not mask.any():
        return rot
    rows = np.nonzero(mask.any(axis=1))[0]
    cols = np.nonzero(mask.any(axis=0))[0]
    oc = np.array(orig.convert("L")) < 200
    orows = np.nonzero(oc.any(axis=1))[0]
    ocols = np.nonzero(oc.any(axis=0))[0]
    dy = (orows[0] + orows[-1]) // 2 - (rows[0] + rows[-1]) // 2
    dx = (ocols[0] + ocols[-1]) // 2 - (cols[0] + cols[-1]) // 2
    out = Image.new("RGB", orig.size, (255, 255, 255))
    out.paste(rot, (dx, dy))
    return out


def build(rel, variants, tag):
    im = Image.open(os.path.join(LIB, rel + ".png"))
    y0 = (im.height - BAND_H) // 2
    tw = 300
    th = round(BAND_H * tw / im.width * ZOOM / 2.4 * 1.0) * 1  # 占位
    tiles = []
    for lab, ang in variants:
        src = im if ang is None else recenter(
            im.rotate(ang, resample=Image.BICUBIC, fillcolor=(255, 255, 255), expand=False), im)
        band = src.crop((0, y0, src.width, y0 + BAND_H))
        # 只取中段 70% 宽度，放大
        bw = int(band.width * 0.72)
        bx = (band.width - bw) // 2
        band = band.crop((bx, 0, bx + bw, BAND_H))
        tile = band.resize((int(bw * ZOOM), int(BAND_H * ZOOM)), Image.LANCZOS)
        tiles.append((lab, tile))
    W = max(t.width for _, t in tiles) + 20
    H = sum(t.height + 40 for _, t in tiles) + 20
    out = Image.new("RGB", (W, H), (250, 250, 250))
    d = ImageDraw.Draw(out)
    y = 10
    for lab, t in tiles:
        d.text((12, y), lab, fill=(10, 10, 10))
        out.paste(t, (10, y + 22))
        y += t.height + 40
    fp = os.path.join(OUT, f"zoom_{tag}.png")
    out.save(fp)
    print(fp)


def main():
    build("2019/2019-text3-article", [
        ("① 原图 —— 实测顺时针歪 0.65°", None),
        ("② 逆时针 0.4°（PIL +0.4）", 0.4),
        ("③ 逆时针 0.5°（PIL +0.5）", 0.5),
        ("④ 顺时针 0.2°（你原话，PIL -0.2）", -0.2),
    ], "t3-article")


if __name__ == "__main__":
    main()
