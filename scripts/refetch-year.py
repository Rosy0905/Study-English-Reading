#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
refetch-year.py · 指定年份从 PDF 重新提取底稿（不动 manifest）
-----------------------------------------------------------------------------
她 2026-10-03 反馈 2024 又坏了：上面太贴边、下面空太多。
实测确认（probe-margins.py）：2024 上留白仅 1.4-2.1%、下留白 9.8-10.6%，
而 2016-2023 正常值是上 3.0-3.9% / 下 5.1-6.2%。2024 当初跳过了 normalize-margins。

做法：从 PDF 重新渲染该年 4 篇，然后跑 normalize-margins 精修。
2026 的 PDF 是另一套 15 页高清文字版，由 extract-2026-underlay.py 处理。
"""
import os, sys
import pymupdf
from PIL import Image

PDFDIR = r"D:/Desktop/English·盐/真题及答案速查（2001-2026）电子试题"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (text_no, 文章页页码, 题目页页码) —— 全年份统一：p4/p5, p6/p7, p8/p9, p10/p11
PAGES = [(1, 4, 5), (2, 6, 7), (3, 8, 9), (4, 10, 11)]

CROP_TOP = 0.045     # 裁掉顶部浅灰广告行；精修交给 normalize-margins
TARGET_W = 1760
DRY = "--dry" in sys.argv


def find_pdf(year):
    import glob, re as _re
    exact = os.path.join(PDFDIR, f"{year}年真题及答案速查.pdf")
    if os.path.exists(exact):
        return exact
    cands = glob.glob(os.path.join(PDFDIR, f"{year}年真题及答案速查*.pdf"))
    if not cands:
        raise FileNotFoundError(f"找不到 {year} 的 PDF")
    cands.sort(key=lambda p: (_re.sub(r'^\D+', '', os.path.basename(p)[len(str(year)):]) or '0'))
    return cands[0]


def main():
    years = [int(a) for a in sys.argv[1:] if a.isdigit()]
    for year in years:
        pdf = find_pdf(year)
        doc = pymupdf.open(pdf)
        print(f"\n=== {year} ({os.path.basename(pdf)}) ===")
        ydir = os.path.join(ROOT, "library", str(year))
        os.makedirs(ydir, exist_ok=True)
        for text_no, a_page, q_page in PAGES:
            pid = f"{year}-text{text_no}"
            for slot, pno in (("article", a_page), ("question", q_page)):
                pix = doc[pno - 1].get_pixmap(dpi=200)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                h = img.height
                img = img.crop((0, int(h * CROP_TOP), img.width, h))
                img = img.resize((TARGET_W, round(img.height * TARGET_W / img.width)),
                                 Image.LANCZOS)
                path = os.path.join(ydir, f"{pid}-{slot}.png")
                if DRY:
                    print(f"  [dry] {pid}-{slot}.png  {img.width}x{img.height}")
                else:
                    img.save(path, optimize=True)
                    print(f"  写入 {pid}-{slot}.png  {img.width}x{img.height}")
        doc.close()
    print("\n完成。下一步跑 normalize-margins.py 精修留白，再 make-imgdata.py 打包。")


if __name__ == "__main__":
    main()
