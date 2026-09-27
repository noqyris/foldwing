#!/usr/bin/env python3
"""
Compose the 1.4 App Store frames (1320x2868 RGB, the 6.9" slot) from the raw
captures capture.mjs writes, plus a contact sheet of the nine in listing order.

THE LOOK is the app's own night: every frame is one sky, top to bottom. The
caption sits in the dark above the lamp, in cream Georgia Bold (the app's ink
and its display face), and the capture below it stands on the same radial the
game paints — Paper.ts's lamp, `LAMP` and `skyStops`, evaluated here in the
capture's own coordinates and carried past its edges. So where the capture
stops and the frame goes on there is no seam, no band edge and no letterbox:
the page simply continues, with a few stars of its own.

Captions are set at 150px and must fit two lines of at most 13 characters: a
search thumbnail shows a frame about 115pt wide, and this is the size that
still reads there. `*` in a caption is one of the game's gold stars, drawn.

THE CAPTURES are an iPhone 18 Pro's screen (402x874 pt at 3x, 1206x2622 px),
its safe area and all. Each frame names the rows of its capture that must be
seen — `crop`, from the first thing on screen to the last — and is scaled to
put them under the caption: up to full width (1320 / 1206) when they fit, a
little less when a screen is taller, never more. Nothing is drawn over a
capture, and nothing in it is moved; above and below `crop` it fades into the
sky rather than being sliced, and a narrower capture's sides feather into the
sky the same way.

Run from anywhere: python3 compose.py (Pillow only).
"""
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 1320, 2868
# The caption's room at the top of every frame; the capture's `crop` starts here.
BAND = 500
CAPTION_PX = 150
MAX_LINE_W = W - 2 * 80
FONT = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

# Night Fold's tokens (src/render/Theme.ts): the ink the app writes in, the
# lamp's stops (Paper.ts skyStops), the stars' cream, the medal's golds.
INK = (0xF4, 0xED, 0xE1)
SKY_STOPS = [(0.0, (0x1D, 0x44, 0x50)), (0.5, (0x0F, 0x28, 0x30)), (1.0, (0x08, 0x14, 0x19))]
LAMP = dict(cx=0.5, cy=0.27, rx=0.9, ry=0.42)
STAR_CREAM = (0xFF, 0xF8, 0xEC)
GOLD_LIGHT = (0xFB, 0xE3, 0xA0)
GOLD = (0xF0, 0xC0, 0x5A)
GOLD_DEEP = (0xB7, 0x85, 0x1C)
# Theme's scrim, for a capture taken under an open sheet.
SCRIM = ((0x02, 0x08, 0x0B), 0.68)

# The capture: the phone's whole screen, which is the page the lamp is laid over.
CAP_W, CAP_H = 1206, 2622
# Where the canvas meets the page at the top of the safe area (62 pt at 3x):
# the browser's edge filtering leaves a row a few levels lighter than the sky
# on both sides of it, a hairline no phone shows under its status bar. And
# where it meets the page at the bottom (874 - 34 pt): anything the canvas
# draws there — the result card's glow — stops dead at that edge.
CANVAS_TOP = 62 * 3
CANVAS_BOTTOM = (874 - 34) * 3
# How far under CANVAS_BOTTOM a glow cut by it is let fall off.
FALLOFF = 60
FULL = W / CAP_W
# How far past `crop` a capture fades into the sky, and how wide its sides feather.
FADE = 44
FEATHER = 22

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "store" / "screenshots" / "1.4" / "raw"
OUT = ROOT / "store" / "screenshots" / "1.4"

