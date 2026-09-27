"""
Game Center achievement icons, drawn in the app icon's own language.

App Store Connect refuses a version for review while any achievement
localization has no image ("missing a required relationship to an Achievement
Image"), and 1.3 is the first version that ships achievements. So the eight
images are generated here rather than drawn by hand: a serif glyph in ink above
the fold line and its reflection below it, on the paper colour — the same
picture as the home-screen icon, so a Game Center banner reads as Foldwing at a
glance.

    python3 scripts/achievement-icons.py            # writes build/achievements/*.jpg

JPEG on purpose: Game Center wants a flattened square image with no alpha, and
a PNG round-trip is one careless `RGBA` away from carrying a transparency
channel. 1024x1024 is one of the two sizes Apple accepts. The output is
gitignored; this script is the source of truth.

The colours are the PAPER theme in src/render/Theme.ts.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
PAPER = (0xE9, 0xEB, 0xE4)
INK = (0x16, 0x32, 0x3C)
ACCENT = (0x8E, 0x3B, 0x62)
# The reflection is the same ink seen through glass (mirrorAlpha 0.45 in the
# theme); on the icon it reads a touch lighter, so a little under half.
REFLECTION_ALPHA = 0.38
FOLD_Y = SIZE // 2 + 20

FONT = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

OUT = Path(__file__).resolve().parent.parent / "build" / "achievements"


def mix(color, alpha):
    return tuple(round(c * alpha + p * (1 - alpha)) for c, p in zip(color, PAPER))


def glyph_icon(text, color):
    """A glyph standing on the fold line, and its reflection hanging under it."""
    size = {1: 520, 2: 420, 3: 330}[len(text)]
    font = ImageFont.truetype(FONT, size)
    left, top, right, bottom = font.getbbox(text)
    w, h = right - left, bottom - top

    layer = Image.new("L", (w, h), 0)
    ImageDraw.Draw(layer).text((-left, -top), text, font=font, fill=255)

    img = Image.new("RGB", (SIZE, SIZE), PAPER)
    x = (SIZE - w) // 2
    gap = 14
    img.paste(Image.new("RGB", (w, h), color), (x, FOLD_Y - gap // 2 - h), layer)
    mirrored = layer.transpose(Image.FLIP_TOP_BOTTOM)
    img.paste(Image.new("RGB", (w, h), mix(color, REFLECTION_ALPHA)), (x, FOLD_Y + gap // 2), mirrored)
    return img


def flawless_icon():
    """The game itself: one line from the dot to the ring, and its mirror."""
    scale = 4  # supersample, then downscale, for clean round caps
    big = SIZE * scale
    img = Image.new("RGB", (big, big), PAPER)
    d = ImageDraw.Draw(img)
    fold = FOLD_Y * scale
    stroke = 34 * scale

    def curve(y_sign, color):
        # A smooth S from lower-left to upper-right, entirely on one side of the fold.
        pts = []
        steps = 200
        for i in range(steps + 1):
            t = i / steps
            x = (0.24 + 0.52 * t) * big
            y = 0.06 + 0.26 * t + 0.07 * __import__("math").sin(t * 2 * __import__("math").pi)
            pts.append((x, fold - y_sign * y * big))
        d.line(pts, fill=color, width=stroke, joint="curve")
        for (px, py) in (pts[0],):
            r = stroke * 0.9
            d.ellipse((px - r, py - r, px + r, py + r), fill=color)
        ex, ey = pts[-1]
        ring = stroke * 1.9
        d.ellipse((ex - ring, ey - ring, ex + ring, ey + ring), outline=color, width=int(stroke * 0.75))
        # round the line's own ends under the dot and ring
        for (px, py) in (pts[0], pts[-1]):
            r = stroke / 2
            d.ellipse((px - r, py - r, px + r, py + r), fill=color)

    curve(-1, mix(INK, REFLECTION_ALPHA))  # reflection first, below the fold
    curve(1, INK)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


ICONS = {
    "foldwing.first": lambda: glyph_icon("1", INK),
    "foldwing.ten": lambda: glyph_icon("10", INK),
    "foldwing.fifty": lambda: glyph_icon("50", INK),
    "foldwing.hundred": lambda: glyph_icon("100", INK),
    "foldwing.medal.ten": lambda: glyph_icon("10", ACCENT),
    "foldwing.medal.fifty": lambda: glyph_icon("50", ACCENT),
    "foldwing.flawless": flawless_icon,
    "foldwing.streak.week": lambda: glyph_icon("7", INK),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for vendor_id, draw in ICONS.items():
        path = OUT / f"{vendor_id}.jpg"
        draw().convert("RGB").save(path, "JPEG", quality=95)
        print(path)


if __name__ == "__main__":
    main()
