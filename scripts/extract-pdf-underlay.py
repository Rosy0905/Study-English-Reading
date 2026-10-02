#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract-pdf-underlay.py · 从无水印真题 PDF 提取笔记底稿（补齐单边篇目）
-------------------------------------------------------------------------
单边篇目（作者只更新了做题或复盘其中一边）之前没有 underlay，笔记页是空白纸。
复盘 html 里没有可提取的文章/题目原图，改用桌面的《真题及答案速查》PDF
（扫描版、无猫猫头水印）渲染对应页面作为底稿。

页面定位（2026-10-02 人工用缩略图网格逐一核对过）：
  2017-text4: 文章 p10, 题目 p11
  2018-text3: 文章 p8,  题目 p9
  2018-text4: 文章 p10, 题目 p11
  2021-text1: 文章 p4,  题目 p5
  2021-text3: 文章 p8,  题目 p9
  2024-text3: 文章 p8,  题目 p9
"""
import os, re, sys
import pymupdf
from PIL import Image

PDFDIR = r"D:/Desktop/English·盐/真题及答案速查（2001-2026）电子试题"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JOBS = [
    (2017, 4, 10, 11),
    (2018, 3, 8, 9),
    (2018, 4, 10, 11),
    (2021, 1, 4, 5),
    (2021, 3, 8, 9),
    (2024, 3, 8, 9),
]
CROP_TOP = 0.03      # 裁掉顶部 3%（浅灰公众号广告）
TARGET_W = 1760      # 输出宽度（长边约 2593，正好在 make-imgdata 的 2600 上限内）


def render(doc, pno):
    pix = doc[pno - 1].get_pixmap(dpi=200)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    h = img.height
    img = img.crop((0, int(h * CROP_TOP), img.width, h))
    img = img.resize((TARGET_W, round(img.height * TARGET_W / img.width)), Image.LANCZOS)
    return img


def update_manifest(year, text_no):
    """给仅复盘条目补 underlay + labels（幂等：已有 underlay 就跳过）"""
    mf = os.path.join(ROOT, "manifest.js")
    src = open(mf, encoding="utf-8").read()
    pid = f"{year}-text{text_no}"
    m = re.search(r'id:\s*"%s"' % re.escape(pid), src)
    if not m:
        print(f"  ! manifest 里找不到 {pid}"); return
    note_re = re.compile(r'note:\s*"notes\.html\?id=%s",\s*\n' % re.escape(pid))
    note_m = note_re.search(src, m.start())
    if not note_m:
        print(f"  ! {pid} 没找到 note 行"); return
    # underlay 只可能紧跟在本条目 note 行之后（insert_at），用它精确判断幂等
    if re.match(r'\s*underlay', src[note_m.end():note_m.end() + 30]):
        print(f"  {pid} 已有 underlay，跳过"); return
    insert_at = note_m.end()
    underlay = (
        f'      underlay: [\n'
        f'        "library/{year}/{pid}-article.png",\n'
        f'        "library/{year}/{pid}-question.png"\n'
        '      ],\n'
        '      labels: ["文章页", "题目页"]\n'
    )
    new_src = src[:insert_at] + underlay + src[insert_at:]
    open(mf, "w", encoding="utf-8").write(new_src)
    print(f"  manifest: {pid} 已补 underlay")


def main():
    cache = {}
    for year, text_no, a_page, q_page in JOBS:
        pid = f"{year}-text{text_no}"
        print(f"提取 {pid} …")
        if year not in cache:
            cache[year] = pymupdf.open(os.path.join(PDFDIR, f"{year}年真题及答案速查.pdf"))
        doc = cache[year]
        ydir = os.path.join(ROOT, "library", str(year))
        os.makedirs(ydir, exist_ok=True)
        for slot, pno in (("article", a_page), ("question", q_page)):
            img = render(doc, pno)
            path = os.path.join(ydir, f"{pid}-{slot}.png")
            img.save(path, optimize=True)
            print(f"  {slot}: p{pno} -> {path}（{img.width}x{img.height}）")
        update_manifest(year, text_no)
    for d in cache.values():
        d.close()
    print("全部完成！记得跑 make-imgdata.py 重新打包数据包")


if __name__ == "__main__":
    main()
