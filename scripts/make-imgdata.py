# -*- coding: utf-8 -*-
"""
make-imgdata.py · 生成"导出专用图片数据包"
------------------------------------------------------------
为什么需要它：
  本地 file:// 直开时，浏览器禁止 JS 读取本地图片内容（canvas 会被
  "污染"，toBlob/toDataURL 全部报错），导致所有"带底图的导出"都失败。
  解法：上架时把底稿图压成 JPEG、转 base64，生成 assets/pdfimg/<id>.js。
  导出时动态加载这个包，图片走 dataURL，canvas 不再被污染。
  （平时浏览页面完全不用它，只在点导出时才按篇目懒加载。）

用法：
  python scripts/make-imgdata.py            # 全量扫描 manifest.js 生成
  以后每上架新篇目（add-paper.py）后再跑一次即可。
"""
import base64
import io
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "manifest.js"
OUTDIR = ROOT / "assets" / "pdfimg"

# 用 node 把 manifest.js 里的 LIBRARY 求值成 JSON（避免自己写解析器）
node_script = """
const fs=require('fs');
let src=fs.readFileSync(process.argv[1],'utf8');
const LIBRARY=eval(src+';LIBRARY');
const out={};
for(const y of Object.keys(LIBRARY)){
  out[y]=LIBRARY[y].map(it=>({id:it.id,label:it.label,underlay:it.underlay||null}));
}
process.stdout.write(JSON.stringify(out));
"""
r = subprocess.run(["node", "-e", node_script, str(MANIFEST)],
                   capture_output=True, text=True, encoding="utf-8")
if r.returncode != 0:
    print("读取 manifest.js 失败:", r.stderr)
    sys.exit(1)

papers = json.loads(r.stdout)
OUTDIR.mkdir(parents=True, exist_ok=True)

try:
    from PIL import Image
except ImportError:
    print("需要 Pillow：请先 pip install pillow")
    sys.exit(1)

MAX_EDGE = 2600      # 长边上限（原图 2513 以内不缩，保清晰）
JPEG_Q = 92

total_files = 0
total_bytes = 0
for year, items in papers.items():
    for it in items:
        if not it.get("underlay"):
            continue
        dataurls = []
        for rel in it["underlay"]:
            img_path = ROOT / rel
            if not img_path.exists():
                print("!! 缺图，跳过:", rel)
                dataurls.append("")
                continue
            im = Image.open(img_path).convert("RGB")
            w, h = im.size
            if max(w, h) > MAX_EDGE:
                scale = MAX_EDGE / max(w, h)
                im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=JPEG_Q, optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            dataurls.append("data:image/jpeg;base64," + b64)
            total_bytes += buf.tell()
        js = ("/* 自动生成：由 scripts/make-imgdata.py 产生，勿手改。"
              "只供导出时懒加载，平时页面不会用到。 */\n"
              "window.EKZ_IMGDATA=window.EKZ_IMGDATA||{};\n"
              "EKZ_IMGDATA[%r]=%s;\n" % (it["id"], json.dumps(dataurls)))
        out = OUTDIR / (it["id"] + ".js")
        out.write_text(js, encoding="utf-8")
        total_files += 1
        print("生成 %s（%d 张图，共 %.0f KB）" % (out.relative_to(ROOT), len(dataurls), out.stat().st_size / 1024))

print("完成：%d 个篇目数据包，图片总体积 %.0f KB" % (total_files, total_bytes / 1024))
