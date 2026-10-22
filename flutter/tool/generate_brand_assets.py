#!/usr/bin/env python3
"""Generates the Helix brand assets from the source artwork.

The source is `assets/brand/helix_source.png` — the chrome-and-blue twisted
mark on black, with the wordmark and the "LTD" line below it. The mark is the
single source of truth: the launcher icons, the iOS app icon and the in-app
logo are all generated from it, so they can never drift apart.

    python3 tool/generate_brand_assets.py

Requires Pillow. Regenerate after replacing the source artwork.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "brand" / "helix_source.png"
BRAND_DIR = ROOT / "assets" / "brand"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
IOS_ICONS = ROOT / "ios" / "Runner" / "Assets.xcassets" / "AppIcon.appiconset"

# The brand navy — the app's inverse surface, and the background the mark's
# chrome reads best against.
NAVY = (0x0F, 0x17, 0x2A)

# The mark sits between these rows; the wordmark and the "LTD" line are below.
MARK_TOP = 143
MARK_BOTTOM = 931

# A pixel this dark is background, not the mark. The mark's darkest chrome is
# around 32; the background is 0..8. The ramp keeps the edge soft.
BG_LO = 12
BG_HI = 30

ANDROID_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# An adaptive icon is 108dp; only the middle 72dp survives the launcher's
# mask, so the mark has to sit inside that safe zone.
ANDROID_ADAPTIVE_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

# iOS icon sizes: filename -> pixel size.
IOS_SIZES = {
    "Icon-App-20x20@1x.png": 20,
    "Icon-App-20x20@2x.png": 40,
    "Icon-App-20x20@3x.png": 60,
    "Icon-App-29x29@1x.png": 29,
    "Icon-App-29x29@2x.png": 58,
    "Icon-App-29x29@3x.png": 87,
    "Icon-App-40x40@1x.png": 40,
    "Icon-App-40x40@2x.png": 80,
    "Icon-App-40x40@3x.png": 120,
    "Icon-App-60x60@2x.png": 120,
    "Icon-App-60x60@3x.png": 180,
    "Icon-App-76x76@1x.png": 76,
    "Icon-App-76x76@2x.png": 152,
    "Icon-App-83.5x83.5@2x.png": 167,
    "Icon-App-1024x1024@1x.png": 1024,
}


def load_mark() -> Image.Image:
    """Crops the mark out of the source and gives it an alpha channel."""
    src = Image.open(SOURCE).convert("RGB")
    mark = src.crop((0, MARK_TOP, src.width, MARK_BOTTOM)).convert('RGBA')

    pixels = mark.load()
    width, height = mark.size
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            peak = max(r, g, b)
            if peak <= BG_LO:
                alpha = 0
            elif peak >= BG_HI:
                alpha = 255
            else:
                alpha = int(round((peak - BG_LO) / (BG_HI - BG_LO) * 255))
            pixels[x, y] = (r, g, b, alpha)

    # Trim the transparent margin, then centre the mark on a square canvas.
    bbox = mark.getbbox()
    if bbox:
        mark = mark.crop(bbox)
    side = max(mark.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(
        mark,
        ((side - mark.width) // 2, (side - mark.height) // 2),
        mark.getchannel("A"),
    )
    return square


def place(mark: Image.Image, size: int, padding_ratio: float) -> Image.Image:
    """The mark centred on a transparent square canvas."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * (1 - padding_ratio * 2))
    scaled = mark.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(scaled, (offset, offset), scaled.getchannel("A"))
    return canvas


def on_navy(mark: Image.Image, size: int, padding_ratio: float = 0.22) -> Image.Image:
    """The mark on a navy square — the iOS icon, which is masked by the OS."""
    canvas = Image.new("RGBA", (size, size), NAVY + (255,))
    inner = int(size * (1 - padding_ratio * 2))
    scaled = mark.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    canvas.alpha_composite(scaled, (offset, offset))
    return canvas.convert("RGB")


def rounded_icon(mark: Image.Image, size: int, padding_ratio: float = 0.18) -> Image.Image:
    """The legacy launcher icon: a rounded square, so it reads as a badge on a
    launcher that does not support adaptive icons."""
    radius = int(size * 0.22)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    plate = Image.new("RGBA", (size, size), NAVY + (255,))
    mask = Image.new("L", (size, size), 0)
    from PIL import ImageDraw

    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    canvas.paste(plate, (0, 0), mask)
    inner = int(size * (1 - padding_ratio * 2))
    scaled = mark.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    canvas.alpha_composite(scaled, (offset, offset))
    return canvas


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    mark = load_mark()

    # The in-app mark: transparent, square, at a size that stays crisp on a
    # high-density screen.
    app_mark = mark.resize((512, 512), Image.LANCZOS)
    app_mark.save(BRAND_DIR / "helix_mark.png")
    print(f"assets/brand/helix_mark.png  {app_mark.size[0]}x{app_mark.size[1]}")

    for folder, size in ANDROID_SIZES.items():
        target = ANDROID_RES / folder
        target.mkdir(parents=True, exist_ok=True)
        rounded_icon(mark, size).save(target / "ic_launcher.png")
        print(f"{target.relative_to(ROOT)}/ic_launcher.png  {size}x{size}")

    # Adaptive icon: a flat navy background layer and the mark in the safe
    # zone, so the launcher masks it to the device's own shape.
    for folder, size in ANDROID_ADAPTIVE_SIZES.items():
        target = ANDROID_RES / folder
        target.mkdir(parents=True, exist_ok=True)
        place(mark, size, padding_ratio=0.30).save(target / "ic_launcher_foreground.png")
    adaptive = ANDROID_RES / "mipmap-anydpi-v26"
    adaptive.mkdir(parents=True, exist_ok=True)
    (adaptive / "ic_launcher.xml").write_text(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<adaptive-icon xmlns:android=\"http://schemas.android.com/apk/res/android\">\n"
        "    <background android:drawable=\"@color/ic_launcher_background\"/>\n"
        "    <foreground android:drawable=\"@mipmap/ic_launcher_foreground\"/>\n"
        "</adaptive-icon>\n"
    )
    values = ANDROID_RES / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        f"<resources>\n    <color name=\"ic_launcher_background\">#{NAVY[0]:02X}{NAVY[1]:02X}{NAVY[2]:02X}</color>\n</resources>\n"
    )
    print("android adaptive icon layers + background colour")

    IOS_ICONS.mkdir(parents=True, exist_ok=True)
    for name, size in IOS_SIZES.items():
        on_navy(mark, size).save(IOS_ICONS / name)
    print(f"ios AppIcon.appiconset  {len(IOS_SIZES)} files")

    # A splash-sized mark for the launch screen: the mark on the brand navy.
    on_navy(mark, 1024, padding_ratio=0.30).save(BRAND_DIR / "helix_splash.png")
    print("assets/brand/helix_splash.png  1024x1024")

    # A circular badge for the places a round mark belongs — the privacy
    # shield watermark, and any compact brand spot.
    circle = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    from PIL import ImageDraw

    badge = Image.new("RGBA", (512, 512), NAVY + (255,))
    mask = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 511, 511], fill=255)
    circle.paste(badge, (0, 0), mask)
    inner = int(512 * 0.58)
    scaled = mark.resize((inner, inner), Image.LANCZOS)
    offset = (512 - inner) // 2
    circle.alpha_composite(scaled, (offset, offset))
    circle.save(BRAND_DIR / "helix_badge_circle.png")
    print("assets/brand/helix_badge_circle.png  512x512")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
