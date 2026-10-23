// Read-only diagnosis: find maps whose XML entities fall outside the imported
// mask (typically multi-chunk/wide levels). Prints JSON evidence.
import fs from "node:fs";
import path from "node:path";

const RES = path.join("com.ea.spymouse_row", "files", "res");
const MASKS = "assets/masks";
const CATS = new Set([50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 285]);
const maps = fs
  .readdirSync(RES)
  .filter((d) => /^map\d+$/.test(d))
  .sort((a, b) => +a.slice(3) - +b.slice(3));

const out = [];
for (const dir of maps) {
  const xmlPath = path.join(RES, dir, `${dir}.xml`);
  const maskPath = path.join(MASKS, `${dir}.json`);
  if (!fs.existsSync(xmlPath) || !fs.existsSync(maskPath)) continue;
  const xml = fs.readFileSync(xmlPath, "utf8");
  const mask = JSON.parse(fs.readFileSync(maskPath, "utf8"));

  const interesting = [];
  let maxX = 0, maxY = 0;
  for (const m of xml.matchAll(/<Vertex\s+([^>]*)\/>/g)) {
    const attrs = {};
    for (const kv of m[1].matchAll(/(\w+)\s*=\s*(-?\d+)/g)) attrs[kv[1]] = +kv[2];
    if (attrs.Flags !== 10) continue;
    const p = attrs.Property ?? 0;
    maxX = Math.max(maxX, attrs.x ?? 0);
    maxY = Math.max(maxY, attrs.y ?? 0);
    if (!(p === 1 || (p >= 6 && p <= 10) || (p >= 240 && p <= 243) || CATS.has(p))) continue;
    const rawX = 2 * (attrs.x ?? 0) + 32;
    const rawY = 2 * (attrs.y ?? 0) + 64;
    interesting.push({ id: attrs.id, prop: p, tag: attrs.Tag ?? 0, designX: attrs.x, designY: attrs.y, rawX, rawY });
  }
  const outside = interesting.filter((e) => e.rawX < 0 || e.rawY < 0 || e.rawX >= mask.width || e.rawY >= mask.height);

  const artDir = path.join("com.ea.spymouse_row", "files", "res_960x640", dir);
  const segments = fs.existsSync(artDir)
    ? fs.readdirSync(artDir).filter((f) => /^map\d+(?:_\d+)?\.jpg$/.test(f) && !f.includes("_pad")).length
    : 0;
  const chunkDir = path.join(artDir, "chunks");
  const chunks = fs.existsSync(chunkDir) ? fs.readdirSync(chunkDir).filter((f) => /\.jpg$/.test(f)).length : 0;
  if (outside.length || mask.width > 1024 || segments > 1) {
    out.push({
      map: dir,
      xmlMaxDesign: { x: maxX, y: maxY },
      mask: { width: mask.width, height: mask.height, cols: mask.cols, rows: mask.rows },
      segments,
      chunks,
      interesting: interesting.length,
      outsideMask: outside.length,
      outside,
    });
  }
}

out.sort((a, b) => b.outsideMask - a.outsideMask);
console.log(JSON.stringify({ mapsWithOutsideEntities: out.filter((m) => m.outsideMask > 0).length, maps: out }, null, 2));
