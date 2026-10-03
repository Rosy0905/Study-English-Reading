#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
preview-rotate.py · 生成旋转角度对比图
-----------------------------------------------------------------------------
她 2026-10-03 反馈 2019 Text 1/Text 2 题目页"有点歪"，要向右（顺时针）
转一点点。上次我按投影法批量纠偏，方向搞反、幅度也过大，把好图搞坏了。

这次不猜。生成 4 个角度的对比图让她自己挑，pick=None 就不动原图。
角度小到几乎看不出，但足以看出方向对不对。
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "library")
OUT = os.path.join(ROOT, ".probe")

# 她 2026-10-03 亲自选定：t1 逆时针 0.5°、t2 逆时针 0.3°
# （上批量自动纠偏被骂了 —— 方向搞反还把好图搞坏，改为只动这两张、角度由她定）
TARGETS = ["2019/2019-text1-question.png", "2019/2019-text2-question.png"]
PICK = {"2019-text1-question.png": -0.5, "2019-text2-question.png": -0.3}
# 正值 = 顺时针（她要的方向：向右转）
ANGLES = [-0.3, -0.5, -0.7, -1.0]


def main():
    # 显式传角度（如 "0.5"）则用它；不传则走 --write 用 PICK 表，或只出对比图
    pick = None
    write = "--write" in sys.argv
    for a in sys.argv[1:]:
        if a == "--write":
            continue
        try:
            pick = float(a)
            break
        except ValueError:
            pass

    if not write and pick is None:
        # 只生成对比图，不改原图
        for rel in TARGETS:
            src = os.path.join(LIB, rel)
            im = Image.open(src)
            w, h = im.size
            # 缩小以便并排展示
            tw = 520
            th = round(h * tw / w)
            cols = len(ANGLES) + 1
            sheet = Image.new("RGB", (tw * cols, th + 34), (255, 255, 255))
            d = ImageDraw.Draw(sheet)
            labels = ["原图"] + [f"顺时针 {a}°" for a in ANGLES]
            for i, (lab, ang) in enumerate(zip(labels, [0] + ANGLES)):
                if ang == 0:
                    tile = im
                else:
                    tile = im.rotate(ang, resample=Image.BICUBIC,
                                     fillcolor=(255, 255, 255), expand=False)
                    # 旋转后边角会白，把内容居中贴回原尺寸
                    tile = _recenter(tile, im)
                sheet.paste(tile.resize((tw, th), Image.LANCZOS), (i * tw, 34))
                d.text((i * tw + 10, 12), lab, fill=(20, 20, 20))
                d.line([(i * tw, 0), (i * tw, 34 + th)], fill=(210, 210, 210))
            name = os.path.basename(rel).replace(".png", "") + "_rotate.png"
            fp = os.path.join(OUT, name)
            sheet.save(fp)
            print("对比图:", fp)
        print("\n看完告诉我选哪个角度（或说都不对），我再实际写入。")
        return

    # 实际写入：按 PICK 表逐张用各自角度
    for rel in TARGETS:
        name = os.path.basename(rel)
        ang = PICK[name] if pick is None else pick
        src = os.path.join(LIB, rel.replace("/", os.sep))
        im = Image.open(src)
        out = _recenter(im.rotate(ang, resample=Image.BICUBIC,
                                  fillcolor=(255, 255, 255), expand=False), im)
        out.save(src, optimize=True)
        d = "逆时针" if ang < 0 else "顺时针"
        print(f"已{d}旋转 {abs(ang)}°: {rel}")
    print("记得跑 make-imgdata.py 重新打包数据包")


def _recenter(rot, orig):
    """旋转后内容会偏移，把它平移回原来的画布中心，保持纸张尺寸不变。"""
    import numpy as np
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


if __name__ == "__main__":
    main()
