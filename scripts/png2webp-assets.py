# -*- coding: utf-8 -*-
"""png2webp-assets.py · 复盘页资产图 PNG → WebP（无损，尺寸不变）

只改 dataURL 的 mime 前缀与像素数据，JS 一行不动：
  window.__ekzA("key","data:image/png;base64,....");
                     ↓
  window.__ekzA("key","data:image/webp;base64,....");

为什么要无损且不改尺寸：步骤取景用绝对像素坐标（focus:[x,y,w,h] + sourceW），
靠 img.clientWidth/sourceW 换算，不读 naturalWidth，所以只要宽高不变就不会错位。

幂等：只处理 data:image/png，已是 webp 的跳过。
原子：先写 .tmp 再 rename，中途中断不会留半截文件。
"""
import base64, glob, re, io, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAT = re.compile(rb'data:image/png;base64,([A-Za-z0-9+/=]+)')

def convert(path, dry=False):
    b = open(path, 'rb').read()
    ms = list(PAT.finditer(b))
    if not ms:
        return None
    assert len(ms) == 1, f'{path}: 出现 {len(ms)} 处 base64，预期 1'
    m = ms[0]
    b64 = m.group(1)
    raw = base64.b64decode(b64 + b'=' * (-len(b64) % 4))
    im = Image.open(io.BytesIO(raw))
    px0 = im.convert('RGBA').tobytes()
    o = io.BytesIO()
    im.save(o, 'WEBP', lossless=True, quality=100, method=4)
    d = o.getvalue()
    back = Image.open(io.BytesIO(d))
    assert back.size == im.size, f'{path}: 尺寸变了'
    assert back.convert('RGBA').tobytes() == px0, f'{path}: 像素不一致'
    new_b64 = base64.b64encode(d)
    head, tail = b[:m.start()], b[m.end():]
    out = head + b'data:image/webp;base64,' + new_b64 + tail
    # 结构等价：除 dataURL 主体外，一个字节都不能变
    pre = b'data:image/webp;base64,'
    assert out[:len(head)] == head, f'{path}: 前缀被改'
    assert out[len(out) - len(tail):] == tail, f'{path}: 后缀被改'
    assert out[len(head):len(out) - len(tail)] == pre + new_b64, f'{path}: 数据主体不符'
    assert len(out) == len(head) + len(pre) + len(new_b64) + len(tail), f'{path}: 长度不符'
    if not dry:
        tmp = path + '.tmp'
        open(tmp, 'wb').write(out)
        os.replace(tmp, path)
    return (im.size, len(raw), len(d))

def convert_do_html(path, dry=False):
    """做题页内嵌图（一篇 2 张，文章页 + 题目页）PNG → 无损 WebP。

    做题页和复盘页不一样：图直接内嵌在 HTML 里、可能有 2 处 base64，
    所以不能套上面的 convert()（它 assert 只有 1 处）。
    每张图都做像素级校验，尺寸或像素不一致直接抛错，不写文件。
    """
    b = open(path, 'rb').read()
    ms = list(PAT.finditer(b))
    if not ms:
        return None
    out = bytearray()
    last = 0
    before = after = 0
    for m in ms:
        b64 = m.group(1)
        raw = base64.b64decode(b64 + b'=' * (-len(b64) % 4))
        im = Image.open(io.BytesIO(raw))
        px0 = im.convert('RGBA').tobytes()
        o = io.BytesIO()
        im.save(o, 'WEBP', lossless=True, quality=100, method=4)
        d = o.getvalue()
        back = Image.open(io.BytesIO(d))
        assert back.size == im.size, f'{path}: 尺寸变了'
        assert back.convert('RGBA').tobytes() == px0, f'{path}: 像素不一致'
        out += b[last:m.start()]
        out += b'data:image/webp;base64,' + base64.b64encode(d)
        last = m.end()
        before += len(raw)
        after += len(d)
    out += b[last:]
    if not dry:
        tmp = path + '.tmp'
        open(tmp, 'wb').write(bytes(out))
        os.replace(tmp, path)
    return (len(ms), before, after)


if __name__ == '__main__':
    dry = '--dry' in sys.argv
    files = sorted(glob.glob(os.path.join(ROOT, 'library', '*', '*.assets', '*.js')))
    done = skip = 0; a = c = 0; worst = []
    for f in files:
        r = convert(f, dry)
        if r is None:
            skip += 1; continue
        (w, h), o1, o2 = r
        done += 1; a += o1; c += o2
        if o2 / o1 > 0.7:
            worst.append((o2 / o1, os.path.relpath(f, ROOT), o1, o2))
        if done % 40 == 0:
            print(f'  {done} 张 … 已省 {(a-c)/1024/1024:.1f}MB', flush=True)
    print(f'\n转换 {done} 张，跳过 {skip} 个（已是 webp/jpeg）')
    if a:
        print(f'体积 {a/1024/1024:.1f}MB → {c/1024/1024:.1f}MB，省 {(1-c/a)*100:.0f}%')
    for r, p, o1, o2 in sorted(worst)[-5:]:
        print(f'  最差 {p}: {o1/1024:.0f}K → {o2/1024:.0f}K ({r*100:.0f}%)')

    # 做题页内嵌图：同一批图片，只是直接打在 HTML 里（一篇 2 张）
    do_files = sorted(glob.glob(os.path.join(ROOT, 'library', '*', '*-做题.html')))
    do_done = do_skip = 0
    da = dc = 0
    for f in do_files:
        r = convert_do_html(f, dry)
        if r is None:
            do_skip += 1
            continue
        n, o1, o2 = r
        do_done += 1
        da += o1
        dc += o2
        print(f'  做题页 {os.path.basename(f)}: {n} 张 {o1/1024:.0f}K → {o2/1024:.0f}K', flush=True)
    if do_done:
        print(f'\n做题页转换 {do_done} 篇，跳过 {do_skip} 篇（已是 webp）')
        print(f'内嵌图体积 {da/1024/1024:.1f}MB → {dc/1024/1024:.1f}MB，省 {(1-dc/da)*100:.0f}%')
    else:
        print(f'\n做题页全部已是 webp，跳过 {do_skip} 篇')
