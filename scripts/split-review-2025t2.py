# -*- coding: utf-8 -*-
"""2025-text2-复盘.html 提速：新版模板用 DATA.assets + img[data-asset]，
与旧模板的 ASSETS 查表不同，需单独拆。

原状：8.3MB 单文件（13 个 base64 大图，7.8MB），打开要等很久。
改后：html 只留几十 KB；DATA.assets 换成空对象 + loadAsset() 按需加载；
每张图一个小 js（<pid>.assets/<key>.js），内容 window.__ekzA(key,dataURL)。
保留 base64 → file:// 直开 canvas 不污染，导出照常。
"""
import os, re, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "library", "2025", "2025-text2-复盘.html")
PID = "2025-text2"

src = open(PAGE, encoding="utf-8").read()
orig_len = len(src)

# ---------- 1) 抠出 DATA 里的 assets 大对象 ----------
# 实际形态（JSON 串形式）：..."assets":{"annotated":"data:image/jpeg;base64,..."}...
m = re.search(r'"assets"\s*:\s*\{', src)
if not m:
    raise SystemExit("找不到 assets:{")
i = m.end() - 1
depth = 0
j = i
while j < len(src):
    c = src[j]
    if c == '{':
        depth += 1
    elif c == '}':
        depth -= 1
        if depth == 0:
            break
    j += 1
body = src[i + 1:j]
assets = json.loads("{" + body + "}")
print(f"assets 键数: {len(assets)}  原文件: {orig_len/1024/1024:.2f}MB")

# ---------- 2) 落盘每个 asset ----------
outdir = os.path.join(ROOT, "library", "2025", f"{PID}.assets")
os.makedirs(outdir, exist_ok=True)
for k, v in assets.items():
    safe = re.sub(r'[^A-Za-z0-9._-]', '_', k)
    with open(os.path.join(outdir, safe + ".js"), "w", encoding="utf-8") as f:
        f.write("window.__ekzA(" + json.dumps(k) + "," + json.dumps(v) + ");\n")
total = sum(len(v) for v in assets.values())
print(f"写出 {len(assets)} 个资产文件，共 {total/1024/1024:.2f}MB -> {outdir}")

# ---------- 3) html 瘦身：assets:{...} -> assets:{} + loadAsset ----------
RUNTIME = (
    "window.__ekzA=function(k,v){DATA.assets[k]=v;"
    "var q=window.__ekzW[k];delete window.__ekzW[k];"
    "if(q)q.forEach(function(f){f(v);});};"
    "window.__ekzW={};"
    "function loadAsset(k,cb){"
    "if(DATA.assets[k]){if(cb)cb(DATA.assets[k]);return;}"
    "(window.__ekzW[k]=window.__ekzW[k]||[]).push(function(v){if(cb)cb(v);});"
    "if(document.querySelector('script[data-a=\"'+k+'\"]'))return;"
    "var sc=document.createElement('script');sc.setAttribute('data-a',k);"
    "sc.src='%s.assets/'+k.replace(/[^A-Za-z0-9._-]/g,'_')+'.js';"
    "document.head.appendChild(sc);}"
)
RUNTIME = RUNTIME % PID

new = src[:i + 1] + "}" + src[j + 1:]

# 在 DATA 定义之前插入 runtime（必须在 hydrateAssets 用到 loadAsset 之前）
anchor = "function hydrateAssets"
if anchor in new:
    new = new.replace(anchor, RUNTIME + "\n" + anchor, 1)
else:
    raise SystemExit("找不到 hydrateAssets 锚点")

# ---------- 4) hydrateAssets 改成异步按需加载 ----------
old_hydrate = "function hydrateAssets(root){root.querySelectorAll('img[data-asset]').forEach(img=>{const k=img.dataset.asset;if(DATA.assets[k])img.src=DATA.assets[k]})}"
new_hydrate = ("function hydrateAssets(root){root.querySelectorAll('img[data-asset]').forEach(img=>{"
               "const k=img.dataset.asset;loadAsset(k,function(src){img.src=src;});})}")
if old_hydrate in new:
    new = new.replace(old_hydrate, new_hydrate, 1)
else:
    raise SystemExit("hydrateAssets 形态变了，需人工适配")

open(PAGE, "w", encoding="utf-8").write(new)
print(f"html: {orig_len/1024/1024:.2f}MB -> {len(new)/1024:.0f}KB")

# ---------- 5) 校验 ----------
chk = open(PAGE, encoding="utf-8").read()
assert "base64," not in chk, "仍有 base64 残留"
assert "loadAsset" in chk
print("校验通过：html 内无 base64 残留")
