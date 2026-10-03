# -*- coding: utf-8 -*-
"""backup-pngs.py · 打包要改动的底稿图到 zip（改前必做）"""
import os, sys, zipfile, hashlib

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
OUTDIR = r"D:\WB工作记录\英语项目\_backup"

def main():
    years = sys.argv[1:] or ["2024", "2026", "2019"]
    os.makedirs(OUTDIR, exist_ok=True)
    zpath = os.path.join(OUTDIR, "underlay_fix_20261003.zip")
    n = 0
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for y in years:
            d = os.path.join(ROOT, "library", y)
            for f in sorted(os.listdir(d)):
                if not f.endswith(".png"):
                    continue
                p = os.path.join(d, f)
                z.write(p, f"{y}/{f}")
                n += 1
                # 记录 MD5 供事后核对
    print(f"已备份 {n} 张 -> {zpath}")
    with zipfile.ZipFile(zpath) as z:
        bad = z.testzip()
        print("zip 完整性:", "OK" if bad is None else f"损坏 {bad}")

if __name__ == "__main__":
    main()
