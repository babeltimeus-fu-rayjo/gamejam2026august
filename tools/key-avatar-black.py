#!/usr/bin/env python3
"""Key avatar pose renders (character on a pure-black backdrop) into RGBA
textures for game/public/assets/avatars/.

Usage:
    python3 tools/key-avatar-black.py SOURCE.png OUT.png [SOURCE2.png OUT2.png ...]

The generator paints the backdrop essentially #000 (max channel 0-3) while the
darkest costume blacks stay well above it (~27+), so alpha is a smoothstep on
the max channel: <= LO is backdrop, >= HI is character, with a ramp between
that keeps the anti-aliased silhouette soft. Glow effects that fade into the
backdrop (Elara's crescents) ride the same ramp and fade out naturally.

Edge pixels were blended against black, so their colour arrives premultiplied;
they are un-premultiplied against the derived alpha to avoid a dark fringe
over the game's real backgrounds.
"""

import sys
from PIL import Image, ImageFilter

# Max channel at or below LO is backdrop; at or above HI is character.
LO = 4
HI = 16
# Sub-pixel soften to match the matte-style edges of the earlier avatar sets.
FEATHER = 0.6


def key_black(path: str, out: str) -> None:
    src = Image.open(path).convert("RGB")
    w, h = src.size
    px = src.load()

    alpha = Image.new("L", (w, h))
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            m = max(px[x, y])
            if m <= LO:
                ap[x, y] = 0
            elif m >= HI:
                ap[x, y] = 255
            else:
                t = (m - LO) / (HI - LO)
                ap[x, y] = round(255 * t * t * (3 - 2 * t))

    alpha = alpha.filter(ImageFilter.GaussianBlur(FEATHER))

    keyed = src.convert("RGBA")
    kp = keyed.load()
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            a = ap[x, y]
            r, g, b, _ = kp[x, y]
            if 0 < a < 255:
                r = min(255, r * 255 // a)
                g = min(255, g * 255 // a)
                b = min(255, b * 255 // a)
            kp[x, y] = (r, g, b, a)

    keyed.save(out)
    print(f"{path} -> {out}  {keyed.size}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2 or len(args) % 2:
        sys.exit(__doc__)
    for src_path, out_path in zip(args[0::2], args[1::2]):
        key_black(src_path, out_path)
