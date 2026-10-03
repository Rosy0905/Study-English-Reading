# -*- coding: utf-8 -*-
"""复盘页提速（批量版）：新版模板用 DATA.assets + img[data-asset]。

原版 split-review-2025t2.py 只处理 2025-text2 一页，作者这次一口气更新了 8 页，
一篇篇跑太蠢，这里改成扫全库。

原状：每页 4.5~5MB，几乎全是 DATA.assets 里的 base64 大图，打开要等很久。
改后：html 只留几十 KB；DATA.assets 换成空对象 + loadAsset() 按需加载；
      每张图一个小 js（<pid>.assets/<key>.js），内容 window.__ekzA(key,dataURL)。
保留 base64 → file:// 直开 canvas 不污染，导出照常；script 标签不受 CORS 限制。

幂等：已经拆过的（html 里没有 base64,）会跳过。
用法：
    python scripts/split-review-batch.py            # 拆所有待拆的
    python scripts/split-review-batch.py --dry      # 只看会拆哪些
"""
import os, re, json, glob, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "library")
DRY = "--dry" in sys.argv

RUNTIME_TMPL = (
    "window.__ekzA=function(k,v){DATA.assets[k]=v;"
    "var q=window.__ekzW[k];delete window.__ezW[k];"
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

OLD_HYDRATE = ("function hydrateAssets(root){root.querySelectorAll('img[data-asset]')"
               ".forEach(img=>{const k=img.dataset.asset;if(DATA.assets[k])img.src=DATA.assets[k]})}")
NEW_HYDRATE = ("function hydrateAssets(root){root.querySelectorAll('img[data-asset]')"
               ".forEach(img=>{const k=img.dataset.asset;loadAsset(k,function(src){img.src=src;});})}")


def find_assets_block(src):
    """返回 (起始花括号下标, 结束花括号下标, assets 字典)，找不到返回 None。

    两种模板都要认：
      新版  "assets":{"k":"data:..."}      —— DATA.assets + img[data-asset]
      旧版  const ASSETS = {"k":"data:..."}  —— ASSETS 查表
    作者这两批用的是旧版写法（2025-text2 那版才是 data-asset），
    所以两个都得支持，不然会漏掉一半。
    """
    for pat in (r'"assets"\s*:\s*\{', r'const\s+ASSETS\s*=\s*\{'):
        m = re.search(pat, src)
        if not m:
            continue
        i = m.end() - 1
        depth, j = 0, i
        while j < len(src):
            c = src[j]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        else:
            continue
        try:
            assets = json.loads("{" + src[i + 1:j] + "}")
        except Exception:
            continue
        if assets:
            return i, j, assets
    return None


def process(page):
    src = open(page, encoding="utf-8").read()
    pid = os.path.basename(page).replace("-复盘.html", "")
    year = os.path.basename(os.path.dirname(page))

    if "base64," not in src:
        return "skip", pid, "已拆分过"

    found = find_assets_block(src)
    if not found:
        return "skip", pid, "模板不匹配（找不到 assets 对象）"
    i, j, assets = found
    if not assets:
        return "skip", pid, "assets 为空"

    if OLD_HYDRATE not in src:
        return "fail", pid, "hydrateAssets 形态变了，需人工适配"

    total = sum(len(v) for v in assets.values())
    if DRY:
        return "dry", pid, "%d 个资产 / %.1fMB，html %.1fMB" % (
            len(assets), total / 1024 / 1024, len(src) / 1024 / 1024)

    # 落盘
    outdir = os.path.join(LIB, year, pid + ".assets")
    os.makedirs(outdir, exist_ok=True)
    for k, v in assets.items():
        safe = re.sub(r'[^A-Za-z0-9._-]', '_', k)
        with open(os.path.join(outdir, safe + ".js"), "w", encoding="utf-8") as f:
            f.write("window.__ekzA(" + json.dumps(k) + "," + json.dumps(v) + ");\n")

    # html 瘦身
    new = src[:i + 1] + "}" + src[j + 1:]
    runtime = RUNTIME_TMPL % pid
    if "function hydrateAssets" in new:
        new = new.replace("function hydrateAssets", runtime + "\nfunction hydrateAssets", 1)
    else:
        return "fail", pid, "找不到 hydrateAssets 锚点"
    new = new.replace(OLD_HYDRATE, NEW_HYDRATE, 1)

    # 校验：不能有 base64 残留
    if "base64," in new:
        return "fail", pid, "拆分后仍有 base64 残留，已放弃写入"

    open(page, "w", encoding="utf-8").write(new)
    return "ok", pid, "%d 个资产 / %.1fMB，html %.1fMB -> %.0fKB" % (
        len(assets), total / 1024 / 1024, len(src) / 1024 / 1024, len(new) / 1024)


targets = sorted(glob.glob(os.path.join(LIB, "*", "*-复盘.html")))
for page in targets:
    status, pid, msg = process(page)
    mark = {"ok": "拆分", "skip": "跳过", "fail": "失败", "dry": "待拆"}[status]
    print("  %-4s %-14s %s" % (mark, pid, msg))

print()
print("（加 --dry 可以先看一遍再动手）")
