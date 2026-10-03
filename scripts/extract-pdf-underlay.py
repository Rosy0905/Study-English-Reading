#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract-pdf-underlay.py · 从无水印真题 PDF 提取笔记底稿（补齐单边篇目）
-------------------------------------------------------------------------
单边篇目（作者只更新了做题或复盘其中一边）之前没有 underlay，笔记页是空白纸。
复盘 html 里没有可提取的文章/题目原图，改用桌面的《真题及答案速查》PDF
（扫描版、无猫猫头水印）渲染对应页面作为底稿。

页面定位（2026-10-02 人工用缩略图网格逐一核对过，2026-10-02 晚扩为全量 26 篇）：
  2010: t1 p4/5,  t2 p6/7,   t4 p10/11
  2011: t1 p4/5,  t2 p6/7,   t3 p8/9
  2012: t3 p8/9
  2013: t1 p4/5,  t2 p6/7,   t3 p8/9
  2014: t1 p4/5,  t2 p6/7,   t3 p8/9,  t4 p10/11
  2015: t1 p4/5,  t3 p8/9
  2017: t4 p10/11
  2018: t2 p6/7,  t3 p8/9,   t4 p10/11
  2019: t3 p8/9
  2021: t1 p4/5,  t3 p8/9
  2024: t3 p8/9
  2025: t2 p6/7,  t4 p10/11

