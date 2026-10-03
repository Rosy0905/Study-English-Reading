# -*- coding: utf-8 -*-
"""check-manifest-coverage.py · 统计 manifest 里做题/复盘的齐全情况

她 2026-10-03 要求单边篇目只显示存在的跳转按钮，
所以要先知道哪些篇目缺哪一边，测试才有意义。
"""
import re, os, collections

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
s = open(os.path.join(ROOT, "manifest.js"), encoding="utf-8").read()

entries = re.findall(r'\{\s*id:\s*"(\d{4}-text\d)"(.*?)\n    \}', s, re.S)
both, only_zuo, only_fu, only_note = [], [], [], []
for pid, body in entries:
    z = "zuoti:" in body
    f = "fupan:" in body
    if z and f:
        both.append(pid)
    elif z:
        only_zuo.append(pid)
    elif f:
        only_fu.append(pid)
    else:
        only_note.append(pid)

print(f"manifest 总条目: {len(entries)}")
print(f"  做题+复盘齐全: {len(both)}")
print(f"  只有做题    : {len(only_zuo)}  {only_zuo}")
print(f"  只有复盘    : {len(only_fu)}  {only_fu}")
print(f"  纯笔记(都没有): {len(only_note)}  {only_note}")

# 与磁盘上的实际文件对照
missing = []
for pid in both + only_zuo + only_fu:
    y = pid.split("-")[0]
    for kind, suf in (("zuoti", "做题"), ("fupan", "复盘")):
        p = os.path.join(ROOT, "library", y, f"{pid}-{suf}.html")
        want = kind == "zuoti" and pid in only_zuo or kind == "fupan" and pid in only_fu or pid in both
        exists = os.path.exists(p)
        if want != exists:
            missing.append((pid, kind, exists))
if missing:
    print("\nmanifest 与磁盘不一致:")
    for m in missing:
        print("  ", m)
else:
    print("\nmanifest 与磁盘文件完全一致 ✓")
