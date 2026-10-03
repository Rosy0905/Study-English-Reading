#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract-2026-underlay.py · 2026 年真题笔记底稿
-----------------------------------------------------------------------------
【2026-10-03 改版】换用她提供的「2026年考研英语一真题【高清文字版】.pdf」。

原来源（真题及答案速查里的 2026）是 10 页紧凑扫描版，文章与题目跨页混排、
还得按坐标裁剪拼接，她反馈"内容歪七八扭"。新文件是 15 页 A4 文字版，
每篇文章、每组题目各占独立整页，排版端正规矩，页码规律与标准年份一致：

  Text1 p4  / p5      Text2 p6  / p7
  Text3 p8  / p9      Text4 p10 / p11
  （p1 Section I 正文、p2 Section I 答案、p3 Section II 开头、p12+ Part B/C/写作）

顶部页眉与底部页码自动裁掉；输出宽度统一 1760px。
（旧的坐标裁剪版逻辑已删除，保留只会误导。）
"""
import os, re, sys
import pymupdf
from PIL import Image

PDF = r"D:/Desktop/English·盐/真题及答案速查（2001-2026）电子试题/2026年考研英语一真题【高清文字版】.pdf"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YEAR = 2026
TARGET_W = 1760
CROP_TOP = 0.028     # 裁掉顶部页眉（此版页眉很窄，约 2.8%）
CROP_BOTTOM = 0.022  # 只裁掉页脚下方的空白边。
# 页脚"英语（一）试题 第 N 页"实测在页高 95.7%~97.4%（她 2026-10-03 反馈
# 页脚被截断显示不全 —— 原来按 3.0% 裁，正好从 97% 下刀切掉了它下半截）。

# (year, text_no, article_page, question_page) —— 已逐页视觉核对
JOBS = [(YEAR, t, 4 + (t - 1) * 2, 5 + (t - 1) * 2) for t in (1, 2, 3, 4)]


def render(doc, pno):
    pix = doc[pno - 1].get_pixmap(dpi=200)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    w, h = img.width, img.height
    img = img.crop((0, int(h * CROP_TOP), w, int(h * (1 - CROP_BOTTOM))))
    return img.resize((TARGET_W, round(img.height * TARGET_W / img.width)), Image.LANCZOS)


def update_manifest(text_no):
    mf = os.path.join(ROOT, "manifest.js")
    src = open(mf, encoding="utf-8").read()
    pid = f"{YEAR}-text{text_no}"
    if re.search(r'id:\s*"%s"' % re.escape(pid), src):
        print(f"  manifest: {pid} 已存在")
        return
    entry = (
        f'    {{\n'
        f'      id: "{pid}",\n'
        f'      label: "Text {text_no}",\n'
        f'      note:  "notes.html?id={pid}",\n'
        f'      underlay: [\n'
        f'        "library/{YEAR}/{pid}-article.png",\n'
        f'        "library/{YEAR}/{pid}-question.png"\n'
        f'      ],\n'
        f'      labels: ["文章页", "题目页"]\n'
        f'    }},\n'
    )
    # 插到该年份数组第一条之前
    m = re.search(r'^\s*%d:\s*\[\n' % YEAR, src, re.M)
    if not m:
        print("  ! manifest 里没有 2026 分组")
        return
    at = m.end()
    src = src[:at] + entry + src[at:]
    open(mf, "w", encoding="utf-8").write(src)
    print(f"  manifest: {pid} 新增条目")


def main():
    doc = pymupdf.open(PDF)
    outdir = os.path.join(ROOT, "library", str(YEAR))
    os.makedirs(outdir, exist_ok=True)
    for year, text_no, ap, qp in JOBS:
        pid = f"{year}-text{text_no}"
        for pno, kind in ((ap, "article"), (qp, "question")):
            img = render(doc, pno)
            fp = os.path.join(outdir, f"{pid}-{kind}.png")
            img.save(fp, optimize=True)
            print(f"  {pid}-{kind}.png  <- p{pno}  {img.width}x{img.height}")
        update_manifest(text_no)
    doc.close()
    print("记得跑 make-imgdata.py 重新打包数据包")


if __name__ == "__main__":
    main()
