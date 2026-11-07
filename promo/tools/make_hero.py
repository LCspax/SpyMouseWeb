# Build the standing protagonist art used in S00.
# The menu mouse is a two-layer asset: body (mm_mouse.png) + eye sprite overlay.
# The body still carries a flat magenta drop shadow, which is removed here.
from PIL import Image, ImageFilter

BODY = "assets/menu/mm_mouse.png"
EYES = {
    "open": "assets/menu/mm_mouse_open.png",
    "closed": "assets/menu/mm_mouse_closed.png",
}
# same ratios the web menu uses (menu.css .mouse-eyes)
EYE_LEFT, EYE_TOP, EYE_W = 0.387, 0.264, 0.177
SHADOW_RGB = (140, 31, 58)


def load_body():
    im = Image.open(BODY).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and (r - SHADOW_RGB[0]) ** 2 + (g - SHADOW_RGB[1]) ** 2 + (b - SHADOW_RGB[2]) ** 2 < 34 * 34:
                px[x, y] = (r, g, b, 0)
    return im


def compose(body, eye_path):
    out = body.copy()
    e = Image.open(eye_path).convert("RGBA")
    w = round(body.width * EYE_W)
    h = round(w * e.height / e.width)
    e = e.resize((w, h), Image.LANCZOS)
    out.alpha_composite(e, (round(body.width * EYE_LEFT), round(body.height * EYE_TOP)))
    return out


body = load_body()
bbox = body.split()[3].getbbox()
box = (bbox[0], 0, bbox[2], bbox[3] + 8)

for state, path in EYES.items():
    im = compose(body, path).crop(box)
    im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=45, threshold=3))
    dst = f"promo/media/art/mouse-hero{'' if state == 'open' else '-closed'}.png"
    im.save(dst)
    print(dst, im.size)
