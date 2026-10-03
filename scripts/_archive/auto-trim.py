# -*- coding: utf-8 -*-
"""
auto-trim.py · 按实际内容自动裁掉底稿图的上下空白
-----------------------------------------------------------------
问题背景：底稿图是给手写用的"纸"，页眉页码留太多 wastes 手写空间，
留太少又会切到正文。写死比例不靠谱 —— 各年份 PDF 版式不同：
  2010-2023 等扫描版  页面比例 1.471，页眉窄
  2024 / 2026        A4 比例 1.415，页眉宽
2024 用 3% 裁顶部，结果上留白 0.0%（切到正文了）、下留白 10.0%。

做法：先按行扫描找出第一行/最后一行有内容的位置，再统一留一点边距。
这样不管页面比例、页眉多高都能自适应。
"""
import os, sys, glob
import numpy as np
from PIL import Image

# 手写留边。她 2026-10-03 反馈"题目页上下太窄、切得夸张"，
# 1.2%/1.5% 确实太紧（还容易压到第一行/最后一行），放宽到 3%/3.5%。
PAD_TOP = 0.030
PAD_BOTTOM = 0.035
MIN_H = 0.5   # 内容高度占比低于此值说明识别失败，不裁


def trim_one(path, pad_top=PAD_TOP, pad_bottom=PAD_BOTTOM, write=False, dry=False):
    im = Image.open(path).convert("L")
    a = np.array(im)
    h, w = a.shape
    dark = (a < 200)
    rows = dark.sum(axis=1)
    nz = np.nonzero(rows > max(2, w * 0.002))[0]   # 至少 0.2% 宽度有墨才算一行
    if len(nz) == 0:
        return None
    top = nz[0]
    bot = nz[-1]
    content_h = (bot - top) / h
    if content_h < MIN_H:
        return None
    pad_t = int(h * pad_top)
    pad_b = int(h * pad_bottom)
    t = max(0, top - pad_t)
    b = min(h, bot + 1 + pad_b)
    before = (top / h * 100, (h - 1 - bot) / h * 100)
    after = (t / h * 100, (h - b) / h * 100)
    if write and not dry:
        src = Image.open(path)
        src.crop((0, t, w, b)).save(path, optimize=True)
    return before, after, (b - t), (content_h * 100)


def main():
    root = r"D:\WB工作记录\英语项目\英语真题阅读资料库\library"
    write = "--write" in sys.argv
    targets = []
    for y in range(2010, 2027):
        for t in range(1, 5):
            for kind in ("article", "question"):
                p = os.path.join(root, str(y), f"{y}-text{t}-{kind}.png")
                if os.path.exists(p):
                    targets.append((y, t, kind, p))
    print(f"共 {len(targets)} 张\n")
    print(f"{'年':>5} {'T':>2} {'类型':>4} {'裁前上%':>8} {'裁前下%':>8} {'裁后上%':>8} {'裁后下%':>8} {'内容高%':>7}")
    print("-" * 62)
    for y, t, kind, p in targets:
        r = trim_one(p, write=write)
        if not r:
            print(f"{y:>5} {t:>2} {kind:>4}  (识别失败，跳过)")
            continue
        b, a, newh, ch = r
        mark = "" if write else "  (dry)"
        print(f"{y:>5} {t:>2} {kind:>4} {b[0]:>8.1f} {b[1]:>8.1f} {a[0]:>8.1f} {a[1]:>8.1f} {ch:>7.1f}{mark}")
    if not write:
        print("\n这是预演。确认无误后加 --write 真正执行。")
    else:
        print("\n已写入。")


if __name__ == "__main__":
    main()
