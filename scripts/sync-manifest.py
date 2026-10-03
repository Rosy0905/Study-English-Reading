#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
sync-manifest.py · 按 library/ 目录里的实际文件补全 manifest.js

只做一件事：扫描 library/<年>/ 下真实存在的 <年>-text<N>-做题/复盘.html，
把 manifest 里对应条目的 zuoti / fupan 字段补上（已有则保留原值）。
底稿图路径不重算 —— 那个由作者自己放的，脚本不碰。

幂等：跑第二遍不会有任何改动。
"""
import os, re, sys

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
LIB = os.path.join(ROOT, "library")
MF = os.path.join(ROOT, "manifest.js")

# 1) 扫磁盘
real = {}          # (year, text) -> {'do': relpath, 'rv': relpath}
for y in sorted(os.listdir(LIB)):
    yp = os.path.join(LIB, y)
    if not os.path.isdir(yp) or not re.match(r"^\d{4}$", y):
        continue
    for fn in os.listdir(yp):
        m = re.match(r"^(\d{4})-text(\d)-(做题|复盘)\.html$", fn)
        if not m:
            continue
        year, text, kind = int(m.group(1)), int(m.group(2)), m.group(3)
        real.setdefault((year, text), {})["do" if kind == "做题" else "rv"] = \
            "library/%d/%s" % (year, fn)

src = open(MF, encoding="utf-8").read()
orig = src

changed = []
# 2) 逐条处理：找到每个条目的 id，反查该篇真实有哪些页
for m in re.finditer(r'id:\s*"(\d{4}-text(\d))"(.*?)\n    \}', src, re.S):
    pid, text = m.group(1), int(m.group(2))
    year = int(pid[:4])
    body = m.group(3)
    have = real.get((year, text), {})
    new_body = body
    for kind, field in (("do", "zuoti"), ("rv", "fupan")):
        want = have.get(kind)
        has_field = re.search(r'\n\s*%s:\s*"[^"]*"' % field, new_body)
        if want and not has_field:
            # 插到 note 行前面，跟其它年份的写法保持一致
            new_body = re.sub(r'\n(\s*)note:',
                              '\n%s%s: "%s",\n\\1note:' % ("", " " * 6, want),
                              new_body, count=1)
            changed.append("%s +%s" % (pid, field))
        elif want and has_field:
            cur = re.search(r'%s:\s*"([^"]*)"' % field, new_body).group(1)
            if cur != want:
                new_body = new_body.replace('%s: "%s"' % (field, cur), '%s: "%s"' % (field, want))
                changed.append("%s ~%s" % (pid, field))

# 3) 回填（从后往前，避免偏移错位）
result = src
for m in reversed(list(re.finditer(r'id:\s*"(\d{4}-text(\d))"(.*?)\n    \}', src, re.S))):
    pid = m.group(1)
    year, text = int(pid[:4]), int(m.group(2))
    have = real.get((year, text), {})
    body = m.group(3)
    # note 行前面的缩进，新字段跟着它走，保持对齐
    note_ind = re.search(r'\n(\s*)note:', body)
    ind = note_ind.group(1) if note_ind else "      "
    for kind, field in (("do", "zuoti"), ("rv", "fupan")):
        want = have.get(kind)
        has_field = re.search(r'\n\s*%s:\s*"[^"]*"' % field, body)
        if want and not has_field:
            body = re.sub(r'\n(\s*)note:',
                          '\n%s%s: "%s",\n\\1note:' % (ind, field, want), body, count=1)
        elif want and has_field:
            cur = re.search(r'%s:\s*"([^"]*)"' % field, body).group(1)
            if cur != want:
                body = body.replace('%s: "%s"' % (field, cur), '%s: "%s"' % (field, want))
    result = result[:m.start(3)] + body + result[m.end(3):]

if result == orig:
    print("manifest 已经是最新，无需改动。")
    sys.exit(0)

open(MF, "w", encoding="utf-8", newline="").write(result)
print("manifest 已更新，共 %d 处：" % len(changed))
for c in changed:
    print("  " + c)
