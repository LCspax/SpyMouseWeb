#!/usr/bin/env python3
"""Extract original cat patrol routes from a MuMu level screenshot.

The original game draws the patrol route as pale dots on the floor. This tool
calibrates the 2176x1224 emulator screenshot against the 1024x768 HD background,
detects the dots, filters them through the walkability mask, chains them into
paths/loops and writes assets/levels/routes-native/mapNNN.json.

Usage:
  python tools/extract_native_route.py --map 704 --shot shot.png [--scale 1.91]
                                       [--max-jump 96] [--out map704.json]
"""
import argparse
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "com.ea.spymouse_row", "files", "res_960x640")
MASKS = os.path.join(ROOT, "assets", "masks")
OUTDIR = os.path.join(ROOT, "assets", "levels", "routes-native")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--map", required=True, help="map number, e.g. 704")
    p.add_argument("--shot", required=True, help="emulator screenshot (2176x1224)")
    p.add_argument("--scale", type=float, default=None)
    p.add_argument("--max-jump", type=float, default=96.0)
    p.add_argument("--out", default=None)
    p.add_argument("--dump-dots", default=None)
    return p.parse_args()


def load_background(map_num):
    path = os.path.join(RES, f"map{map_num}", f"map{map_num}.jpg")
    if not os.path.exists(path):
        sys.exit(f"background not found: {path}")
    return Image.open(path).convert("RGB")


def load_mask(map_num):
    path = os.path.join(MASKS, f"map{map_num}.json")
    if not os.path.exists(path):
        return None
    m = json.load(open(path))
    cols, rows, cell = m["cols"], m["rows"], m["cell"]
    data = m["data"]

    def is_wall(x, y):
        tx, ty = int(x // cell), int(y // cell)
        if tx < 0 or ty < 0 or tx >= cols or ty >= rows:
            return True
        return data[ty * cols + tx] != "1"

    return is_wall


def calibrate_scale(shot, bg):
    """Find the centered scale that best matches the screenshot (coarse search)."""
    npx = shot.convert("L").load()
    bpx = bg.convert("L").load()
    NW, NH = shot.size
    BW, BH = bg.size
    step = 24
    xs = list(range(0, NW, step))
    ys = list(range(0, NH, step))
    nvals = [npx[x, y] for y in ys for x in xs]
    nmean = sum(nvals) / len(nvals)
    nvar = sum((v - nmean) ** 2 for v in nvals) + 1e-9
    best = (1.91, -1e9)
    for i in range(150, 226):
        s = i / 100.0
        vals = []
        for y in ys:
            for x in xs:
                bx = int((x - NW / 2) / s + BW / 2)
                by = int((y - NH / 2) / s + BH / 2)
                vals.append(bpx[bx, by] if 0 <= bx < BW and 0 <= by < BH else 0)
        vmean = sum(vals) / len(vals)
        cov = sum((nvals[i] - nmean) * (vals[i] - vmean) for i in range(len(vals)))
        var = sum((v - vmean) ** 2 for v in vals) + 1e-9
        corr = cov / math.sqrt(nvar * var)
        if corr > best[1]:
            best = (s, corr)
    return best[0]


def detect_dots(shot, bg, scale, min_area=12, max_area=220):
    NW, NH = shot.size
    BW, BH = bg.size
    newbg = bg.resize((int(BW * scale), int(BH * scale)), Image.BILINEAR)
    ox = (NW - newbg.width) // 2
    oy = (NH - newbg.height) // 2
    canvas = Image.new("RGB", (NW, NH), (0, 0, 0))
    canvas.paste(newbg, (ox, oy))
    npx = shot.load()
    cpx = canvas.load()

    x0, x1 = 300, NW - 200
    y0, y1 = 100, NH - 80
    W, H = x1 - x0, y1 - y0
    diff = bytearray(W * H)
    for y in range(y0, y1):
        for x in range(x0, x1):
            r1, g1, b1 = npx[x, y]
            r2, g2, b2 = cpx[x, y]
            if abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2) > 90:
                diff[(y - y0) * W + (x - x0)] = 1

    visited = bytearray(W * H)
    dots = []
    for i in range(W * H):
        if not diff[i] or visited[i]:
            continue
        stack = [i]
        visited[i] = 1
        area = 0
        sx = sy = 0
        minx = maxx = i % W
        miny = maxy = i // W
        while stack:
            c = stack.pop()
            cx, cy = c % W, c // W
            area += 1
            sx += cx
            sy += cy
            minx = min(minx, cx)
            maxx = max(maxx, cx)
            miny = min(miny, cy)
            maxy = max(maxy, cy)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < W and 0 <= ny < H:
                    ni = ny * W + nx
                    if diff[ni] and not visited[ni]:
                        visited[ni] = 1
                        stack.append(ni)
        w = maxx - minx + 1
        h = maxy - miny + 1
        if min_area <= area <= max_area and 3 <= w <= 16 and 3 <= h <= 16 and abs(w - h) <= 5:
            dots.append(((sx / area) + x0, (sy / area) + y0))

    pts = []
    for cx, cy in dots:
        tx = (cx - NW / 2) / scale + BW / 2
        ty = (cy - NH / 2) / scale + BH / 2
        if 0 <= tx < BW and 0 <= ty < BH:
            pts.append((tx, ty))
    return pts


