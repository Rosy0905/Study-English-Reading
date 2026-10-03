# -*- coding: utf-8 -*-
"""用缩略图网格核对每年的 Text1-4 文章页/题目页边界（16页扫描版年份）"""
import sys, os, math
import pymupdf
from PIL import Image, ImageDraw

PDFDIR = r"D:/Desktop/English·盐/真题及答案速查（2001-2026）电子试题"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def grid(year, pages, out, cols=4, tw=430):
    doc = pymupdf.open(os.path.join(PDFDIR, f"{year}年真题及答案速查.pdf"))
    rows = math.ceil(len(pages)/cols)
    th = int(tw*297/210)
    cell_h = th+28
    g = Image.new("RGB", (cols*(tw+10)+10, rows*cell_h+10), "#dddddd")
    d = ImageDraw.Draw(g)
    for i, p in enumerate(pages):
        pix = doc[p-1].get_pixmap(dpi=60)
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        im.thumbnail((tw, th))
        r, c = divmod(i, cols)
        x = 10+c*(tw+10); y = 10+r*cell_h
        g.paste(im, (x, y+24))
        d.rectangle([x, y+4, x+52, y+22], fill="#c2185b")
        d.text((x+6, y+6), f"p{p}", fill="white")
    g.save(out)
    print(f"{year} {pages} -> {out}")

if __name__ == "__main__":
    y = int(sys.argv[1])
    pages = [int(x) for x in sys.argv[2].split(',')]
    out = os.path.join(ROOT, ".probe", f"{y}_sel.png")
    grid(y, pages, out)