2026-10-03 补充：2016/2020/2022/2023 逐页放大核对后确认与标准年份同规律
(p1 封面、p2 Section I 正文、p3 Section I 答案+Section II 开头、p4 起 Text 1)，
已并入 JOBS。2026 是 10 页 A4 带文字层的另一套版式，由 extract-2026-underlay.py 处理。
"""
import os, re, sys
import pymupdf
from PIL import Image

PDFDIR = r"D:/Desktop/English·盐/真题及答案速查（2001-2026）电子试题"

# 个别篇目换源：速查版 PDF 里可能已带打印笔迹（2017 t1/t2 就是），
# 改从"真题做题痕迹"目录里那份干净版取。key 是 (year, text_no)。
SOURCE_OVERRIDE = {}   # 目前无需换源；2017 已换干净的速查版
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FORCE_REFRESH = '--force' in sys.argv
JOBS = [
    (2010, 1, 4, 5),
    (2010, 2, 6, 7),
    (2010, 3, 8, 9),
    (2010, 4, 10, 11),
    (2011, 1, 4, 5),
    (2011, 2, 6, 7),
    (2011, 3, 8, 9),
    (2011, 4, 10, 11),
    (2012, 1, 4, 5),
    (2012, 2, 6, 7),
    (2012, 3, 8, 9),
    (2012, 4, 10, 11),
    (2013, 1, 4, 5),
    (2013, 2, 6, 7),
    (2013, 3, 8, 9),
    (2013, 4, 10, 11),
    (2014, 1, 4, 5),
    (2014, 2, 6, 7),
    (2014, 3, 8, 9),
    (2014, 4, 10, 11),
    (2015, 1, 4, 5),
    (2015, 2, 6, 7),
    (2015, 3, 8, 9),
    (2015, 4, 10, 11),
    (2016, 1, 4, 5),
    (2016, 2, 6, 7),
    (2016, 3, 8, 9),
    (2016, 4, 10, 11),
    (2017, 1, 4, 5),
    (2017, 2, 6, 7),
    (2017, 3, 8, 9),
    (2017, 4, 10, 11),
    (2018, 1, 4, 5),
    (2018, 2, 6, 7),
    (2018, 3, 8, 9),
    (2018, 4, 10, 11),
    (2019, 1, 4, 5),
    (2019, 2, 6, 7),
    (2019, 3, 8, 9),
    (2019, 4, 10, 11),
    (2020, 1, 4, 5),
    (2020, 2, 6, 7),
    (2020, 3, 8, 9),
    (2020, 4, 10, 11),
    (2021, 1, 4, 5),
    (2021, 2, 6, 7),
    (2021, 3, 8, 9),
    (2021, 4, 10, 11),
    (2022, 1, 4, 5),
    (2022, 2, 6, 7),
    (2022, 3, 8, 9),
    (2022, 4, 10, 11),
    (2023, 1, 4, 5),
    (2023, 2, 6, 7),
    (2023, 3, 8, 9),
    (2023, 4, 10, 11),
    (2024, 1, 4, 5),
    (2024, 2, 6, 7),
    (2024, 3, 8, 9),
    (2024, 4, 10, 11),
    (2025, 1, 4, 5),
    (2025, 2, 6, 7),
    (2025, 3, 8, 9),
    (2025, 4, 10, 11),
]
# 已人工核验版式规律的年份（这些之外的 2016/2020/2022/2023 为扫描版分离式版式，
# 2026 为紧凑跨页版式，需要单独裁剪拼接，不进 JOBS）
VERIFIED_YEARS = {2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025}
CROP_TOP = 0.045     # 裁掉顶部 4.5%（浅灰公众号广告行）。
                    # 2024 是 A4 版式（比例 1.415）比扫描版（1.471）留白更多，
                    # 3% 会切到正文标题，所以放宽；剩下的余量由 normalize-margins.py 精修。
TARGET_W = 1760      # 输出宽度（长边约 2593，正好在 make-imgdata 的 2600 上限内）


def render(doc, pno):
    pix = doc[pno - 1].get_pixmap(dpi=200)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    h = img.height
    img = img.crop((0, int(h * CROP_TOP), img.width, h))
    img = img.resize((TARGET_W, round(img.height * TARGET_W / img.width)), Image.LANCZOS)
    return img


def update_manifest(year, text_no):
    """条目存在则补 underlay（幂等）；不存在则按 Text 序号插入 note-only 条目"""
    mf = os.path.join(ROOT, "manifest.js")
    src = open(mf, encoding="utf-8").read()
    pid = f"{year}-text{text_no}"
    m = re.search(r'id:\s*"%s"' % re.escape(pid), src)
    if m:
        note_re = re.compile(r'note:\s*"notes\.html\?id=%s",\s*\n' % re.escape(pid))
        note_m = note_re.search(src, m.start())
        if not note_m:
            print(f"  ! {pid} 没找到 note 行"); return
        # underlay 只可能紧跟在本条目 note 行之后（insert_at），用它精确判断幂等
        if re.match(r'\s*underlay', src[note_m.end():note_m.end() + 30]) and not FORCE_REFRESH:
            print(f"  {pid} 已有 underlay，跳过"); return
        insert_at = note_m.end()
        underlay = (
            f'      underlay: [\n'
            f'        "library/{year}/{pid}-article.png",\n'
            f'        "library/{year}/{pid}-question.png"\n'
            '      ],\n'
            '      labels: ["文章页", "题目页"]\n'
        )
        new_src = src[:insert_at] + underlay + src[insert_at:]
        open(mf, "w", encoding="utf-8").write(new_src)
        print(f"  manifest: {pid} 已补 underlay")
        return

    # ---- 无条目：插入 note-only 条目 ----
    year_key = re.search(r'^\s*%s:\s*\[' % year, src, re.M)
    if not year_key:
        print(f"  ! manifest 里没有 {year} 年份分组，请先手动加分组"); return
    arr_start = year_key.end()  # 指向 '[' 后
    # 深度扫描：收集该数组内每个顶层条目的 text_no 与起始位置，并定位数组真正的闭合 ']'
    # （不能 src.index(']') —— 条目里的 underlay: [...] 内也有 ']'，会找错）
    # 起始 depth=1：调用方已消耗年份分组的 '['，当前正处于数组一层内
    depth = 1
    entries = []  # (text_no, obj_start_index)
    arr_end = -1
    i = arr_start
    while i < len(src):
        c = src[i]
        if c == '{':
            if depth == 1:
                id_m = re.search(r'id:\s*"(\d+)-text(\d+)"', src[i:i + 200])
                if id_m:
                    entries.append((int(id_m.group(2)), i))
            depth += 1
        elif c == '}':
            depth -= 1
        elif c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                arr_end = i
                break
        i += 1
    bigger = [e for e in entries if e[0] > text_no]
    if bigger:
        insert_at = min(e[1] for e in bigger)
        # 回退到该条目行首（含缩进）
        line_start = src.rfind('\n', 0, insert_at) + 1
        entry = (
            f'    {{\n'
            f'      id: "{pid}",\n'
            f'      label: "Text {text_no}",\n'
            f'      note:  "notes.html?id={pid}",\n'
            f'      underlay: [\n'
            f'        "library/{year}/{pid}-article.png",\n'
            f'        "library/{year}/{pid}-question.png"\n'
            f'      ],\n'
            f'      labels: ["文章页", "题目页"]\n'
            f'    }},\n'
        )
        new_src = src[:line_start] + entry + src[line_start:]
    else:
        # 插到数组真正闭合 ']' 之前
        if arr_end < 0:
            print(f"  ! {year} 分组括号扫描失败"); return
        before = src[:arr_end].rstrip()
        # 看数组闭合前最后一个非空白字符：是 '}' 则要补逗号，是 ',' 则不用
        need_comma = before.endswith('}')
        entry_body = (
            f'    {{\n'
            f'      id: "{pid}",\n'
            f'      label: "Text {text_no}",\n'
            f'      note:  "notes.html?id={pid}",\n'
            f'      underlay: [\n'
            f'        "library/{year}/{pid}-article.png",\n'
            f'        "library/{year}/{pid}-question.png"\n'
            f'      ],\n'
            f'      labels: ["文章页", "题目页"]\n'
            f'    }}\n'
        )
        entry = (',\n' if need_comma else '\n') + entry_body
        new_src = src[:len(before)] + entry + src[arr_end:]
    open(mf, "w", encoding="utf-8").write(new_src)
    print(f"  manifest: {pid} 新增 note-only 条目")


def find_pdf(year):
    """按年份找速查 PDF。兼容导出时系统自动加的数字后缀
    （例如 2017年真题及答案速查1.pdf —— 她 2026-10-03 重新导出 2017 后
      文件名多了一个 1，固定文件名会找不到）。"""
    exact = os.path.join(PDFDIR, f"{year}年真题及答案速查.pdf")
    if os.path.exists(exact):
        return exact
    import glob, re as _re
    cands = glob.glob(os.path.join(PDFDIR, f"{year}年真题及答案速查*.pdf"))
    if cands:
        # 优先取后缀数字最小的（原始导出），否则取第一个
        cands.sort(key=lambda p: (_re.sub(r'^\D+', '', os.path.basename(p)[len(str(year)):]) or '0'))
        return cands[0]
    return exact   # 交由调用方报错，信息更明确

def main():
    cache = {}
    only = {int(a) for a in sys.argv[1:] if a.isdigit()}
    for year, text_no, a_page, q_page in JOBS:
        if only and year not in only:
            continue
        pid = f"{year}-text{text_no}"
        print(f"提取 {pid} …")
        src_pdf = SOURCE_OVERRIDE.get((year, text_no))
        ckey = src_pdf or year
        if ckey not in cache:
            path_pdf = src_pdf or find_pdf(year)
            cache[ckey] = pymupdf.open(path_pdf)
            if src_pdf:
                print(f"  （换源：{os.path.basename(src_pdf)}）")
        doc = cache[ckey]
        ydir = os.path.join(ROOT, "library", str(year))
        os.makedirs(ydir, exist_ok=True)
        for slot, pno in (("article", a_page), ("question", q_page)):
            img = render(doc, pno)
            path = os.path.join(ydir, f"{pid}-{slot}.png")
            img.save(path, optimize=True)
            print(f"  {slot}: p{pno} -> {path}（{img.width}x{img.height}）")
        update_manifest(year, text_no)
    for d in cache.values():
        d.close()
    print("全部完成！记得跑 make-imgdata.py 重新打包数据包")


if __name__ == "__main__":
    main()
