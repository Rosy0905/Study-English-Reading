#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pdf_thumbs.py · 把 PDF 每页渲染成缩略图并拼成网格图（带页码角标），用于人工定位页码"""
import sys, os, math
import pymupdf
from PIL import Image, ImageDraw

def main(pdf_path, out_path, cols=4, tw=360):
    doc = pymupdf.open(pdf_path)
    n = len(doc)
    rows = math.ceil(n / cols)
    th = int(tw * 297 / 210)  # A4 比例
    cell_h = th + 28
    grid = Image.new("RGB", (cols * (tw + 10) + 10, rows * cell_h + 10), "#dddddd")
    draw = ImageDraw.Draw(grid)
    for i in range(n):
        pix = doc[i].get_pixmap(dpi=50)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        img.thumbnail((tw, th))
        r, c = divmod(i, cols)
        x = 10 + c * (tw + 10)
        y = 10 + r * cell_h
        grid.paste(img, (x, y + 24))
        draw.rectangle([x, y + 4, x + 46, y + 22], fill="#c2185b")
        draw.text((x + 6, y + 6), f"p{i+1}", fill="white")
        draw.rectangle([x, y + 24, x + img.width - 1, y + 24 + img.height - 1], outline="#999999")
    grid.save(out_path)
    print(f"{n} pages -> {out_path}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 4)