# (name, caption lines, raw capture, crop top..bottom in capture px — None for
# the share card, options). Crops are measured off the captures: the first and
# last rows that differ from the bare sky, with a little of the sky kept round
# them.
BOARD = (182, 2345)  # the header, the board, the chapter's beads under it
# The board stepped back and the result card under it, to the canvas's bottom
# edge — which cuts the card's glow, so the fade below softens it — with room
# left under the card.
RESULT = (350, 2519)
FRAMES = [
    ("01", ("One line.", "Two mazes."), "01-level48-drawing.png", BOARD, {}),
    ("02", ("Dodge walls", "you can’t see"), "02a-level48-mirror-crash.png", BOARD, {}),
    ("03", ("Clear both.", "Earn ***"), "03-level48-won.png", RESULT, {"pad": 40, "keep": FALLOFF}),
    ("04", ("A daily maze", "for everyone."), "04-daily-result.png", RESULT, {"pad": 40, "keep": FALLOFF}),
    # From the title to the frontier's Play, the journey's own fade under it.
    ("05", ("300 mazes.", "No lives."), "05-levels.png", (172, 2479), {}),
    ("06", ("Send the run.", "Dare friends."), "06-sharecard.png", None, {}),
    ("07", ("Stuck? See", "both mazes."), "07-level48-reveal.png", BOARD, {}),
    # From the title to the fourth row, cut by the list's own fade.
    ("08", ("Each win,", "a new figure."), "08-gallery.png", (172, 2515), {}),
    # From the top bar (today's three) to the Levels and Gallery tiles.
    ("09", ("Three goals,", "every day."), "09m-menu.png", (178, 2502), {}),
]


# ------------------------------------------------------------------ the sky


def sky_at(x, y, scrim=None):
    """The lamp's colour at capture pixel (x, y) — anywhere, inside the capture or past it."""
    t = math.hypot((x - LAMP["cx"] * CAP_W) / (LAMP["rx"] * CAP_W), (y - LAMP["cy"] * CAP_H) / (LAMP["ry"] * CAP_H))
    if t >= 1:
        c = SKY_STOPS[-1][1]
    else:
        for (a, ca), (b, cb) in zip(SKY_STOPS, SKY_STOPS[1:]):
            if a <= t <= b:
                u = (t - a) / (b - a)
                c = tuple(ca[i] + (cb[i] - ca[i]) * u for i in range(3))
                break
    if scrim:
        (sc, sa) = scrim
        c = tuple(c[i] * (1 - sa) + sc[i] * sa for i in range(3))
    return c


def sky(ox, oy, k, scrim=None):
    """The frame's sky for a capture placed at (ox, oy) at scale k: the page's own radial, carried on."""
    step = 4
    lw, lh = W // step + 2, H // step + 2
    lo = Image.new("RGB", (lw, lh))
    px = lo.load()
    # Low-res pixel i stands for frame pixel (i + 0.5) * step - 0.5 once resized.
    for j in range(lh):
        y = ((j + 0.5) * step - 0.5 - oy) / k
        for i in range(lw):
            x = ((i + 0.5) * step - 0.5 - ox) / k
            c = sky_at(x, y, scrim)
            px[i, j] = (round(c[0]), round(c[1]), round(c[2]))
    return lo.resize((lw * step, lh * step), Image.BICUBIC).crop((0, 0, W, H))


def stars(im, avoid, keep_out, seed=11, count=46):
    """
    A sparse star field where the frame is sky of its own — never over the
    capture, never inside the caption — like the app's: cream dots, 0.3-1.2 pt,
    denser toward the top. Park-Miller, so every frame gets the same night.
    """
    s = seed

    def rnd():
        nonlocal s
        s = (s * 16807) % 2147483647
        return s / 2147483647

    pt = 3 * FULL
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for _ in range(count):
        x = rnd() * W
        y = (rnd() ** 1.5) * H
        r = (0.3 + rnd() * 0.9) * pt
        a = 0.12 + 0.4 * rnd()
        if keep_out(x, y) or any(bx0 - 24 <= x <= bx1 + 24 and by0 - 24 <= y <= by1 + 24 for bx0, by0, bx1, by1 in avoid):
            continue
        n = int(r * 2 + 6)
        patch = Image.new("L", (n * 4, n * 4), 0)
        ImageDraw.Draw(patch).ellipse(
            [(n / 2 - r) * 4, (n / 2 - r) * 4, (n / 2 + r) * 4, (n / 2 + r) * 4], fill=round(255 * a)
        )
        patch = patch.resize((n, n), Image.LANCZOS)
        dot = Image.new("RGBA", (n, n), STAR_CREAM + (0,))
        dot.putalpha(patch)
        layer.alpha_composite(dot, (int(x - n / 2), int(y - n / 2)))
    im.paste(layer, (0, 0), layer)


