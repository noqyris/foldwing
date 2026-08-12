#!/usr/bin/env python3
"""
Compose App Store frames (1290x2796, the 6.7" slot) in the style already on the
listing: the app's own paper as the ground, a two-line Georgia Bold caption, and
the content sat below it with room to breathe.

Palette is sampled from the live screenshots rather than guessed:
  ground  #E9EBE4   caption #16323C
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1290, 2796
GROUND = (233, 235, 228)
INK = (22, 50, 60)
FONT = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "store" / "screenshots" / "raw"
OUT = ROOT / "store" / "screenshots"


def caption(draw, lines, size=104, top=210, gap=1.18):
    f = ImageFont.truetype(FONT, size)
    y = top
    for line in lines:
        w = draw.textbbox((0, 0), line, font=f)[2]
        draw.text(((W - w) / 2, y), line, font=f, fill=INK)
        y += int(size * gap)
    return y


def frame(lines, content, target_w, top_of_content, caption_size=104):
    im = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(im)
    caption(d, lines, size=caption_size)
    scale = target_w / content.width
    c = content.resize((target_w, int(content.height * scale)), Image.LANCZOS)
    im.paste(c, ((W - target_w) // 2, top_of_content))
    return im


# ---- gallery: two full rows of cards, nothing sliced -----------------------
# Measured off the raw capture: the header ends by y=610 and the first two card
# rows occupy y 690..1850. Cropping to a row boundary is the whole point — the
# frame that shipped cut the bottom row through its own caption.
g = Image.open(RAW / "gallery.png").convert("RGB").crop((46, 690, 1242, 1852))
frame(["Every maze", "you beat, kept."], g, 1244, 780).save(OUT / "store-gallery.png")

# ---- share: the card a friend actually receives ---------------------------
s = Image.open(RAW / "sharecard.png").convert("RGB")
im = Image.new("RGB", (W, H), GROUND)
d = ImageDraw.Draw(im)
caption(d, ["13.2 seconds.", "Can you beat me?"])
tw = 940
sc = s.resize((tw, int(s.height * tw / s.width)), Image.LANCZOS)
# A hairline keeps the card from dissolving into the ground — same value the
# app uses to edge its own cards.
d.rectangle([(W - tw) // 2 - 2, 700 - 2, (W + tw) // 2 + 1, 700 + sc.height + 1],
            outline=(214, 217, 208), width=3)
im.paste(sc, ((W - tw) // 2, 700))
sub = ImageFont.truetype(FONT, 52)
line = "Send the run, not just the score."
lw = d.textbbox((0, 0), line, font=sub)[2]
d.text(((W - lw) / 2, 700 + sc.height + 74), line, font=sub, fill=(112, 126, 128))
im.save(OUT / "store-share.png")

for n in ("store-gallery", "store-share"):
    print(n, Image.open(OUT / f"{n}.png").size)
