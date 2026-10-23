"""Render independent menu building modules + a building-free scene.

Reuses the shipped flat OBJ world geometry and original texture UVs (the same
projection as tools/import-menu.py). The output keeps the existing menu scene
(roads, grass, stars, pads, trees) but removes the building meshes; each building
is saved as a transparent PNG at its native world position so the menu can
animate a single house without replacing the map.

Usage:
  python tools/import-map-buildings.py
"""
from pathlib import Path
import json
import re

import numpy as np
from PIL import Image, ImageChops, ImageDraw

ROOT = Path("com.ea.spymouse_row/files")
RES = ROOT / "res"
HI = ROOT / "res_960x640"
OUT = Path("assets/menu")
BUILDINGS = OUT / "buildings"


def attrs(line):
    return {k: float(v) for k, v in re.findall(r"(\w+)\s*=\s*([\d.-]+)", line)}


def vertices(xml):
    return [attrs(line) for line in xml.splitlines() if "<Vertex " in line]


def scene_depth(file):
    override = HI / "world" / file.parent.name / file.name
    source = (override if override.exists() else file).read_text(errors="replace")
    values = [float(line.split()[2]) for line in source.splitlines() if line.startswith("v ")]
    return round(sum(values) / len(values), 6) if values else 0


def road_order(file):
    kind = file.stem.split("_", 1)[1]
    priority = 3 if kind.startswith("hiddenroad") else 2 if kind.startswith("hroad") else 1 if kind.startswith("node") else 0
    return (-scene_depth(file), priority, file.name)


def render_obj(canvas, file, textures, offset=(0, 0)):
    vs = []
    uv = []
    faces = []
    material = None
    materials = {}
    triangles = 0
    base_directory = RES / "world" / file.parent.name
    high_directory = HI / "world" / file.parent.name
    if (high_directory / file.name).exists():
        file = high_directory / file.name
    source = file.read_text(errors="replace")
    references = re.findall(r"^mtllib\s+(.+)$", source, re.MULTILINE)
    library = references[0].strip() if references else file.with_suffix(".mtl").name
    mtl = next((d / library for d in [high_directory, base_directory] if (d / library).exists()), file.parent / library)
    if not mtl.exists():
        raise FileNotFoundError(f"{file}: material library {mtl}")
    for line in mtl.read_text(errors="replace").splitlines():
        if line.startswith("newmtl "):
            material = line.split()[1]
        if line.strip().startswith("map_Kd "):
            materials[material] = re.split(r"[\\/]", line.strip().split(maxsplit=1)[1])[-1]
    for line in source.splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] == "v":
            vs.append((float(p[1]) * 2.4 + 480 + offset[0], 320 - float(p[3]) * 2.4 + offset[1]))
        if p[0] == "vt":
            uv.append((float(p[1]), 1 - float(p[2])))
        if p[0] == "usemtl":
            material = p[1]
        if p[0] == "f":
            faces.append((material, [tuple(int(n) - 1 for n in item.split("/")[:2]) for item in p[1:]]))
    for material, face in faces:
        name = materials.get(material)
        if name not in textures:
            raise ValueError(f"{file}: unresolved material {material!r} / texture {name!r}")
        texture = textures[name]
        for j in range(1, len(face) - 1):
            tri = [face[0], face[j], face[j + 1]]
            dest = np.array([[*vs[v], 1] for v, t in tri])
            src = np.array([[uv[t][0] * texture.width, uv[t][1] * texture.height] for v, t in tri])
            try:
                coef = np.linalg.solve(dest, src)
            except np.linalg.LinAlgError:
                continue
            box = (max(0, int(min(dest[:, 0]))), max(0, int(min(dest[:, 1]))),
                   min(960, int(max(dest[:, 0])) + 2), min(640, int(max(dest[:, 1])) + 2))
            if box[2] <= box[0] or box[3] <= box[1]:
                continue
            transform = (coef[0, 0], coef[1, 0], coef[2, 0] + coef[0, 0] * box[0] + coef[1, 0] * box[1],
                         coef[0, 1], coef[1, 1], coef[2, 1] + coef[0, 1] * box[0] + coef[1, 1] * box[1])
            size = (box[2] - box[0], box[3] - box[1])
            patch = texture.transform(size, Image.Transform.AFFINE, transform, Image.Resampling.BILINEAR)
            mask = Image.new("L", size)
            ImageDraw.Draw(mask).polygon([(x - box[0], y - box[1]) for x, y, _ in dest], fill=255)
            patch.putalpha(ImageChops.multiply(patch.getchannel("A"), mask))
            canvas.alpha_composite(patch, (box[0], box[1]))
            triangles += 1
    return triangles


