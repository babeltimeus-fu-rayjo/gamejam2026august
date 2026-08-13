#!/usr/bin/env python3
"""Turn hit-VFX art (a coloured glow painted on opaque white paper) into
additively-blendable RGBA textures for game/public/assets/vfx/.

Usage:
    python3 tools/key-vfx-white.py SOURCE.png OUT.png [SOURCE2.png OUT2.png ...]

Keying on whiteness alone — `alpha = 1 - min(r,g,b)` — is right for the saturated
paint but inverts the artist's intent at the flash's centre, which is painted
*pale*: pale reads as "little ink" under paper semantics, so the brightest part of
the effect comes out as a dark hole.

The centre is therefore recovered by connectivity rather than by brightness. The
paper is the pale region reachable from the image border; a pale region the flood
*cannot* reach is enclosed by paint, which makes it the blown-out core. Its alpha
is forced opaque and its colour pushed to white, so it reads brighter than the
saturated ring once added to the frame. The gaps between the rays stay keyed out,
because they open onto the border like the paper does.

Everything is cropped to the art's own bounds, so a texture's extent *is* its
effect and the game can size it straight against the reaction pad.
"""

import sys
from collections import deque
from PIL import Image, ImageChops, ImageFilter

# min-channel at or above this counts as "pale" for the flood. Tuned on the
# first three effects: lower and the pale core stops qualifying, higher and the
# flood finds a corridor into it.
PALE_MIN = 180
# Softens the recovered core's edge into the paint around it.
CORE_FEATHER = 3
# How far the core's colour is pushed toward pure white.
CORE_WHITEN = 0.85


def enclosed_pale(white: Image.Image) -> Image.Image:
    """Pale pixels the border flood can't reach — the effect's blown-out core."""
    w, h = white.size
    px = white.load()
    pale = [[px[x, y] >= PALE_MIN for x in range(w)] for y in range(h)]
    seen = [[False] * w for _ in range(h)]
    queue: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        if pale[y][x] and not seen[y][x]:
            seen[y][x] = True
            queue.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)

    mask = Image.new("L", (w, h))
    mask.putdata(
        [
            255 if (pale[y][x] and not seen[y][x]) else 0
            for y in range(h)
            for x in range(w)
        ]
    )
    return mask


def key_white(path: str, out: str) -> None:
    src = Image.open(path).convert("RGB")
    r, g, b = src.split()
    white = ImageChops.darker(ImageChops.darker(r, g), b)
    ink = ImageChops.invert(white)

    core = enclosed_pale(white).filter(ImageFilter.GaussianBlur(CORE_FEATHER))
    # Paint carries its own alpha; the core overrides it where it is stronger.
    alpha = ImageChops.lighter(ink, core)
    # Sub-pixel soften takes the stair-stepping off the ray tips.
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.7))

    whiten = core.point(lambda v: round(v * CORE_WHITEN))
    solid_white = Image.new("L", src.size, 255)
    lit = Image.merge(
        "RGB",
        tuple(
            Image.composite(solid_white, channel, whiten)
            for channel in (r, g, b)
        ),
    )

    keyed = lit.convert("RGBA")
    keyed.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 10 else 0).getbbox()
    if bbox:
        keyed = keyed.crop(bbox)
    keyed.save(out)
    print(f"{path} -> {out}  source={src.size} cropped={keyed.size}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2 or len(args) % 2:
        sys.exit(__doc__)
    for src_path, out_path in zip(args[0::2], args[1::2]):
        key_white(src_path, out_path)
