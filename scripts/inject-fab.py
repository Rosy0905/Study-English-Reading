# -*- coding: utf-8 -*-
"""
inject-fab.py · 给真题 HTML 注入手写笔记悬浮按钮（一行 <script>，不碰其他内容）

什么时候用：作者更新了真题文件、你把新文件放进 library/年份/ 之后，跑一次：
    python scripts/inject-fab.py
已注入过的文件会自动跳过，重复跑没有副作用。
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK = "note-fab.js"
SNIPPET = ('<script src="{root}assets/note-fab.js" data-paper="{pid}" '
           'data-year="{year}" data-label="{label}" defer></script>')


def rel_root(file_dir):
    return os.path.relpath(ROOT, file_dir).replace("\\", "/").rstrip("/") + "/"


def inject(path):
    rel = os.path.relpath(path, ROOT).replace("\\", "/")
    with open(path, encoding="utf-8") as f:
        html = f.read()
    if MARK in html:
        print("跳过（已有悬浮按钮）:", rel)
        return False
    base = os.path.splitext(os.path.basename(path))[0]   # 如 2014-text1-做题
    m = re.match(r"(\d{4})-text(\d+)", base, re.I)
    if not m:
        print("跳过（文件名不是 年份-textN 格式）:", rel)
        return False
    year, text_no = m.group(1), m.group(2)
    snippet = SNIPPET.format(root=rel_root(os.path.dirname(path)),
                             pid=f"{year}-text{text_no}",
                             year=year, label=f"Text {text_no}")
    if "</body>" in html:
        html = html.replace("</body>", snippet + "\n</body>", 1)
    else:
        html += "\n" + snippet
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    print("已注入:", rel)
    return True


FAVICON_MARK = "icons/icon.svg"


def inject_favicon(path):
    """给真题页加网页图标（幂等）。返回 1=本次新注入"""
    rel = os.path.relpath(path, ROOT)
    html = open(path, encoding="utf-8").read()
    if FAVICON_MARK in html:
        return 0
    root = rel_root(os.path.dirname(path))
    link = (f'<link rel="icon" href="{root}icons/icon.svg" type="image/svg+xml">\n'
            f'<link rel="apple-touch-icon" href="{root}icons/apple-touch-icon.png">')
    if "</head>" in html:
        html = html.replace("</head>", link + "\n</head>", 1)
    else:
        html = link + "\n" + html
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    print("已加图标:", rel)
    return 1


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "library", "*", "*.html")))
    if not files:
        print("library/ 下没找到真题 HTML")
        return 0
    n = sum(1 for p in files if inject(p))
    f = sum(1 for p in files if inject_favicon(p))
    print(f"完成：本次新注入按钮 {n} 个，新加图标 {f} 个")
    return 0


if __name__ == "__main__":
    sys.exit(main())
