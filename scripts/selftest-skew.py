#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""selftest-skew.py · 验证 measure-skew3 的角度测量是否可信

做法：拿一张已知"正"的图，人为旋转已知角度，再用同一套算法测回来，
看误差。误差小才敢拿它的输出当依据。
"""
import os, sys, importlib.util
import numpy as np
from PIL import Image

# 文件名带连字符（measure-skew.py），不能直接 import，按路径加载
_spec = importlib.util.spec_from_file_location(
    "msk", os.path.join(os.path.dirname(os.path.abspath(__file__)), "measure-skew.py"))
_msk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_msk)
sharpness, INK, STEP, RANGE = _msk.sharpness, _msk.INK, _msk.STEP, _msk.RANGE

LIB = r"D:\WB工作记录\英语项目\英语真题阅读资料库\library"


def measure(im):
    ths = np.arange(-RANGE, RANGE + 1e-9, STEP)
    sc = [sharpness(np.array(im.rotate(-t, resample=Image.BILINEAR, fillcolor=255)) < INK)
          for t in ths]
    return ths[int(np.argmax(sc))]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else r"2019\2019-text4-article.png"
    im = Image.open(os.path.join(LIB, src)).convert("L")
    im = im.resize((im.width // 2, im.height // 2), Image.BILINEAR)
    print(f"基准图 {src}（测量工具判定其为 0.00° 正）\n")
    print(f"{'人为旋转':>10}{'测回':>10}{'误差':>8}")
    print("-" * 32)
    errs = []
    for truth in [0.0, 0.2, -0.2, 0.35, -0.35, 0.5, -0.5, 0.7, -0.7]:
        rot = im.rotate(truth, resample=Image.BILINEAR, fillcolor=255)
        got = measure(rot)
        # 图被转了 truth，要转回正就得再转 truth，所以 measure 应返回 ≈ truth
        err = got - truth
        errs.append(abs(err))
        print(f"{truth:>+10.2f}{got:>+10.2f}{err:>8.2f}")
    print(f"\n最大误差 {max(errs):.2f}°，平均 {sum(errs)/len(errs):.2f}°")


if __name__ == "__main__":
    main()
