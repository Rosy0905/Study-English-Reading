#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
add-paper.py · 一键上架新篇目（作者更新时用）

用法（在资料库根目录运行）：
  python scripts/add-paper.py --year 2015 --text 2 ^
    --do "C:/Downloads/2015_text2_做题模式.html" ^
    --review "C:/Downloads/2015_text2_复盘模式.html"

自动完成：
  1. 复制做题/复盘 html 到 library/年份/（统一命名）
  2. 从做题 html 提取文章页/题目页 base64 图存成 png（笔记底稿）
  3. 更新 manifest.js（按 Text 序号插入到对应年份）
  4. 给两个 html 注入悬浮按钮脚本（幂等，重复跑无副作用）
"""
import argparse, base64, json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable


def extract_images(do_html_path, out_dir, base):
    """从做题模式 html 提取文章页/题目页 base64 图（兼容 articleImage/img1 两种键名）"""
    html = open(do_html_path, encoding="utf-8").read()
    out = []
    for slot in ("article", "question"):
        alt = {"article": "img1", "question": "img2"}[slot]
        keys = [f'"{slot}Image":"data:image/png;base64,',
                f'"{alt}":"data:image/png;base64,']
        data = None
        for key in keys:
            i = html.find(key)
            if i < 0:
                key = key.replace("'", '"')
                i = html.find(key)
            if i >= 0:
                start = i + len(key)
                end = html.find('"', start)
                data = base64.b64decode(html[start:end])
                break
        if data is None:
            print(f"  ! 做题页里没找到 {slot} 图（底稿图跳过，笔记页会是空白纸）")
            continue
        path = os.path.join(out_dir, f"{base}-{slot}.png")
        open(path, "wb").write(data)
        out.append(path)
        print(f"  底稿图 {slot}: {len(data)//1024}KB -> {os.path.basename(path)}")
    return out


def find_year_array(src, year):
    """找到 `年份: [` 的开括号与配对闭括号位置（括号深度匹配，不受 underlay 内层 ] 干扰）"""
    m = re.search(rf"\b{year}:\s*\[", src)
    if not m:
        return None
    depth = 0; instr = False; esc = False
    for j in range(m.end() - 1, len(src)):
        c = src[j]
        if instr:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = False
            continue
        if c == '"': instr = True
        elif c == "[": depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return (m.end() - 1, j)
    return None


def split_items(inner):
    """按顶层花括号把年份数组内容拆成一条条篇目"""
    items = []; depth = 0; start = None; instr = False; esc = False
    for k, c in enumerate(inner):
        if instr:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = False
            continue
        if c == '"': instr = True
        elif c == "{":
            if depth == 0: start = k
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0 and start is not None:
                items.append(inner[start:k + 1]); start = None
    return items


def update_manifest(year, text_no, base, has_do=True, has_rv=True):
    mf = os.path.join(ROOT, "manifest.js")
    src = open(mf, encoding="utf-8").read()
    pid = f"{year}-text{text_no}"
    if pid in src:
        print(f"  ! manifest 里已有 {pid}，跳过清单更新（如需重录请先手删）")
        return
    entry = (
        '{\n'
        f'      id: "{pid}",\n'
        f'      label: "Text {text_no}",\n'
    )
    if has_do:
        entry += f'      zuoti: "library/{year}/{pid}-做题.html",\n'
    if has_rv:
        entry += f'      fupan: "library/{year}/{pid}-复盘.html",\n'
    entry += f'      note:  "notes.html?id={pid}",\n'
    if has_do:
        entry += (
            f'      underlay: [\n'
            f'        "library/{year}/{pid}-article.png",\n'
            f'        "library/{year}/{pid}-question.png"\n'
            '      ],\n'
            '      labels: ["文章页", "题目页"]\n'
        )
    entry += '    }'
    # 定位目标年份的数组（深度匹配版）
    loc = find_year_array(src, year)
    if not loc:
        print(f"  ! manifest 里找不到 {year} 年份，清单未更新"); return
    open_i, close_i = loc
    inner = src[open_i + 1:close_i]
    items = [it for it in split_items(inner) if it.strip()]
    items = [it for it in items if f'id: "{pid}"' not in it]   # 去重（重复跑安全）
    items.append(entry)
    def sort_key(item):
        mm = re.search(r"text(\d+)", item)
        return int(mm.group(1)) if mm else 99
    items.sort(key=sort_key)
    inner_new = "\n    " + ",\n    ".join(items) + "\n  "
    new_src = src[:open_i + 1] + inner_new + src[close_i:]
    open(mf, "w", encoding="utf-8").write(new_src)
    print(f"  manifest.js 已加入 {pid}")


def inject_fab():
    subprocess.run([PY, os.path.join(ROOT, "scripts", "inject-fab.py")],
                   cwd=ROOT, capture_output=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", required=True, type=int)
    ap.add_argument("--text", required=True, type=int)
    ap.add_argument("--do", default="", help="作者更新包里的做题模式 html（缺复盘时只传这个）")
    ap.add_argument("--review", default="", help="作者更新包里的复盘模式 html（缺做题时只传这个）")
    a = ap.parse_args()
    if not a.do and not a.review:
        sys.exit("做题和复盘至少要给一个哦")

    year_dir = os.path.join(ROOT, "library", str(a.year))
    os.makedirs(year_dir, exist_ok=True)
    base = f"{a.year}-text{a.text}"
    print(f"上架 {base} …")

    dst_do = os.path.join(year_dir, f"{base}-做题.html")
    dst_rv = os.path.join(year_dir, f"{base}-复盘.html")
    if a.do:
        shutil.copyfile(a.do, dst_do);   print(f"  复制做题: {dst_do}")
    if a.review:
        shutil.copyfile(a.review, dst_rv); print(f"  复盘复盘: {dst_rv}")

    if a.do:
        extract_images(dst_do, year_dir, base)
    update_manifest(a.year, a.text, base, has_do=bool(a.do), has_rv=bool(a.review))
    inject_fab()
    print(f"✅ {base} 上架完成！刷新主页（Ctrl+F5）即可看到")


if __name__ == "__main__":
    main()