def chain_dots(dots, max_jump):
    if not dots:
        return []
    pts = dots[:]
    clusters = []
    while pts:
        path = [min(pts, key=lambda p: (p[0] + p[1]))]
        pts.remove(path[0])
        changed = True
        while changed and pts:
            changed = False
            for end in ("start", "end"):
                anchor = path[0] if end == "start" else path[-1]
                cand = min(pts, key=lambda p: (p[0] - anchor[0]) ** 2 + (p[1] - anchor[1]) ** 2)
                d = math.hypot(cand[0] - anchor[0], cand[1] - anchor[1])
                if d <= max_jump:
                    if end == "start":
                        path.insert(0, cand)
                    else:
                        path.append(cand)
                    pts.remove(cand)
                    changed = True
                    break
        clusters.append(path)

    routes = []
    for path in clusters:
        if len(path) < 4:
            continue
        gap = math.hypot(path[0][0] - path[-1][0], path[0][1] - path[-1][1])
        mode = "loop" if gap <= max_jump else "pingpong"
        routes.append({"mode": mode, "points": [{"x": round(x, 1), "y": round(y, 1)} for x, y in path]})
    routes.sort(key=lambda r: -len(r["points"]))
    return routes


def main():
    args = parse_args()
    shot = Image.open(args.shot).convert("RGB")
    bg = load_background(args.map)
    is_wall = load_mask(args.map)
    scale = args.scale or calibrate_scale(shot, bg)
    dots = detect_dots(shot, bg, scale)
    if is_wall:
        dots = [p for p in dots if not is_wall(p[0], p[1])]
    routes = chain_dots(dots, args.max_jump)

    out = {
        "source": "emulator-dot-extraction",
        "map": f"map{args.map}",
        "screenshot": os.path.basename(args.shot),
        "calibration": {"scale": round(scale, 4), "mode": "centered"},
        "dots": len(dots),
        "routes": routes,
    }
    outpath = os.path.join(OUTDIR, args.out or f"map{args.map}.json")
    os.makedirs(OUTDIR, exist_ok=True)
    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    if args.dump_dots:
        img = bg.copy()
        d = ImageDraw.Draw(img)
        for x, y in dots:
            d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(0, 255, 0), width=2)
        img.save(args.dump_dots)

    print(f"map{args.map}: scale={scale:.4f} dots={len(dots)} routes={len(routes)} -> {outpath}")
    for i, r in enumerate(routes):
        xs = [p["x"] for p in r["points"]]
        ys = [p["y"] for p in r["points"]]
        print(f"  route {i}: {r['mode']} pts={len(r['points'])} bbox=({min(xs):.0f},{min(ys):.0f})-({max(xs):.0f},{max(ys):.0f})")


if __name__ == "__main__":
    main()
