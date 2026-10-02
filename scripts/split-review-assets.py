# -*- coding: utf-8 -*-
"""复盘页提速：把内嵌 ASSETS 大对象拆成按需加载的资产文件。

原状：每篇复盘 html 4.5~6.4MB，几乎全是 const ASSETS={...} 里的 base64 大图，
页面一打开就要下载整个巨石文档（GitHub Pages 上转半天）。

改后：html 只剩几十 KB；ASSETS 换成空对象 + loadAsset() 按需加载；
每个资产 key 一个小 js 文件（<pid>.assets/<key>.js，内容 window.__ekzA(key,dataURL)）。
保留 base64 形式 → file:// 直开 canvas 不污染，导出照常；script 标签不受 CORS 限制。
首次打开只下载当前步骤需要的 1~2 张图，速度提升约 10 倍。

使用点替换规则（按顺序应用，处理前先统计、处理后校验残留）：
  P4 存在性检查  !ASSETS[ctx.asset]        → !ASSET_KEYS.includes(ctx.asset)
  P2 带complete  X.src=ASSETS[ctx.asset];(含complete检查,可跨行)
  P1 hydrate     const src=ASSETS[K];if(src...*.src=src;
  P3 plain 赋值  X.src=ASSETS[ctx.asset];（P2 没吃掉的）
校验：处理后 re.findall(r'ASSETS\[', src) 应恰为 2 处（loadAsset 定义内部）。
"""
import os, re, json, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {"2025-text2-复盘.html"}  # 新版模板无 ASSETS，另行处理

RUNTIME = (
    "const ASSETS={};const __ekzW={};\n"
    "window.__ekzA=function(k,v){ASSETS[k]=v;var q=__ekzW[k];delete __ekzW[k];"
    "if(q)q.forEach(function(f){f(v);});};\n"
    "const ASSET_KEYS=%s;\n"
    "function loadAsset(k,cb){"
    "if(ASSETS[k]){if(cb)cb(ASSETS[k]);return Promise.resolve(ASSETS[k]);}"
    "return new Promise(function(res){(__ekzW[k]=__ekzW[k]||[]).push(function(v){if(cb)cb(v);res(v);});"
    "var s=document.createElement('script');s.src='%s/'+k+'.js';document.head.appendChild(s);});}"
)

SUBS = [
    # P4 存在性检查（2011 系列）
    (re.compile(r"!ASSETS\[ctx\.asset\]"),
     r"!ASSET_KEYS.includes(ctx.asset)"),
    # P2 带同语句 complete 检查（2017 多行 / 2010t4 单行，\s* 兼容两种）
    (re.compile(r"(\w+)\.src=ASSETS\[ctx\.asset\];\s*if\(\1\.complete\)([^;\n]*?\);)",
                re.S),
     r"loadAsset(ctx.asset,function(src){\1.src=src;if(\1.complete)\2});"),
    # P1 hydrate（const src=ASSETS[K];换行缩进可调;if(src...)*.src=src[;可选]）
    (re.compile(r"const src=ASSETS\[([\w.]+)\];\s*(if\(src[^\n;]*?\.src=src;?)"),
     r"loadAsset(\1,function(src){\2});"),
    # P3 plain 赋值（2011 系列，后续 imageReady 自然等待 load）
    (re.compile(r"(\w+)\.src=ASSETS\[ctx\.asset\];"),
     r"loadAsset(ctx.asset,function(src){\1.src=src;});"),
    # P5 同步渲染的入口检查（2010t1/t2：mode 检查后取 src 判空 return）
    (re.compile(r"if\(ctx\.mode!=='image'\)return;\s*const src=ASSETS\[ctx\.asset\]; if\(!src\)return;"),
     r"if(ctx.mode!=='image'||!ASSET_KEYS.includes(ctx.asset))return;"),
    # P6 同步渲染的赋值点（2010t1/t2：img.src=src; 紧跟 const place=）
    (re.compile(r"img\.src=src;(\s*const place=)"),
     r"loadAsset(ctx.asset,function(v){img.src=v;});\1"),
]

def extract_assets(src):
    """括号深度匹配提取 const ASSETS = {...}; 返回 (dict, start, end_excl_semi)"""
    i = src.index("const ASSETS")
    j = src.index("{", i)
    depth = 0
    k = j
    while k < len(src):
        c = src[k]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        k += 1
    obj = json.loads(src[j:k + 1])
    return obj, i, k + 1

def process(path):
    pid = os.path.basename(path).replace("-复盘.html", "")
    year = os.path.basename(os.path.dirname(path))
    src = open(path, encoding="utf-8").read()
    obj, i, end = extract_assets(src)
    # 跳过分号
    if src[end] == ";":
        end += 1
    # 资产 key 必须是安全文件名
    for key in obj:
        if not re.fullmatch(r"\w+", key):
            raise ValueError(f"不安全的资产 key: {key!r}")
    outdir = os.path.join(ROOT, "library", year, pid + ".assets")
    os.makedirs(outdir, exist_ok=True)
    for key, dataurl in obj.items():
        with open(os.path.join(outdir, key + ".js"), "w", encoding="utf-8") as f:
            f.write('window.__ekzA("%s",%s);' % (key, json.dumps(dataurl)))
    # 替换定义
    new_src = src[:i] + (RUNTIME % (json.dumps(list(obj)), pid + ".assets")) + src[end:]
    # 应用使用点替换
    for pat, rep in SUBS:
        new_src = pat.sub(rep, new_src)
    # 校验残留：只允许 runtime 块里的 4 处 ASSETS[k]（__ekzA 赋值 1 + loadAsset 3）
    residual = re.findall(r"ASSETS\[", new_src)
    if len(residual) != 4:
        raise ValueError(f"替换不干净：残留 ASSETS[ 访问 {len(residual) - 4} 处")
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    return len(obj), os.path.getsize(path)

def main():
    files = sorted(glob.glob(os.path.join(ROOT, "library", "*", "*-复盘.html")))
    ok = fail = 0
    for path in files:
        name = os.path.basename(path)
        if name in SKIP:
            print(f"SKIP  {name}（新模板另行处理）")
            continue
        old_kb = os.path.getsize(path) // 1024
        try:
            n, new_size = process(path)
            print(f"OK    {name}  {old_kb}KB -> {new_size // 1024}KB  资产 {n} 个")
            ok += 1
        except Exception as e:
            print(f"FAIL  {name}  {e}")
            fail += 1
    print(f"\n完成 {ok} 篇，失败 {fail} 篇")

if __name__ == "__main__":
    main()
