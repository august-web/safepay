#!/usr/bin/env python3
"""Generate every SafePay launcher/app icon from the master brand artwork.

Why this exists
---------------
The Android launcher does **not** read `app.json`; it reads the mipmaps in
`android/app/src/main/res/`. While those were still Expo's template defaults,
the phone showed a blue Expo glyph instead of our logo.

`/android` is gitignored, so `assets/*.png` + `app.json` are the real source of
truth and `expo prebuild` regenerates the res from them. This script produces
those committed assets (and, for convenience, the same mipmaps directly, so a
plain `npm run apk` picks them up without a prebuild). Either path ends at the
same artwork, from the team's brand files only.

Inputs (both are the team's own brand files, committed in `assets/`):
  assets/safepay-logo-transparent.png  - full lockup: dot-symbol + "SafePay"
  assets/safepay-symbol.png            - the dot-symbol on its own

Outputs
  assets/icon.png                      - iOS / store / legacy fallback (opaque)
  assets/android-icon-*.png            - adaptive-icon layers (Android 8+)
  assets/favicon.png                   - web
  android/app/src/main/res/mipmap-*/   - what the launcher actually renders

Android adaptive-icon geometry, for the record: the foreground layer is a
108dp canvas, but the launcher only guarantees a **66dp circle** (and a 72dp
visible area) survives masking. A dot-symbol whose dots sit at the extremes of
its bounding box cannot be centred by eye, so the symbol is scaled so that its
furthest ink pixel lands inside SAFE_RADIUS. That is why the glyph looks
"small" on the canvas: everything outside that circle is at the mercy of the
launcher's squircle/circle mask.

Usage
  python3 scripts/generate-icons.py            # write the real assets
  python3 scripts/generate-icons.py --preview  # render a true-size review sheet
Requires Pillow (pip install pillow).
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
ANDROID_RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

# Brand navy: the exact ink colour of the master logo (#161273).
BRAND_NAVY = (22, 18, 115)
WHITE = (255, 255, 255)

# Adaptive-icon safe circle: 66dp of a 108dp canvas, as a fraction of the side.
SAFE_RADIUS = 33.0 / 108.0

# Android density buckets: drawable size per dp for launcher and adaptive layers.
DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}
LAUNCHER_DP = 48
ADAPTIVE_DP = 108

SUPERSAMPLE = 4  # mask anti-aliasing factor


@dataclass(frozen=True)
class Glyph:
    """A cropped, transparent-background piece of brand artwork."""

    image: Image.Image  # RGBA, tight-cropped to the ink
    ink_radius: float   # furthest ink pixel from the crop centre, in px

    @property
    def size(self) -> tuple[int, int]:
        return self.image.size


def load_ink(path: str) -> Glyph:
    """Tight-crop an RGBA brand asset to its ink and measure its radial extent."""
    img = Image.open(path).convert("RGBA")
    alpha = img.split()[3]
    bbox = alpha.getbbox()
    if bbox is None:
        raise SystemExit(f"{path} is fully transparent - nothing to draw")
    img = img.crop(bbox)
    w, h = img.size
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    radius = 0.0
    # Row-scan the alpha channel; solid dots mean this stays cheap.
    px = img.split()[3].load()
    for y in range(h):
        for x in range(w):
            if px[x, y] > 8:
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                if d > radius:
                    radius = d
    return Glyph(img, radius)


def recolour(glyph: Glyph, colour: tuple[int, int, int]) -> Image.Image:
    """Flatten a glyph to a single colour, keeping its alpha (for monochrome/tint)."""
    out = Image.new("RGBA", glyph.size, colour + (255,))
    out.putalpha(glyph.image.split()[3])
    return out


def scaled_for_safe_circle(glyph: Glyph, canvas: int, fill: float = 1.0) -> tuple[int, int]:
    """Size the glyph so its furthest ink sits inside the safe circle."""
    target = SAFE_RADIUS * canvas * fill
    factor = target / glyph.ink_radius
    return (max(1, round(glyph.size[0] * factor)), max(1, round(glyph.size[1] * factor)))


def paste_centred(canvas: Image.Image, layer: Image.Image) -> None:
    x = (canvas.size[0] - layer.size[0]) // 2
    y = (canvas.size[1] - layer.size[1]) // 2
    canvas.alpha_composite(layer, (x, y))


def make_adaptive_foreground(mark: Glyph, canvas: int) -> Image.Image:
    """White symbol on transparency - the layer masked over the navy tile."""
    glyph = recolour(mark, WHITE)
    glyph = glyph.resize(scaled_for_safe_circle(mark, canvas, fill=0.98), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    paste_centred(out, glyph)
    return out


def make_monochrome(mark: Glyph, canvas: int) -> Image.Image:
    """Themed-icon layer: shape comes from alpha, so colour is irrelevant."""
    return make_adaptive_foreground(mark, canvas)


def make_tile(mark: Glyph, canvas: int) -> Image.Image:
    """Legacy launcher icon: navy tile + white symbol (pre-Android-8 slots)."""
    out = Image.new("RGBA", (canvas, canvas), BRAND_NAVY + (255,))
    paste_centred(out, make_adaptive_foreground(mark, canvas))
    return out


def make_opaque_icon(lockup: Glyph, canvas: int, fill: float = 0.78) -> Image.Image:
    """The full lockup (symbol + wordmark) on white, for iOS/store."""
    out = Image.new("RGBA", (canvas, canvas), WHITE + (255,))
    w, h = lockup.size
    factor = (canvas * fill) / w
    glyph = lockup.image.resize((round(w * factor), round(h * factor)), Image.LANCZOS)
    paste_centred(out, glyph)
    return out


def write_png(image: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.convert("RGBA").save(path, "PNG", optimize=True)
    rel = os.path.relpath(path, ROOT)
    print(f"  {rel:44s} {image.size[0]}x{image.size[1]}")


def write_webp(image: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.convert("RGBA").save(path, "WEBP", quality=100, method=6)
    print(f"  {os.path.relpath(path, ROOT):44s} {image.size[0]}x{image.size[1]}")


def generate() -> None:
    mark = load_ink(os.path.join(ASSETS, "safepay-symbol.png"))
    lockup = load_ink(os.path.join(ASSETS, "safepay-logo-transparent.png"))
    print(f"symbol ink radius {mark.ink_radius:.0f}px of {mark.size}, lockup {lockup.size}")

    print("assets/")
    write_png(make_opaque_icon(lockup, 1024), os.path.join(ASSETS, "icon.png"))
    write_png(make_adaptive_foreground(mark, 1024), os.path.join(ASSETS, "android-icon-foreground.png"))
    flat_bg = Image.new("RGBA", (1024, 1024), BRAND_NAVY + (255,))
    write_png(flat_bg, os.path.join(ASSETS, "android-icon-background.png"))
    write_png(make_monochrome(mark, 1024), os.path.join(ASSETS, "android-icon-monochrome.png"))
    write_png(make_opaque_icon(mark, 48, fill=0.82), os.path.join(ASSETS, "favicon.png"))

    print("android mipmaps/")
    for bucket, factor in DENSITIES.items():
        folder = os.path.join(ANDROID_RES, f"mipmap-{bucket}")
        launcher = round(LAUNCHER_DP * factor)
        adaptive = round(ADAPTIVE_DP * factor)
        tile = make_tile(mark, launcher)
        write_webp(tile, os.path.join(folder, "ic_launcher.webp"))
        write_webp(tile, os.path.join(folder, "ic_launcher_round.webp"))
        write_webp(make_adaptive_foreground(mark, adaptive), os.path.join(folder, "ic_launcher_foreground.webp"))
        write_webp(Image.new("RGBA", (adaptive, adaptive), BRAND_NAVY + (255,)), os.path.join(folder, "ic_launcher_background.webp"))
        write_webp(make_monochrome(mark, adaptive), os.path.join(folder, "ic_launcher_monochrome.webp"))


# --------------------------------------------------------------------------
# Review sheet: what the launcher will actually show, at true pixel sizes.
# --------------------------------------------------------------------------


def mask_squircle(size: int, exponent: float = 4.0) -> Image.Image:
    n = size * SUPERSAMPLE
    mask = Image.new("L", (n, n), 0)
    px = mask.load()
    c = (n - 1) / 2.0
    for y in range(n):
        for x in range(n):
            dx, dy = abs(x - c) / c, abs(y - c) / c
            if dx ** exponent + dy ** exponent <= 1.0:
                px[x, y] = 255
    return mask.resize((size, size), Image.LANCZOS)


def mask_circle(size: int) -> Image.Image:
    n = size * SUPERSAMPLE
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, n - 1, n - 1], fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def mask_rounded(size: int, radius: float = 0.22) -> Image.Image:
    n = size * SUPERSAMPLE
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=n * radius, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def apply_mask(image: Image.Image, mask: Image.Image) -> Image.Image:
    out = image.copy()
    out.putalpha(mask)
    return out


def preview() -> None:
    """Render candidates at the size a launcher really draws them (48dp @ 3x)."""
    mark = load_ink(os.path.join(ASSETS, "safepay-symbol.png"))
    lockup = load_ink(os.path.join(ASSETS, "safepay-logo-transparent.png"))
    size = 144  # 48dp at xxhdpi - the TECNO's density
    pad, label_h = 34, 0
    walls = {"light": (242, 240, 235, 255), "dark": (24, 24, 32, 255)}

    safe = make_adaptive_foreground(mark, size)
    navy_tile = apply_mask(make_tile(mark, size), mask_squircle(size))
    white_tile = Image.new("RGBA", (size, size), WHITE + (255,))
    white_tile.alpha_composite(Image.new("RGBA", (size, size), (0, 0, 0, 0)))
    white_mark = recolour(mark, BRAND_NAVY).resize(
        scaled_for_safe_circle(mark, size, fill=0.98), Image.LANCZOS
    )
    paste_centred(white_tile, white_mark)

    candidates = {
        "A navy tile + white symbol": navy_tile,
        "B white tile + navy symbol": apply_mask(white_tile, mask_squircle(size)),
        "C white tile + full lockup": apply_mask(make_opaque_icon(lockup, size, fill=0.72), mask_squircle(size)),
    }
    masks = {"squircle": mask_squircle(size), "circle": mask_circle(size), "rounded": mask_rounded(size)}

    cols = len(candidates)
    rows = len(masks) * len(walls)
    w = cols * (size + pad) + pad
    h = rows * (size + pad + label_h) + pad
    sheet = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    y = pad
    for wall_name, wall in walls.items():
        for mask_name, mask in masks.items():
            x = pad
            for image in candidates.values():
                cell = Image.new("RGBA", (size, size), wall)
                cell.alpha_composite(apply_mask(image, mask))
                sheet.alpha_composite(cell, (x, y))
                x += size + pad
            y += size + pad
    out = os.path.join(ASSETS, "_iconreview", "launcher-preview.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.convert("RGB").save(out, "PNG")
    print(f"preview: {os.path.relpath(out, ROOT)}  ({cols} candidates x {rows} masks, {size}px = 48dp@3x)")
    print("row order: light/squircle, light/circle, light/rounded, dark/squircle, dark/circle, dark/rounded")
    print("columns:  " + " | ".join(candidates))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", action="store_true", help="render the review sheet instead of assets")
    args = parser.parse_args()
    preview() if args.preview else generate()
