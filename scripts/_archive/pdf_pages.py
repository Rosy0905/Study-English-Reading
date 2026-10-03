# -*- coding: utf-8 -*-
"""渲染指定页为中等尺寸图，供人工核对内容"""
import sys, os
import pymupdf
from PIL import Image

pdf = sys.argv[1]
pages = [int(x) for x in sys.argv[2].split(',')]
out = sys.argv[3]
doc = pymupdf.open(pdf)
imgs = []
for p in pages:
    pix = doc[p-1].get_pixmap(dpi=100)
    imgs.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
w = max(i.width for i in imgs)
h = sum(i.height for i in imgs) + 8*(len(imgs)-1)
canvas = Image.new("RGB", (w, h), "#cccccc")
y = 0
for im in imgs:
    canvas.paste(im, (0, y)); y += im.height + 8
canvas.save(out)
print(f"pages {pages} -> {out}  size={canvas.size}")