# --------------------------------------------------------------- captions


def star_shape(cx, cy, r, inner=0.48, rot=-math.pi / 2):
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * inner
        a = rot + i * math.pi / 5
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return pts


def gold_star(im, cx, cy, r):
    """One of the result card's stars: a gold radial, light at the top, deep at the rim."""
    n = int(r * 2 + 8)
    ss = 4
    mask = Image.new("L", (n * ss, n * ss), 0)
    ImageDraw.Draw(mask).polygon([(x * ss, y * ss) for x, y in star_shape(n / 2, n / 2 + r * 0.06, r)], fill=255)
    mask = mask.resize((n, n), Image.LANCZOS)
    face = Image.new("RGB", (n, n))
    fp = face.load()
    for j in range(n):
        for i in range(n):
            d = math.hypot(i - n / 2, j - n * 0.36) / r
            if d < 0.55:
                u = d / 0.55
                c = tuple(GOLD_LIGHT[q] + (GOLD[q] - GOLD_LIGHT[q]) * u for q in range(3))
            else:
                u = min(1, (d - 0.55) / 0.6)
                c = tuple(GOLD[q] + (GOLD_DEEP[q] - GOLD[q]) * u for q in range(3))
            fp[i, j] = tuple(round(v) for v in c)
    im.paste(face, (round(cx - n / 2), round(cy - n / 2)), mask)


def caption(im, lines):
    """
    Two lines, centred as a block in the band by their ink, not their em box.
    A `*` is a gold star the height of a capital, with the gap of a space.
    Returns the lines' ink boxes, for the stars to keep out of.
    """
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, CAPTION_PX)
    cap = d.textbbox((0, 0), "H", font=f)
    cap_h = cap[3] - cap[1]
    star_w = round(cap_h * 1.12)
    star_gap = round(cap_h * 0.1)

    def runs(ln):
        """(kind, text) pieces of a line and its ink width."""
        out = []
        for i, ch in enumerate(ln):
            kind = "star" if ch == "*" else "text"
            if out and out[-1][0] == kind:
                out[-1] = (kind, out[-1][1] + ch)
            else:
                out.append((kind, ch))
        return out

    def width(ln):
        w = 0
        for kind, txt in runs(ln):
            if kind == "text":
                w += d.textlength(txt, font=f)
            else:
                w += len(txt) * star_w + (len(txt) - 1) * star_gap
        return w

    for ln in lines:
        if len(ln) > 13 or width(ln) > MAX_LINE_W:
            raise SystemExit(f"caption line too long: {ln!r} ({len(ln)} chars, {width(ln):.0f}px)")
    step = round(CAPTION_PX * 1.16)
    # Ink of the block: the first line's top to the last line's baseline + descent.
    tops = [d.textbbox((0, 0), ln.replace("*", "H"), font=f) for ln in lines]
    top_ink = tops[0][1]
    bottom_ink = step * (len(lines) - 1) + tops[-1][3]
    y0 = (BAND - (bottom_ink - top_ink)) / 2 - top_ink
    boxes = []
    for i, ln in enumerate(lines):
        y = y0 + i * step
        x = (W - width(ln)) / 2
        x_start = x
        for kind, txt in runs(ln):
            if kind == "text":
                d.text((x, y), txt, font=f, fill=INK)
                x += d.textlength(txt, font=f)
            else:
                for _ in txt:
                    # On the capitals' line: centred on their height.
                    gold_star(im, x + star_w / 2, y + cap[1] + cap_h / 2, star_w / 2 * 1.02)
                    x += star_w + star_gap
                x -= star_gap
        bb = d.textbbox((0, 0), ln.replace("*", "H"), font=f)
        boxes.append((x_start, y + bb[1], x_start + width(ln), y + bb[3]))
    return boxes


