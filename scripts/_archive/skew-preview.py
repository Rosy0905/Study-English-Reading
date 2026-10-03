#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
skew-preview.py · 生成 2019 t3 文章页的旋转对比图
-----------------------------------------------------------------------------
她 2026-10-03 说要顺时针 0.2°，但实测该图是顺时针歪 0.65°（顺时针只会更歪）。
不猜，出一排对比图让她自己挑：原图 / 逆时针 0.4° / 逆时针 0.5° / 顺时针 0.2°。
同时把 2019 t2 题目页的累计角度（逆时针 0.3 + 顺时针 0.2 = 逆时针 0.5）也出图。
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
LIB = os.path.join(ROOT, "library")
OUT = os.path.join(ROOT, ".probe")
os.makedirs(OUT, exist_ok=True)


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


def sheet(name, variants, tw=430):
    """variants: [(标签, PIL角度或None)]，None = 原图"""
    im = Image.open(os.path.join(LIB, name + ".png"))
    th = round(im.height * tw / im.width)
    n = len(variants)
    img_h = th + 46
    out = Image.new("RGB", (tw * n, img_h), (245, 245, 245))
    d = ImageDraw.Draw(out)
    for i, (lab, ang) in enumerate(variants):
        x = i * tw
        if ang is None:
            tile = im
        else:
            tile = recenter(im.rotate(ang, resample=Image.BICUBIC,
                                      fillcolor=(255, 255, 255), expand=False), im)
        out.paste(tile.resize((tw, th), Image.LANCZOS), (x, 46))
        d.text((x + 8, 16), lab, fill=(15, 15, 15))
        d.line([(x, 0), (x, img_h)], fill=(205, 205, 205))
    fp = os.path.join(OUT, "skewcmp_" + name.replace("/", "_") + ".png")
    out.save(fp)
    print(fp)


def main():
    # t3 文章页：她要顺时针 0.2，实测需逆时针才能扶正 —— 四个选项并排
    sheet("2019/2019-text3-article", [
        ("原图（顺时针歪 0.65°）", None),
        ("逆时针 0.4°", 0.4),
        ("逆时针 0.5°", 0.5),
        ("顺时针 0.2°（你原话）", -0.2),
    ])
    # t2 题目页：现有逆时针 0.3，再顺时针 0.2 = 累计逆时针 0.5
    sheet("2019/2019-text2-question", [
        ("原图（逆时针歪 0.39°）", None),
        ("累计逆时针 0.5°（你要求的）", 0.5),
        ("累计逆时针 0.4°", 0.4),
    ])


if __name__ == "__main__":
    main()
