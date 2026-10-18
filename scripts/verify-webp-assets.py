# -*- coding: utf-8 -*-
"""验证 png2webp-assets 的改动：逐张比对像素、尺寸、非图片字节"""
import base64, glob, io, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAK = r'D:\WB工作记录\英语项目\_backup_20261018_webp'
PAT = re.compile(rb'data:image/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)')

def body(b, m):
    return b[:m.start()], b[m.end():]

files = sorted(glob.glob(os.path.join(ROOT, 'library', '*', '*.assets', '*.js')))
conv = same = 0; bad = []
for f in files:
    y = os.path.basename(os.path.dirname(os.path.dirname(f)))
    rel = os.path.join(y, os.path.basename(os.path.dirname(f)), os.path.basename(f))
    bk = os.path.join(BAK, rel)
    if not os.path.exists(bk):
        bad.append((rel, '备份缺失')); continue
    nb, ob = open(f, 'rb').read(), open(bk, 'rb').read()
    nm, om = PAT.search(nb), PAT.search(ob)
    if not nm or not om:
        bad.append((rel, '找不到 dataURL')); continue
    fmt_o = om.group(1).decode()
    fmt_n = nm.group(1).decode()
    raw_n = base64.b64decode(nm.group(2) + b'=' * (-len(nm.group(2)) % 4))
    raw_o = base64.b64decode(om.group(2) + b'=' * (-len(om.group(2)) % 4))
    if fmt_o != 'png':
        # 未转的文件必须原样未动
        if nb != ob: bad.append((rel, '非 PNG 文件被改动'))
        else: same += 1
        continue
    if fmt_n != 'webp': bad.append((rel, 'mime 未改')); continue
    if raw_n[:4] != b'RIFF' or raw_n[8:12] != b'WEBP':
        bad.append((rel, '不是真 WebP')); continue
    io_n, io_o = Image.open(io.BytesIO(raw_n)), Image.open(io.BytesIO(raw_o))
    if io_n.size != io_o.size:
        bad.append((rel, f'尺寸 {io_o.size}→{io_n.size}')); continue
    if io_n.convert('RGBA').tobytes() != io_o.convert('RGBA').tobytes():
        bad.append((rel, '像素不一致')); continue
    hn, tn = body(nb, nm); ho, to = body(ob, om)
    if hn != ho or tn != to:
        bad.append((rel, '图片以外字节变了')); continue
    conv += 1

print(f'文件总数 {len(files)}')
print(f'已转 WebP 且像素一致 {conv}')
print(f'未转（webp/jpeg）原样未动 {same}')
print(f'异常 {len(bad)}')
for r, why in bad[:10]:
    print('  ✗', r, why)

left = 0
for f in files:
    left += len(re.findall(rb'data:image/png;base64,', open(f, 'rb').read()))
print('全库残留 data:image/png 处数:', left)
sys.exit(1 if bad or left else 0)
