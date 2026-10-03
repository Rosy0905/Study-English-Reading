#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bump-version.py · 统一升缓存版本号

她在浏览器里看不到改动时，八成是旧 JS 被缓存住了。
这个脚本把所有 ?v=xxxx 统一改成同一个新版本号。

用法：
  python scripts/bump-version.py            # 只看当前版本分布 + 查漏网
  python scripts/bump-version.py 20261004b   # 全量替换为该版本

【为什么要查漏网】（踩过一次，2026-10-03）
只扫已有的 ?v=，那些压根没写版本号的引用会被漏掉。
漏掉的后果是：那个文件 URL 永远不变，浏览器就一直吃旧缓存 ——
表现是"我明明改了，页面还是老样子"，很容易误判成代码没生效。
所以不带参数运行时，会额外列出所有 assets/ 引用里缺 ?v= 的。
"""
import os
import re
import sys
import glob
from collections import Counter

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
PAT = re.compile(r"(\?v=)([0-9a-zA-Z]+)")
# 匹配 src="xxx.js" / src='xxx.js'，但排除已经有 ?v= 的
SRC_PAT = re.compile(r"""src\s*=\s*["']([^"']+\.(?:js|css))(["'])(?!\s*\?v=)""")
# 不需要版本号的场景：data: URI、内联、以及 note-fab 运行时按需拼出来的路径
SKIP_SUBSTR = ("data:", "assets/pdfimg/", "ekz-imgdata")


def targets():
    out = [os.path.join(ROOT, "index.html"),
           os.path.join(ROOT, "notes.html"),
           os.path.join(ROOT, "guide.html")]
    out += glob.glob(os.path.join(ROOT, "library", "*", "*.html"))
    out += glob.glob(os.path.join(ROOT, "assets", "*.js"))
    return [f for f in out if os.path.isfile(f)]


def audit(files):
    """列出所有缺 ?v= 的 js/css 引用。"""
    missing = []
    for f in files:
        if not f.endswith(".html"):
            continue
        s = open(f, encoding="utf-8", errors="ignore").read()
        for m in SRC_PAT.finditer(s):
            src = m.group(1)
            if any(k in src for k in SKIP_SUBSTR):
                continue
            missing.append((os.path.relpath(f, ROOT), src))
    return missing


def main():
    files = targets()
    if len(sys.argv) < 2:
        c = Counter()
        for f in files:
            s = open(f, encoding="utf-8", errors="ignore").read()
            for _, v in PAT.findall(s):
                c[v] += 1
        print("当前版本号分布：")
        for v, n in sorted(c.items()):
            print(f"  {v}: {n} 处")

        miss = audit(files)
        if miss:
            print(f"\n★ 以下引用没有 ?v=，会被浏览器缓存住（{len(miss)} 处）：")
            for f, src in miss:
                print(f"  {f}  ->  {src}")
            print("  修法：给 src 补上 ?v=<版本号>，再跑一次本脚本就会统一更新。")
        else:
            print("\n所有 js/css 引用都带版本号，缓存这块没问题。")
        print("\n用法：python scripts/bump-version.py <新版本号>")
        return

    ver = sys.argv[1]
    changed = 0
    for f in files:
        s = open(f, encoding="utf-8", errors="ignore").read()
        if not PAT.search(s):
            continue
        new = PAT.sub(lambda m: m.group(1) + ver, s)
        if new != s:
            open(f, "w", encoding="utf-8", errors="ignore").write(new)
            changed += 1
    print(f"已把 {changed} 个文件的版本号统一为 {ver}")

    # 顺手提醒漏网的，别让下一次改动又踩缓存
    miss = audit(files)
    if miss:
        print(f"\n★ 还有 {len(miss)} 处引用没有 ?v=，这些改不动的时候浏览器会吃旧缓存：")
        for f, src in miss:
            print(f"  {f}  ->  {src}")


if __name__ == "__main__":
    main()
