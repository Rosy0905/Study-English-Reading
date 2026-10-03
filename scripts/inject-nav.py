#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inject-nav.py · 给做题/复盘页注入互跳按钮 + 位置记忆（以及清理历史遗留）

-----------------------------------------------------------------------------
背景（她 2026-10-03 要求）：
  做题页顶栏加【复盘】【真题】，复盘页加【做题】【真题】，位置在「主页」后。
  做题/复盘都是多页步进，刷新后记住上次停在哪一步。

现在这套的分工（2026-10-03 重构后）：
  - 按钮挂载 / 位置记忆的**全部逻辑**都在 assets/ekz-page-nav.js 里，
    本脚本只负责把 <script> 标签和 <html data-root> 塞进页面。
  - 按钮样式也在 ekz-nav.js 的 addNavCSS() 里动态注入（运行时 <style>），
    **不再往页面里写死 CSS** —— 早期版本写死过一份，后来发现跟
    addNavCSS 完全重复（两份都在改同一个类），已由 --clean 清理掉。

幂等：
  - 已有 ekz-page-nav.js 标签的页面跳过。
  - --clean 只删历史遗留的那段写死 CSS，不碰别的东西。
"""
import os
import re
import sys
import glob

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"

# 历史版本写死注入的 CSS（第一行用作识别标记）。
# addNavCSS() 已在运行时注入一份完全等效的（还多 !important 提权），
# 所以这份是纯冗余，必须清掉 —— 两份样式同时存在时，
# 页面自带 .btn 的灰边会赢，看起来就像"改了没生效"。
LEGACY_CSS_MARK = "/* 互跳按钮：与顶栏同款（做题页 .btn / 复盘页 button 基础样式） */"
LEGACY_CSS = (
    LEGACY_CSS_MARK + "\n"
    ".ekzNavBtn{text-decoration:none;display:inline-flex;align-items:center;}\n"
    ".ekzNavBtn:hover{text-decoration:none;}\n"
    ".topbar .ekzNavBtn{white-space:nowrap;}\n"
)


def listPages():
    return sorted(
        glob.glob(os.path.join(ROOT, "library", "*", "*做题.html"))
        + glob.glob(os.path.join(ROOT, "library", "*", "*复盘.html"))
    )


def depthOf(path):
    """从项目根到该页所在目录需要上溯几层（返回 '../' 串）。"""
    rel = os.path.relpath(path, ROOT).split(os.sep)
    return "../" * (len(rel) - 1)


def clean(path, write):
    """删掉历史遗留的写死 CSS。返回 'cleaned' / 'absent'。"""
    s = open(path, encoding="utf-8").read()
    if LEGACY_CSS_MARK not in s:
        return "absent"
    s = s.replace(LEGACY_CSS, "")
    # 万一格式有出入（空白差异），退一步按标记整段删
    if LEGACY_CSS_MARK in s:
        s = re.sub(
            re.escape(LEGACY_CSS_MARK) + r".*?</style>", "</style>", s, flags=re.S
        )
    if write:
        open(path, "w", encoding="utf-8").write(s)
    return "cleaned"


def patch(path):
    """补齐 script 标签 + data-root。返回状态字符串。"""
    s = open(path, encoding="utf-8").read()

    if "</style>" not in s:
        return "no-style"
    m_html = re.search(r"<html[^>]*>", s)
    if not m_html:
        return "no-html-tag"
    # 插入点锚在 note-fab 标签之前，所以 note-fab 必须已经存在。
    # 装新页面的正确顺序：inject-fab.py 先跑，本脚本后跑。
    # 反过来（先 patch 后 inject-fab）会静默返回 no-fab-tag 而不写入，
    # 页面看着正常但互跳按钮全都没有—— 2026-10-03 踩过。
    if not re.search(r'<script src="(?:\.\./)*assets/note-fab\.js', s):
        return "no-fab-tag"

    need = []
    # 1) 三个 defer 脚本，按书写顺序执行；ekz-page-nav 必须最后（它要读 LIBRARY）
    if "ekz-page-nav.js" not in s:
        need.append("scripts")
    # 2) data-root：file:// 下 pathname 数目录会把盘符那层也算进去，固化更稳
    if "data-root" not in m_html.group(0):
        need.append("data-root")
    if not need:
        return "ok-already"

    depth = depthOf(path)

    if "scripts" in need:
        fab = re.search(
            r'<script src="(?:\.\./)*assets/note-fab\.js[^"]*"[^>]*>', s
        )
        # 版本号跟库里其它页面保持一致，不能写死 —— 写死会让新页
        # 带着旧版本号混进来，bump-version.py 下次还得再刷一遍。
        # 优先跟 manifest.js 上已有的版本号走。
        v = "20261003g"
        mv = re.search(r"assets/[\w.-]+\.js\?v=([0-9a-z]+)", s)
        if mv:
            v = mv.group(1)
        tags = (
            f'<script src="{depth}manifest.js?v={v}" defer></script>'
            f'<script src="{depth}assets/ekz-nav.js?v={v}" defer></script>'
            f'<script src="{depth}assets/ekz-page-nav.js?v={v}" defer></script>'
        )
        s = s[: fab.start()] + tags + s[fab.start():]
        # 插标签后 m_html 的偏移失效，重新定位
        m_html = re.search(r"<html[^>]*>", s)

    if "data-root" in need:
        tag = m_html.group(0)
        new_tag = tag[:-1] + f' data-root="{depth}">'
        s = s[: m_html.start()] + new_tag + s[m_html.end():]

    open(path, "w", encoding="utf-8").write(s)
    return "ok"


def main():
    write = "--clean" in sys.argv
    files = listPages()
    stats = {}
    for f in files:
        r = clean(f, write)
        if r == "cleaned" and write:
            # 清理后仍要确认标签齐全
            r = patch(f)
        stats[r] = stats.get(r, 0) + 1
    print(f"共 {len(files)} 个页面" + ("（已写入）" if write else "（只读，未改）"))
    for k, v in sorted(stats.items()):
        print(f"  {k}: {v}")
    if not write:
        print("\n加 --clean 才会真正改动。")


if __name__ == "__main__":
    main()