# ----------------------------------------------------------------- frames


def ramp(n, rising=True):
    return [round(255 * ((i + 0.5) / n if rising else 1 - (i + 0.5) / n)) for i in range(n)]


def heal_canvas_edge(raw):
    """
    The two seams where the canvas meets the page, both in bare sky. At the
    top (CANVAS_TOP), the hairline's two rows are set to the sky between the
    rows round them, only where those are bare sky too. At the bottom
    (CANVAS_BOTTOM), a glow the edge cut is let fall off into the page.
    Nothing of the game is there to touch.
    """
    px = raw.load()
    a, b = CANVAS_TOP - 1, CANVAS_TOP + 2
    for x in range(CAP_W):
        pa, pb = px[x, a], px[x, b]
        if max(abs(pa[i] - pb[i]) for i in range(3)) > 6:
            continue
        for y in (CANVAS_TOP, CANVAS_TOP + 1):
            u = (y - a) / (b - a)
            px[x, y] = tuple(round(pa[i] + (pb[i] - pa[i]) * u) for i in range(3))
    # Below the canvas is the page's bare sky; a glow the canvas's edge cut is
    # carried on into it, falling off, instead of ending in a line.
    for x in range(CAP_W):
        last, page = px[x, CANVAS_BOTTOM - 1], px[x, CANVAS_BOTTOM + 1]
        e = [last[i] - page[i] for i in range(3)]
        if max(abs(v) for v in e) <= 2:
            continue
        for n in range(FALLOFF):
            y = CANVAS_BOTTOM + n
            w = (1 - (n + 1) / (FALLOFF + 1)) ** 2
            p = px[x, y]
            px[x, y] = tuple(max(0, min(255, round(p[i] + e[i] * w))) for i in range(3))


def game_frame(lines, src, crop, opts):
    raw = Image.open(RAW / src).convert("RGB")
    if raw.size != (CAP_W, CAP_H):
        raise SystemExit(f"{src}: {raw.size}, not the {CAP_W}x{CAP_H} phone capture")
    heal_canvas_edge(raw)
    top, bottom = crop
    room = H - BAND - opts.get("pad", 0)
    k = min(FULL, room / (bottom - top))
    ox = (W - CAP_W * k) / 2
    oy = BAND - top * k
    scrim = SCRIM if opts.get("scrim") else None

    frame = sky(ox, oy, k, scrim)

    # The capture's alpha, in its own pixels: whole inside `crop`, fading into
    # the sky above and below it, its sides feathered when it is narrower
    # than the frame.
    a = Image.new("L", (CAP_W, CAP_H), 255)
    ad = ImageDraw.Draw(a)
    f = round(FADE / k)
    for i, v in enumerate(ramp(f, rising=True)):
        y = top - f + i
        if 0 <= y < CAP_H:
            ad.line([(0, y), (CAP_W, y)], fill=v)
    if top - f > 0:
        ad.rectangle([0, 0, CAP_W, top - f - 1], fill=0)
    # `keep`: rows under `crop` shown whole before the fade (a glow's fall-off).
    fade_at = bottom + opts.get("keep", 0)
    for i, v in enumerate(ramp(f, rising=False)):
        y = fade_at + i
        if 0 <= y < CAP_H:
            ad.line([(0, y), (CAP_W, y)], fill=v)
    if fade_at + f < CAP_H:
        ad.rectangle([0, fade_at + f, CAP_W, CAP_H], fill=0)
    if ox > 0.5:
        side = Image.new("L", (CAP_W, CAP_H), 255)
        sd = ImageDraw.Draw(side)
        fe = round(FEATHER / k)
        for i, v in enumerate(ramp(fe, rising=True)):
            sd.line([(i, 0), (i, CAP_H)], fill=v)
            sd.line([(CAP_W - 1 - i, 0), (CAP_W - 1 - i, CAP_H)], fill=v)
        a = ImageChops.multiply(a, side)

    size = (round(CAP_W * k), round(CAP_H * k))
    cap = raw.resize(size, Image.LANCZOS) if k != 1 else raw
    alpha = a.resize(size, Image.BILINEAR) if k != 1 else a
    frame.paste(cap, (round(ox), round(oy)), alpha)

    # The capture's own sky, where it is shown, and the caption's box: no stars there.
    x0, x1 = ox + 8, ox + CAP_W * k - 8
    y0 = oy + (top * k) - FADE
    y1 = oy + (fade_at * k) + FADE if fade_at + FADE / k < CAP_H else H
    boxes = caption(frame, lines)
    stars(frame, boxes, lambda x, y: x0 <= x <= x1 and y0 <= y <= y1)
    return frame, k


