"""Extract the menu's buildings as independent transparent modules.

The data pack ships `world-N.jpg` (scene + buildings + baked stars/pads) and
`world-N-base.jpg` (scene without buildings). Diff the pair, cut large connected
regions into PNGs, and produce a scene where the building silhouettes are
replaced by base pixels. This keeps the existing map scene and makes each
building an independently animatable layer.

Usage:
  python tools/extract-map-buildings.py
"""
from collections import deque
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

MENU = Path("assets/menu")
OUT = MENU / "buildings"
MIN_AREA = 1200
MIN_H = 28

OUT.mkdir(parents=True, exist_ok=True)
summary = []
worlds = [int(value) for value in sys.argv[1:]] if len(sys.argv) > 1 else list(range(1, 9))
for world in worlds:
    comp = np.asarray(Image.open(MENU / f"world-{world}.jpg").convert("RGB"), dtype=np.int16)
    clean_path = OUT / f"world-{world}" / "scene.png"
    base = np.asarray(Image.open(clean_path).convert("RGB"), dtype=np.int16)
    H, W = comp.shape[:2]
    diff = (np.max(np.abs(comp - base), axis=2) > 12)
    # Dilate one pixel so cutouts keep the anti-aliased edge.
    mask = diff.copy()
    mask[1:, :] |= diff[:-1, :]
    mask[:-1, :] |= diff[1:, :]
    mask[:, 1:] |= diff[:, :-1]
    mask[:, :-1] |= diff[:, 1:]

    seen = np.zeros_like(mask, dtype=bool)
    buildings = []
    for sy in range(H):
        for sx in range(W):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            q = deque([(sx, sy)])
            seen[sy, sx] = True
            pixels = []
            minx = maxx = sx
            miny = maxy = sy
            while q:
                x, y = q.popleft()
                pixels.append((x, y))
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < W and 0 <= ny < H and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((nx, ny))
            if len(pixels) < MIN_AREA or maxy - miny + 1 < MIN_H:
                continue
            buildings.append({"pixels": pixels, "minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy, "area": len(pixels)})

    buildings.sort(key=lambda b: -b["area"])
    world_out = OUT / f"world-{world}"
    world_out.mkdir(parents=True, exist_ok=True)
    # scene.png is produced by tools/import-map-buildings.py from the road/grass
    # meshes only; keep it (do not replace it with a diff-based approximation).

    records = []
    for i, b in enumerate(buildings, 1):
        w = b["maxx"] - b["minx"] + 1
        h = b["maxy"] - b["miny"] + 1
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        for x, y in b["pixels"]:
            rgba[y - b["miny"], x - b["minx"], :3] = comp[y, x].astype(np.uint8)
            rgba[y - b["miny"], x - b["minx"], 3] = 255
        name = f"building-{i:02d}.png"
        Image.fromarray(rgba, "RGBA").save(world_out / name)
        records.append({
            "id": str(i), "file": f"assets/menu/buildings/world-{world}/{name}",
            "x": b["minx"], "y": b["miny"], "w": w, "h": h,
            "cx": b["minx"] + w / 2, "cy": b["miny"] + h / 2,
        })
    (world_out / "buildings.json").write_text(json.dumps({
        "world": world,
        "scene": f"assets/menu/buildings/world-{world}/scene.png",
        "buildings": records,
    }, indent=2), encoding="utf-8")
    summary.append({"world": world, "buildings": len(records), "scene": f"assets/menu/buildings/world-{world}/scene.png"})
    print(f"world {world}: {len(records)} buildings")

(OUT / "index.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
