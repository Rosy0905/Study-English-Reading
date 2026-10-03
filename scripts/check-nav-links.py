# 检查 manifest 里的 zuoti/fupan/note 路径是否都真实存在
import re, os, json

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
s = open(os.path.join(ROOT, "manifest.js"), encoding="utf-8").read()

# 抓每个条目的 id / zuoti / fupan / note
entries = re.findall(
    r'\{\s*id:\s*"(\d{4}-text\d)"(.*?)\n\s*\}', s, re.S)
print("抓到条目:", len(entries))

bad = []
for pid, body in entries:
    for fld in ("zuoti", "fupan", "note"):
        m = re.search(f'{fld}:\s*"([^"]*)"', body)
        if not m:
            continue
        p = m.group(1)
        # note 可能是 notes.html?id=xxx
        real = p.split("?")[0]
        full = os.path.join(ROOT, real.replace("/", os.sep))
        if not os.path.isfile(full):
            bad.append((pid, fld, p))

print("\n不存在的路径:", len(bad))
for b in bad:
    print("  ", b)

# 反向：磁盘上有但 manifest 没登记的
print("\n--- 反向核对 ---")
for fld, suf in (("zuoti", "做题.html"), ("fupan", "复盘.html")):
    have = set()
    for y in os.listdir(os.path.join(ROOT, "library")):
        d = os.path.join(ROOT, "library", y)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.endswith(suf):
                pid = f.split("-")[0] + "-text" + re.search(r"-text(\d)", f).group(1)
                have.add(pid)
    inman = set()
    for pid, body in entries:
        if re.search(f'{fld}:\s*"', body):
            inman.add(pid)
    only_disk = sorted(have - inman)
    only_man = sorted(inman - have)
    print(f"{fld}: 磁盘有 {len(have)} 个, manifest 登记 {len(inman)} 个")
    if only_disk: print("   磁盘有但没登记:", only_disk)
    if only_man:  print("   登记了但磁盘没有:", only_man)
