from PIL import Image, ImageDraw, ImageFont


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    s = size
    pad = s * 0.08
    r = s * 0.22

    purple = (90, 70, 120, 255)
    cream = (247, 243, 237, 255)

    def rounded_rect(draw, xy, radius, fill):
        x0, y0, x1, y1 = xy
        draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
        draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
        draw.ellipse([x0, y0, x0 + 2*radius, y0 + 2*radius], fill=fill)
        draw.ellipse([x1 - 2*radius, y0, x1, y0 + 2*radius], fill=fill)
        draw.ellipse([x0, y1 - 2*radius, x0 + 2*radius, y1], fill=fill)
        draw.ellipse([x1 - 2*radius, y1 - 2*radius, x1, y1], fill=fill)

    rounded_rect(draw, (pad, pad, s - pad, s - pad), r, purple)

    cx = s / 2
    cy = s / 2

    # Circle outline around the B
    circle_r = s * 0.30
    stroke = max(2, int(s * 0.03))
    draw.ellipse(
        [cx - circle_r, cy - circle_r, cx + circle_r, cy + circle_r],
        outline=(180, 180, 190, 255), width=stroke
    )

    # Bold B in the center
    font_size = int(s * 0.38)
    font = None
    for name in [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/consolab.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]:
        try:
            font = ImageFont.truetype(name, font_size)
            break
        except OSError:
            continue

    text = "B"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (s - tw) / 2 - bbox[0]
    ty = (s - th) / 2 - bbox[1]
    draw.text((tx, ty), text, fill=cream, font=font)

    return img


import os
_dir = os.path.dirname(os.path.abspath(__file__))
make_icon(192).save(os.path.join(_dir, "icon-192.png"))
make_icon(512).save(os.path.join(_dir, "icon-512.png"))
print("done")
