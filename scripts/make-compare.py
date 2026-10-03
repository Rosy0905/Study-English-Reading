#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-compare.py · 并排对比图，用于肉眼核对留白/旋转效果"""
import os, sys
from PIL import Image, ImageDraw

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
LIB = os.path.join(ROOT, "library")
OUT = os.path.join(ROOT, ".probe")
os.makedirs(OUT, exist_ok=True)


def main():
    # 参数：年份 场次A 场次B ...  场次用 年-textN-kind
    year = sys.argv[1]
    slots = sys.argv[2:]
    imgs = [(s, Image.open(os.path.join(LIB, year, f"{s}.png"))) for s in slots]
    tw = 380
    th = max(round(im.height * tw / im.width) for _, im in imgs)
    sheet = Image.new("RGB", (tw * len(imgs) + 20, th + 40), (240, 240, 240))
    d = ImageDraw.Draw(sheet)
    for i, (s, im) in enumerate(imgs):
        x = 10 + i * tw
        sheet.paste(im.resize((tw, round(im.height * tw / im.width)), Image.LANCZOS), (x, 40))
        d.text((x + 6, 14), f"{s}  {im.width}x{im.height}", fill=(10, 10, 10))
        d.line([(x, 0), (x, 40 + th)], fill=(200, 200, 200))
    fp = os.path.join(OUT, f"cmp_{year}.png")
    sheet.save(fp)
    print(fp)


if __name__ == "__main__":
    main()
