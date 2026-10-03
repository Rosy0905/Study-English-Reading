#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apply-skew.py · 旋转指定底稿图（角度由她定，不擅自决定）
-----------------------------------------------------------------------------
重要原则（她 2026-10-03 明确要求）：
  **不许擅自批量纠偏。** 方向和角度必须她看过对比图后点头才动手。
  所以这个脚本只在"她明确给了角度"时使用，不带任何默认 PICK 表。

用法：
  python scripts/apply-skew.py --list                    # 看所有已登记项
  python scripts/apply-skew.py 2019-text2-question -0.39  # 顺时针 0.39°
  python scripts/apply-skew.py 2019-text2-question -0.39 --write

角度约定：PIL rotate 正值 = 逆时针，负值 = 顺时针。
  例：她 2026-10-03 定 2019 t2 题目页"顺时针 0.39°（完全扶正）" → -0.39

旋转完一定要跟一遍 normalize-margins.py：
  旋转会让画布一角被切掉（实测题目页下留白直接归 0），
  补白回来页脚才不会被裁。
"""
import os
import sys
import numpy as np
from PIL import Image

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
LIB = os.path.join(ROOT, "library")


def allUnderlays():
    """列出全部底稿图，key 形如 '2019-text2-question'。"""
    out = []
    for y in sorted(os.listdir(LIB)):
        d = os.path.join(LIB, y)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith(".png"):
                out.append((y, f[:-4], os.path.join(d, f)))
    return out


def recenter(rot, orig):
    """旋转后边角会切掉一点，把内容平移回画布中心，尽量保持纸张尺寸不变。"""
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


def find(name):
    for _, base, p in allUnderlays():
        if base == name:
            return p
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv

    if not args or args[0] == "--list":
        print(f"共 {len(allUnderlays())} 张底稿。示例：")
        for _, base, _p in allUnderlays()[:6]:
            print(f"  {base}")
        print("...\n用法：apply-skew.py <名字> <角度> [--write]")
        return

    name, ang = args[0], float(args[1])
    src = find(name)
    if not src:
        print(f"找不到底稿 {name}")
        return

    im = Image.open(src)
    rot = recenter(
        im.rotate(ang, resample=Image.BICUBIC, fillcolor=(255, 255, 255)),
        im,
    )
    d = "逆时针" if ang > 0 else "顺时针"
    rel = os.path.relpath(src, ROOT).replace("\\", "/")

    if write:
        rot.save(src, optimize=True)
        print(f"已旋转 {d} {abs(ang)}° -> {rel}")
        print("下一步：normalize-margins.py %s --write（补旋转切掉的留白）"
              % os.path.basename(os.path.dirname(src)))
        print("      make-imgdata.py（重新打包）")
    else:
        out = os.path.join(ROOT, ".probe", f"skew_{name}.png")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        rot.save(out)
        print(f"[dry] {d} {abs(ang)}° -> {out}  （加 --write 才真正写入）")


if __name__ == "__main__":
    main()
