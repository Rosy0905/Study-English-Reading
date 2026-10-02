#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预览指定页并拼图：python pdf_preview.py year:p1,p2 ... 输出到 temp"""
import sys, os
import pymupdf
from PIL import Image, ImageDraw

PDFDIR = r"D:/Desktop/English·盐/真题及答案速查（2001-2026）电子试题"
JOBS = {
    "2017": [(10, "2017t4文章"), (11, "2017t4题目")],
    "2018": [(8, "2018t3文章"), (9, "2018t3题目"), (10, "2018t4文章"), (11, "2018t4题目")],
    "2021": [(4, "2021t1文章"), (5, "2021t1题目"), (8, "2021t3文章"), (9, "2021t3题目")],
    "2024": [(8, "2024t3文章"), (9, "2024t3题目")],
}

def main():
    tw = 520
    cells = []
    for year, pages in JOBS.items():
        doc = pymupdf.open(os.path.join(PDFDIR, f"{year}年真题及答案速查.pdf"))
        for pno, tag in pages:
            pix = doc[pno - 1].get_pixmap(dpi=100)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            img = img.resize((tw, round(img.height * tw / img.width)), Image.LANCZOS)
            cells.append((img, f"{tag} p{pno}"))
            if len(cells) >= 12:
                break
        doc.close()
    th = cells[0][0].height
    cols = 4
    rows = (len(cells) + cols - 1) // cols
    grid = Image.new("RGB", (cols * (tw + 8) + 8, rows * (th + 30) + 8), "#cccccc")
    draw = ImageDraw.Draw(grid)
    for i, (img, tag) in enumerate(cells):
        r, c = divmod(i, cols)
        x = 8 + c * (tw + 8)
        y = 8 + r * (th + 30)
        draw.text((x, y + 2), tag, fill="black")
        grid.paste(img, (x, y + 18))
    out = os.path.join(os.environ.get("TEMP", "/tmp"), "pdf_pages_preview.png")
    grid.save(out)
    print(out, grid.size)

if __name__ == "__main__":
    main()
