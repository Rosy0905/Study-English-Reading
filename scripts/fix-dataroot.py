#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix-dataroot.py · 给已注入的做题/复盘页补 <html data-root="../../">
-----------------------------------------------------------------------------
relToRoot() 原本靠数 location.pathname 的 "/" 算层级，但 file:// 下
pathname 会带盘符那一层，导致多算了 4 层（实测 href 变成 ../../../../ 6 层）。
改成在 <html> 上写死 data-root，本脚本负责补齐到已有的 42 个文件里。
幂等：已有 data-root 就跳过。
"""
import os, re, glob

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "library", "*", "*做题.html"))
                   + glob.glob(os.path.join(ROOT, "library", "*", "*复盘.html")))
    done = skip = fail = 0
    for f in files:
        s = open(f, encoding="utf-8").read()
        m = re.search(r"<html[^>]*>", s)
        if not m:
            print("  ! 无 <html> 标签:", f)
            fail += 1
            continue
        tag = m.group(0)
        if "data-root" in tag:
            skip += 1
            continue
        rel = os.path.relpath(f, ROOT).split(os.sep)
        depth = "../" * (len(rel) - 1)
        new_tag = tag[:-1] + f' data-root="{depth}">'
        s = s[:m.start()] + new_tag + s[m.end():]
        open(f, "w", encoding="utf-8").write(s)
        done += 1
    print(f"共 {len(files)} 个：已补 {done}，已存在跳过 {skip}，失败 {fail}")


if __name__ == "__main__":
    main()
