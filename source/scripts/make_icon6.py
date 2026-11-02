from PIL import Image, ImageFilter, ImageDraw
import numpy as np

SRC = "/Users/chenweiyong/Downloads/watermark_removed/new_logo.png"
OUT_ICON = "/tmp/taskflow-app/build/icon.png"
OUT_ICONSET = "/tmp/icon6.iconset"

img = Image.open(SRC).convert("RGBA")
w, h = img.size
print("src size", img.size)

# ---- 自动定位图标硬边：找与白底差异明显的像素 bbox ----
a = np.asarray(img).astype(int)
rgb = a[:, :, :3]
alpha = a[:, :, 3]
dist = 255 - rgb.min(axis=2)  # 距白的近似距离
mask = (dist > 14) & (alpha > 40)
ys, xs = np.where(mask)
L, T, R, B = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
print("auto bbox", L, T, R, B, "size", R - L + 1, B - T + 1)

# 行/列密度峰值复核：打印边缘附近密度，防止把浅色玻璃边裁掉
col = mask.sum(axis=0)
row = mask.sum(axis=1)
print("col density near L:", col[L:L + 6].tolist())
print("row density near T:", row[T:T + 6].tolist())

# 收进 1px 避开柔光/描边外的残留
sq = img.crop((L + 1, T + 1, R, B))
print("crop", sq.size)

# 归一为正方形
side = max(sq.size)
if sq.size != (side, side):
    sq = sq.resize((side, side), Image.LANCZOS)

# 圆角遮罩（Apple 近似超椭圆 22.5%），内缩 1px 切掉边缘残留
inset = 1
m = Image.new("L", (side, side), 0)
d = ImageDraw.Draw(m)
d.rounded_rectangle([inset, inset, side - 1 - inset, side - 1 - inset],
                    radius=int(side * 0.225), fill=255)
m = m.filter(ImageFilter.GaussianBlur(0.8))
sq.putalpha(m)

# macOS 画布：内容占 82.4%
canvas = 1024
target = int(canvas * 0.824)
resized = sq.resize((target, target), Image.LANCZOS)
icon = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
icon.paste(resized, ((canvas - target) // 2, (canvas - target) // 2), resized)
icon.save(OUT_ICON)

# 顶栏品牌图（与现资源同名替换）
sq.resize((128, 128), Image.LANCZOS).save("/tmp/app-logo.png")
sq.resize((256, 256), Image.LANCZOS).save("/tmp/app-logo@2x.png")

# iconset → icns
import os, subprocess
os.makedirs(OUT_ICONSET, exist_ok=True)
sizes = [16, 32, 64, 128, 256, 512, 1024]
for s in sizes:
    icon.resize((s, s), Image.LANCZOS).save(f"{OUT_ICONSET}/icon_{s}x{s}.png")
subprocess.run([
    "iconutil", "-c", "icns", OUT_ICONSET,
    "-o", "/tmp/taskflow-app/build/icon.icns",
], check=True)

# 预览：明暗底 + 底部放大（检查白边残留）
for name, bg in [("p6_light", (240, 240, 245)), ("p6_dark", (28, 28, 34))]:
    p = Image.new("RGB", (canvas, canvas), bg)
    p.paste(icon, (0, 0), icon)
    p.save(f"/tmp/{name}.png")
    crop = p.crop((0, int(canvas * 0.82), canvas, canvas)).resize(
        (canvas, int(canvas * 0.18 * 2)), Image.NEAREST)
    crop.save(f"/tmp/{name}_bottom_zoom.png")
print("ok")
