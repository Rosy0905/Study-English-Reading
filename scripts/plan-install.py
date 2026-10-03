#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
plan-install.py · 只读盘点：Downloads 里作者新包 vs 库里现状

不写任何文件，只打印一张对照表，装之前先看清楚要动什么。
"""
import os, re, glob, json

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
DL = os.path.join(os.path.expanduser("~"), "Downloads")

def parse_dl(fn):
    """'2016_text1_做题模式.html' -> (2016, 1, 'do')"""
    m = re.match(r"^(\d{4})_text(\d)_(做题|复盘)模式\.html$", fn)
    if not m: return None
    return int(m.group(1)), int(m.group(2)), ("do" if m.group(3) == "做题" else "rv")

# 库里现状
cur = {}
for y in glob.glob(os.path.join(ROOT, "library", "*")):
    year = os.path.basename(y)
    for f in os.listdir(y):
        m = re.match(rf"^(\d{{4}})-text(\d)-(做题|复盘)\.html$", f)
        if m:
            cur[(int(m.group(1)), int(m.group(2)))] = cur.get((int(m.group(1)), int(m.group(2))), set())
            cur[(int(m.group(1)), int(m.group(2)))].add("do" if m.group(3) == "做题" else "rv")

dl = []
for f in sorted(os.listdir(DL)):
    p = parse_dl(f)
    if p: dl.append((p, f))

print("=" * 78)
print("Downloads 里作者新包 %d 个 vs 库里现状" % len(dl))
print("=" * 78)
print()

# 只看跟今晚这批（20:19 之后）相关的
NEW = {"do": {(2016,1),(2016,4),(2017,3),(2017,4),(2018,3),(2018,4),
              (2019,1),(2019,2),(2020,4),(2021,1),(2021,3),
              (2024,2),(2024,3),(2025,3)},
       "rv": {(2016,1),(2016,4),(2018,2),(2019,1),(2019,4),(2020,4),
              (2021,2),(2025,3)}}

add, update = [], []
for (year, text, kind), fn in dl:
    if (year, text) not in NEW[kind]: continue
    have = cur.get((year, text), set())
    tag = "新增" if kind not in have else "覆盖更新"
    (add if kind not in have else update).append((year, text, kind, fn))

print("【真正新增】%d 个" % len(add))
print("-" * 78)
for year, text, kind, fn in sorted(add):
    other = cur.get((year, text), set())
    print("  %d text%-2d  %-3s  新增   （该篇现有：%s）" %
          (year, text, "做题" if kind == "do" else "复盘", "/".join(other) or "只有笔记"))
print()

print("【覆盖已有】%d 个" % len(update))
print("-" * 78)
for year, text, kind, fn in sorted(update):
    print("  %d text%-2d  %-3s  覆盖" % (year, text, "做题" if kind == "do" else "复盘"))
print()

# 装完之后总数会变成多少
zuoti = len([1 for k in cur if "do" in cur[k]])
fupan = len([1 for k in cur if "rv" in cur[k]])
new_do = zuoti + len([1 for _,_,k,_ in add if k == "do"])
new_rv = fupan + len([1 for _,_,k,_ in add if k == "rv"])
print("=" * 78)
print("装完之后：做题页 %d -> %d   复盘页 %d -> %d" % (zuoti, new_do, fupan, new_rv))
print("笔记 68 篇不变（底稿图本来就齐）")
print("=" * 78)

# 顺带报出「这次装完仍然只有笔记的整年」
only_note = []
for year in range(2010, 2027):
    texts = []
    for t in range(1, 5):
        s = cur.get((year, t), set())
        for _, _, kind, _ in add:
            pass
    texts = None
final = {}
for (y, t), s in cur.items():
    final.setdefault(y, set()).update(s)
for _, t, k, _ in add:
    final.setdefault(_[0] if False else 0, set())

# 重新算最终
final = {}
for (y, t), s in cur.items():
    final.setdefault(y, set()).update(s)
for year, text, kind, fn in add:
    final.setdefault(year, set()).add(kind)

print()
print("装完之后仍然「整年只有笔记」的年份：", end=" ")
allnote = [y for y in range(2010, 2027) if not final.get(y)]
print(allnote if allnote else "无（所有年份都有做题或复盘了）")

print()
print("仍然「一半缺一半」的情况：")
for y in range(2010, 2027):
    s = final.get(y, set())
    if s and s != {"do", "rv"}:
        print("  %d: 只有 %s" % (y, "/".join(s)))
