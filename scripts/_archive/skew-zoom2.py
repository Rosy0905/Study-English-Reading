#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""skew-zoom2.py · t3 文章页旋转对比（带锐度数字 + 参考水平线）

上一版只有文字没有数字，这次每段标题直接写上该角度的锐度值，
并画一条水平参考线，方便你判断文字行是否贴合水平。
"""
import os, sys, importlib.util
import numpy as np
from PIL import Image, ImageDraw

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
LIB = os.path.join(ROOT, "library")
OUT = os.path.join(ROOT, ".probe")
os.makedirs(OUT, exist_ok=True)

_spec = importlib.util.spec_from_file_location(
    "msk3", os.path.join(os.path.dirname(os.path.abspath(__file__)), "measure-skew3.py"))
_m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)
sharpness, INK = _m.sharpness, _m.INK

BAND_H = 300
ZOOM = 2.4
BAND_Y = 0.55     # 取图 55% 高度处的一条，避开标题和页脚


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


def main():
    rel = sys.argv[1] if len(sys.argv) > 1 else "2019/2019-text3-article"
    tag = rel.split("/")[-1]
    angles = [float(x) for x in sys.argv[2:]] or [0.5, 0.65, -0.2]
    band_y = 0.55
    im = Image.open(os.path.join(LIB, rel + ".png"))
    half = im.resize((im.width // 2, im.height // 2), Image.BILINEAR)

    variants = [("原图", None)] + [
        (f"逆时针 {a}°" if a > 0 else f"顺时针 {abs(a)}°", a) for a in angles]
    y0 = int(im.height * band_y) - BAND_H // 2
    y0 = max(0, min(im.height - BAND_H, y0))
    bw = int(im.width * 0.78)
    bx = (im.width - bw) // 2

    tiles = []
    for lab, ang in variants:
        src = im if ang is None else recenter(
            im.rotate(ang, resample=Image.BICUBIC, fillcolor=(255, 255, 255), expand=False), im)
        r = half if ang is None else half.rotate(ang, resample=Image.BILINEAR, fillcolor=255)
        sc = sharpness(np.array(r) < INK)
        band = src.crop((bx, y0, bx + bw, y0 + BAND_H))
        tile = band.resize((int(bw * ZOOM), int(BAND_H * ZOOM)), Image.LANCZOS)
        tiles.append((f"{lab}    锐度 {sc:.0f}", tile))

    pad = 14
    lab_h = 52
    try:
        from PIL import ImageFont
        font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 26)
    except Exception:
        font = ImageFont.load_default()
    W = max(t.width for _, t in tiles) + pad * 2
    H = sum(t.height + lab_h + 16 for _, t in tiles) + pad
    out = Image.new("RGB", (W, H), (248, 248, 250))
    d = ImageDraw.Draw(out)
    y = pad
    for lab, t in tiles:
        d.text((pad + 4, y + 10), lab, fill=(15, 15, 15), font=font)
        top = y + lab_h
        out.paste(t, (pad, top))
        # 在图上叠一条水平参考线（穿过文字行中部），看倾斜
        d.line([(pad, top + t.height * 0.5), (pad + t.width, top + t.height * 0.5)],
               fill=(255, 90, 90), width=2)
        y = top + t.height + 16
    fp = os.path.join(OUT, f"zoom_{tag}.png")
    out.save(fp)
    print(fp)


if __name__ == "__main__":
    main()