def card_frame(lines, src):
    """The share card as a friend receives it: the PNG itself, a picture on the night sky."""
    card = Image.open(RAW / src).convert("RGB")
    frame = sky((W - CAP_W * FULL) / 2, BAND - 180 * FULL, FULL)
    th = 2200
    tw = round(card.width * th / card.height)
    x = (W - tw) // 2
    y = BAND + (H - BAND - th) // 2 + 8
    c = card.resize((tw, th), Image.LANCZOS)
    radius = 46

    # A soft drop shadow, as the app's glass cards cast.
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle([x, y + 18, x + tw, y + th + 18], radius=radius, fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(28))
    frame.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), sh)

    mask = Image.new("L", (tw * 4, th * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, tw * 4 - 1, th * 4 - 1], radius=radius * 4, fill=255)
    mask = mask.resize((tw, th), Image.LANCZOS)
    frame.paste(c, (x, y), mask)
    # A cream hairline, the glass edge the app gives its cards.
    edge = Image.new("L", (tw * 4, th * 4), 0)
    ImageDraw.Draw(edge).rounded_rectangle([0, 0, tw * 4 - 1, th * 4 - 1], radius=radius * 4, outline=255, width=8)
    edge = edge.resize((tw, th), Image.LANCZOS).point(lambda v: round(v * 0.22))
    frame.paste(Image.new("RGB", (tw, th), STAR_CREAM), (x, y), edge)

    boxes = caption(frame, lines)
    stars(frame, boxes, lambda px, py: x - 20 <= px <= x + tw + 20 and y - 20 <= py <= y + th + 40)
    return frame, th / card.height


def contact(frames):
    """The nine in listing order, the way a product page strip reads them."""
    s = 5
    tw, th = W // s, H // s
    gap = 28
    sheet = Image.new("RGB", (gap + 9 * (tw + gap), th + 2 * gap + 56), (238, 238, 234))
    d = ImageDraw.Draw(sheet)
    f = ImageFont.truetype(FONT, 34)
    for i, im in enumerate(frames):
        x = gap + i * (tw + gap)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, gap))
        n = f"{i + 1:02d}"
        nw = d.textbbox((0, 0), n, font=f)[2]
        d.text((x + (tw - nw) / 2, gap + th + 12), n, font=f, fill=(0x0F, 0x28, 0x30))
    return sheet


if __name__ == "__main__":
    done = []
    for name, lines, src, crop, opts in FRAMES:
        im, k = card_frame(lines, src) if crop is None else game_frame(lines, src, crop, opts)
        assert im.size == (W, H) and im.mode == "RGB"
        im.save(OUT / f"{name}.png", optimize=True)
        done.append(im)
        print(name, im.size, im.mode, src, f"scale {k:.4f}")

    contact(done).save(OUT / "contact.png", optimize=True)
    print("contact", Image.open(OUT / "contact.png").size)
