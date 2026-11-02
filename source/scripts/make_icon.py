"""从一张正方形 logo 源图生成应用图标（macOS .icns / 通用 .png / 应用内 logo）。

用法:
    python3 scripts/make_icon.py [源图路径]

默认源图: /Users/chenweiyong/Downloads/watermark_removed/Sloth.png
输出:
    build/icon.png          (1024, 供 Windows 及通用使用)
    build/icon.icns         (macOS)
    src/assets/app-logo.png (应用内品牌图, 256)
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else "/Users/chenweiyong/Downloads/watermark_removed/Sloth.png"
BUILD = os.path.join(ROOT, "build")
OUT_ICON = os.path.join(BUILD, "icon.png")
OUT_ICNS = os.path.join(BUILD, "icon.icns")
OUT_LOGO = os.path.join(ROOT, "src/assets/app-logo.png")
ICONSET = "/tmp/sloth.iconset"


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    print("src:", SRC, img.size)

    # 自动定位硬边：找与白底差异明显的像素 bbox
    a = np.asarray(img).astype(int)
    rgb, alpha = a[:, :, :3], a[:, :, 3]
    dist = 255 - rgb.min(axis=2)
    mask = (dist > 14) & (alpha > 40)
    ys, xs = np.where(mask)
    L, T, R, B = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    print("content bbox:", L, T, R, B, "size", R - L + 1, B - T + 1)

    # 收进 1px 避开柔光/描边外残留，并归一为正方形
    sq = img.crop((L + 1, T + 1, R, B))
    side = max(sq.size)
    if sq.size != (side, side):
        sq = sq.resize((side, side), Image.LANCZOS)

    # 圆角遮罩（Apple 近似超椭圆 22.5%）
    inset = 1
    m = Image.new("L", (side, side), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle(
        [inset, inset, side - 1 - inset, side - 1 - inset],
        radius=int(side * 0.225),
        fill=255,
    )
    m = m.filter(ImageFilter.GaussianBlur(0.8))
    sq.putalpha(m)

    # 应用内品牌图（已是圆角正方形，界面里再叠加 CSS 圆角）
    os.makedirs(os.path.dirname(OUT_LOGO), exist_ok=True)
    sq.resize((256, 256), Image.LANCZOS).save(OUT_LOGO)
    print("wrote:", OUT_LOGO)

    # 应用图标：macOS 画布内容占 82.4%
    canvas = 1024
    target = int(canvas * 0.824)
    resized = sq.resize((target, target), Image.LANCZOS)
    icon = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    icon.paste(resized, ((canvas - target) // 2, (canvas - target) // 2), resized)
    os.makedirs(BUILD, exist_ok=True)
    icon.save(OUT_ICON)
    print("wrote:", OUT_ICON)

    # iconset -> icns（使用 iconutil 认可的标准命名）
    os.makedirs(ICONSET, exist_ok=True)
    for name, size in [
        ("icon_16x16", 16),
        ("icon_16x16@2x", 32),
        ("icon_32x32", 32),
        ("icon_32x32@2x", 64),
        ("icon_128x128", 128),
        ("icon_128x128@2x", 256),
        ("icon_256x256", 256),
        ("icon_256x256@2x", 512),
        ("icon_512x512", 512),
        ("icon_512x512@2x", 1024),
    ]:
        icon.resize((size, size), Image.LANCZOS).save(f"{ICONSET}/{name}.png")
    subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", OUT_ICNS], check=True)
    print("wrote:", OUT_ICNS)


if __name__ == "__main__":
    main()
