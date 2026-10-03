# 2019 t2 拼接对比图 v2：左右并排（复刻做题页布局），紧凑
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"D:\WB工作记录\英语项目\英语真题阅读资料库"
LIB = os.path.join(ROOT, "library", "2019")
OUT = os.path.join(ROOT, ".probe")
os.makedirs(OUT, exist_ok=True)

ART = os.path.join(LIB, "2019-text2-article.png")
QUE = os.path.join(LIB, "2019-text2-question.png")

VARIANTS = [
    ("原样", None, None),
    ("题 顺0.20", -0.20, None),
    ("题 顺0.39 (扶正)", -0.39, None),
    ("题 顺0.30", -0.30, None),
    ("两页都扶正", -0.39, 0.49),
]

# 取你截图里的那块：文章页开头几段 + 题目页 26-30 题
A_BAND = (0.055, 0.235)
Q_BAND = (0.030, 0.210)

try:
    fnt = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
except Exception:
    fnt = ImageFont.load_default()

SCALE = 0.50
GAP = 14
LAB_H = 34
PAD = 12


def band(im, y0r, y1r):
    w, h = im.size
    y0, y1 = int(h * y0r), int(h * y1r)
    x0 = int((w - w * 0.84) / 2)
    return im.crop((x0, y0, w - x0, y1))


# 先算单段尺寸
tiles = []
for lab, qa, aa in VARIANTS:
    a = Image.open(ART).convert("RGB")
    q = Image.open(QUE).convert("RGB")
    if aa is not None:
        a = a.rotate(aa, resample=Image.BICUBIC, fillcolor=(255, 255, 255))
    if qa is not None:
        q = q.rotate(qa, resample=Image.BICUBIC, fillcolor=(255, 255, 255))
    ab = band(a, *A_BAND); qb = band(q, *Q_BAND)
    tw = int(ab.width * SCALE)
    ab = ab.resize((tw, int(ab.height * SCALE)), Image.LANCZOS)
    qb = qb.resize((tw, int(qb.height * SCALE)), Image.LANCZOS)
    tiles.append((lab, ab, qb))

pair_w = tiles[0][1].width * 2 + GAP
band_h = max(t[1].height for t in tiles)
seg_h = LAB_H + band_h
W = pair_w + PAD * 2
H = PAD * 2 + 34 + len(tiles) * (seg_h + GAP)

canvas = Image.new("RGB", (W, H), (252, 252, 254))
d = ImageDraw.Draw(canvas)

y = PAD
d.text((PAD, y), "左=文章页   右=题目页   （复刻做题页并排布局，红线为水平参考）",
       font=fnt, fill=(20, 20, 30))
y += 34

for i, (lab, ab, qb) in enumerate(tiles):
    hl = (i == 2)
    d.rectangle([PAD - 3, y, W - PAD + 3, y + LAB_H - 6],
                fill=(218, 242, 224) if hl else (238, 233, 249))
    d.text((PAD + 4, y + 4), f"{i+1}. {lab}", font=fnt, fill=(20, 20, 30))
    y += LAB_H

    for j, im in enumerate((ab, qb)):
        x = PAD + j * (im.width + GAP)
        canvas.paste(im, (x, y))
        ly = y + int(im.height * 0.5)
        d.line([(x, ly), (x + im.width, ly)], fill=(220, 50, 50), width=1)
    y += band_h + GAP

fp = os.path.join(OUT, "cmp2019t2_pair.png")
canvas.save(fp)
print("已生成", fp, canvas.size)