def main():
    BUILDINGS.mkdir(parents=True, exist_ok=True)
    index = []
    for world in range(1, 9):
        number = f"{world:02}"
        folder = f"world{number}"
        directory = RES / "world" / folder
        xmlpath = RES / "world" / f"world_{number}.xml"
        if not xmlpath.exists():
            continue
        points = vertices(xmlpath.read_text())
        nodes = [p for p in points if p.get("Property") == 990]
        textures = {p.name: Image.open(p).convert("RGBA") for p in (HI / "world" / folder).glob("*.png")}
        scene = Image.new("RGBA", (960, 640))
        ground = [f for kind in ["background_main", "grass*"] for f in sorted(directory.glob(f"{folder}_{kind}.obj"))]
        roads = sorted({f for kind in ["road*", "node*", "hroad*", "hiddenroad*"] for f in directory.glob(f"{folder}_{kind}.obj") if "alpha" not in f.stem}, key=road_order)
        details = sorted(directory.glob(f"{folder}_background_details.obj"))
        for file in [*ground, *roads, *details]:
            if "alpha" not in file.stem:
                render_obj(scene, file, textures)

        world_out = BUILDINGS / f"world-{world}"
        world_out.mkdir(parents=True, exist_ok=True)
        scene.convert("RGB").save(world_out / "scene.png")

        records = []
        placements = sorted((p for p in points if p.get("Property") == 993), key=lambda p: p["y"])
        for i, p in enumerate(placements):
            # Placement Tag is a level UID, not a building-art index. Chapters
            # 2-6 assign shipped meshes 01..NN in placement order; chapter 1
            # uses its authored 1..12 Tag order (the original menu layout).
            if world == 1:
                tag = int(p["Tag"])
                idx = tag if 1 <= tag <= 12 else i + 1
            else:
                idx = i + 1
            file = directory / f"{folder}_building{idx:02}.obj"
            if not file.exists():
                continue
            canvas = Image.new("RGBA", (960, 640))
            render_obj(canvas, file, textures, (p["x"] * 2 - 480, p["y"] * 2 - 320))
            bbox = canvas.getchannel("A").getbbox()
            if not bbox:
                continue
            cut = canvas.crop(bbox)
            name = f"building-{len(records) + 1:02d}.png"
            cut.save(world_out / name)
            cx = (bbox[0] + bbox[2]) / 2
            cy = (bbox[1] + bbox[3]) / 2
            # Nearest level button, used by menu.js to pick the house to bounce.
            # Node coordinates are authored at half menu scale (CSS x*2).
            nearest = None
            for n in nodes:
                d = (n["x"] * 2 - cx) ** 2 + (n["y"] * 2 - cy) ** 2
                if nearest is None or d < nearest[0]:
                    nearest = (d, n)
            records.append({
                "id": str(len(records) + 1), "file": f"assets/menu/buildings/world-{world}/{name}",
                "x": bbox[0], "y": bbox[1], "w": bbox[2] - bbox[0], "h": bbox[3] - bbox[1],
                "cx": cx, "cy": cy,
                "nodeTag": int(nearest[1]["Tag"]) if nearest else None,
                "nodeDistance": round(nearest[0] ** 0.5, 1) if nearest else None,
            })
        (world_out / "buildings.json").write_text(json.dumps({
            "world": world,
            "scene": f"assets/menu/buildings/world-{world}/scene.png",
            "buildings": records,
        }, indent=2), encoding="utf-8")
        index.append({"world": world, "scene": f"assets/menu/buildings/world-{world}/scene.png", "buildings": len(records)})
        print(f"world {world}: {len(records)} buildings")
    (BUILDINGS / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
