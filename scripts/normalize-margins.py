#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
normalize-margins.py · 把底稿图的上下留白统一到目标值
-----------------------------------------------------------------------------
她 2026-10-03 反馈：2024 上面太贴边、下面空太多（之前修过又坏了）；
2026 上下还略要加留白，跟其他年份不一样。

实测（probe-margins.py）各年上下留白：
    2016-2023 正常：上 3.0-3.9% / 下 5.1-6.2%
    2024       坏  ：上 1.4-2.1% / 下 9.8-10.6%
    2026       偏差：上 3.0%     / 下 0.56%

为什么 auto-trim.py 修不了：
    它只在内容 bbox 外围"加固定白边"，画布不够时 max(0, ...) 直接变成 0%，
    于是 2024 裁完上留白还是 0%（贴边），2026 下留白还是 0%。越修越糟。

本脚本反过来 —— 以"目标留白"为准，向上下补白边或裁掉多余：
    留白不足 → 在那一侧补白边（不切内容）
    留白过多 → 裁掉多余部分
只动上下，不动左右（她没提左右，且左右是页面本身的版式）。
"""
import os, sys
import numpy as np
from PIL import Image

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
LIB = os.path.join(ROOT, "library")

# 目标值：取 2016-2023 正常年份的区间中值，略偏保守（上多一点好写字）
TARGET_TOP = 0.035      # 3.5%
TARGET_BOTTOM = 0.055   # 5.5%
MIN_H = 0.5             # 内容高度占比低于此值认为识别失败，不动
MIN_ROW_INK = 0.002     # 一行至少 0.2% 宽度有墨才算内容行


def content_rows(path):
    im = Image.open(path).convert("L")
    a = np.array(im)
    h, w = a.shape
    rows = (a < 200).sum(axis=1)
    nz = np.nonzero(rows > max(2, w * MIN_ROW_INK))[0]
    if len(nz) == 0:
        return None
    return im, nz[0], nz[-1], h, w


def normalize(path, write=False, dry=False):
    r = content_rows(path)
    if r is None:
        return None
    im, top, bot, h, w = r
    content_h = (bot - top + 1) / h
    if content_h < MIN_H:
        return None

    # 当前留白
    cur_top, cur_bot = top / h, (h - 1 - bot) / h

    # 目标：上下各自补到目标留白
    #   已有留白 > 目标 → 这一侧裁掉多余
    #   已有留白 < 目标 → 这一侧补白边（内容本体一个像素不动）
    # 分侧处理，不做居中，避免"上补多了下就不够"。
    # 归一化后每侧都恰好等于目标像素数，所以 after% 会围绕目标值小幅浮动
    # （分母 new_h 变了），属正常。
    cur_t_px, cur_b_px = top, h - 1 - bot
    size_t = round(h * TARGET_TOP)      # 顶部最终留白像素
    size_b = round(h * TARGET_BOTTOM)    # 底部最终留白像素
    body = bot - top + 1
    new_h = size_t + body + size_b
    new_top = size_t                    # 内容在新画布里的顶
    new_bot = size_t + bot - top         # 内容在新画布里的底

    before = (cur_top * 100, cur_bot * 100)
    after = (new_top / new_h * 100, (new_h - 1 - new_bot) / new_h * 100)

    if write and not dry:
        src = Image.open(path)
        # 裁掉超出目标的旧留白
        body_img = src.crop((0, top, w, bot + 1))
        canvas = Image.new("RGB", (w, new_h), (255, 255, 255))
        canvas.paste(body_img, (0, size_t))
        canvas.save(path, optimize=True)
    return before, after, new_h, w, content_h * 100


def main():
    years = [a for a in sys.argv[1:] if a.isdigit()]
    write = "--write" in sys.argv
    dry = "--dry" in sys.argv
    if not years:
        print("用法: normalize-margins.py <年份...> [--write] [--dry]")
        sys.exit(1)

    print(f"目标：上 {TARGET_TOP*100:.1f}% / 下 {TARGET_BOTTOM*100:.1f}%\n")
    print(f"{'文件':<36}{'原高':>6}{'新高':>6}{'上%前':>8}{'下%前':>8}{'上%后':>8}{'下%后':>8}")
    print("-" * 84)
    total = 0
    for y in years:
        d = os.path.join(LIB, y)
        if not os.path.isdir(d):
            print(f"跳过 {y}（无目录）")
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".png"):
                continue
            p = os.path.join(d, f)
            orig_h = Image.open(p).height
            r = normalize(p, write=write, dry=dry)
            if not r:
                print(f"{y}/{f:<30}  (识别失败，跳过)")
                continue
            b, a, nh, w, ch = r
            total += 1
            mark = "" if write else "  (dry)"
            print(f"{y}/{f:<30}{orig_h:>6}{nh:>6}{b[0]:>8.2f}{b[1]:>8.2f}{a[0]:>8.2f}{a[1]:>8.2f}{mark}")
    print(f"\n共 {total} 张。", end="")
    if not write:
        print("这是预演，确认后加 --write 执行。")
    else:
        print("已写入。")


if __name__ == "__main__":
    main()
