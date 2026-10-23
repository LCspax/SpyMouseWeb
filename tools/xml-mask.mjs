// Builds collision masks from the original wall geometry (XML lines with
// Property = 0) and compares them with the colour-segmentation masks.
//   node tools/xml-mask.mjs
import fs from "fs";
import path from "path";

const ROOT = path.resolve(".");
const RES = path.join(ROOT, "com.ea.spymouse_row", "files", "res");
const MASKS = path.join(ROOT, "assets", "masks");
const OUT = path.join(ROOT, "assets", "masks-xml");

function parseMap(mapNum) {
  const file = path.join(RES, "map" + mapNum, "map" + mapNum + ".xml");
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8");
  const verts = new Map();
  const lines = [];
  const vre = /<Vertex\s+([^>]*)\/>/g;
  let m;
  while ((m = vre.exec(xml))) {
    const a = m[1];
    const g = (k) => {
      const r = a.match(new RegExp(k + '\\s*=\\s*(-?\\d+)'));
      return r ? +r[1] : 0;
    };
    verts.set(g("id"), { x: 2 * g("x") + 32, y: 2 * g("y") + 64, prop: g("Property"), flags: g("Flags") });
  }
  const lre = /<Line\s+([^>]*)\/>/g;
  while ((m = lre.exec(xml))) {
    const a = m[1];
    const g = (k) => {
      const r = a.match(new RegExp(k + '\\s*=\\s*(-?\\d+)'));
      return r ? +r[1] : 0;
    };
    lines.push({ a: g("VertexA"), b: g("VertexB"), prop: g("Property") });
  }
  return { verts, lines };
}

function stamp(obstacle, w, h, x, y, r) {
  const ix = Math.round(x), iy = Math.round(y);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = ix + dx, ny = iy + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) obstacle[ny * w + nx] = 1;
    }
}

function drawLine(obstacle, w, h, x0, y0, x1, y1, r) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stamp(obstacle, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r);
  }
}

function buildXmlMask(mapNum, meta) {
  const data = parseMap(mapNum);
  if (!data) return null;
  const w = meta.width, h = meta.height, cell = meta.cell;
  const obstacle = new Uint8Array(w * h);

  let start = null;
  for (const v of data.verts.values()) if (v.prop === 1) { start = v; break; }
  if (!start) return null;

  // Rasterise wall outline (line thickness ~3 px at 1x, 1.5 px radius).
  for (const l of data.lines) {
    if (l.prop !== 0) continue;
    const a = data.verts.get(l.a), b = data.verts.get(l.b);
    if (!a || !b) continue;
    drawLine(obstacle, w, h, a.x, a.y, b.x, b.y, 2);
  }

  // Flood the interior from the start position.
  const reach = new Uint8Array(w * h);
  let sx = Math.max(0, Math.min(w - 1, Math.round(start.x)));
  let sy = Math.max(0, Math.min(h - 1, Math.round(start.y)));
  // Nudge to open pixel.
  if (obstacle[sy * w + sx]) {
    let found = false;
    for (let r = 1; r <= 12 && !found; r++)
      for (let dy = -r; dy <= r && !found; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = sx + dx, ny = sy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!obstacle[ny * w + nx]) { sx = nx; sy = ny; found = true; break; }
        }
    if (!found) return null;
  }
  const q = new Int32Array(w * h);
  let head = 0, tail = 0;
  const s = sy * w + sx;
  reach[s] = 1;
  q[tail++] = s;
  while (head < tail) {
    const cur = q[head++];
    const cx = cur % w;
    const cy = (cur / w) | 0;
    if (cx > 0) { const n = cur - 1; if (!reach[n] && !obstacle[n]) { reach[n] = 1; q[tail++] = n; } }
    if (cx + 1 < w) { const n = cur + 1; if (!reach[n] && !obstacle[n]) { reach[n] = 1; q[tail++] = n; } }
    if (cy > 0) { const n = cur - w; if (!reach[n] && !obstacle[n]) { reach[n] = 1; q[tail++] = n; } }
    if (cy + 1 < h) { const n = cur + w; if (!reach[n] && !obstacle[n]) { reach[n] = 1; q[tail++] = n; } }
  }

  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  let out = "";
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < cols; gx++) {
      let on = 0, tot = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++)
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
          tot++;
          if (reach[y * w + x]) on++;
        }
      out += tot > 0 && on * 2 >= tot ? "1" : "0";
    }
  return { cols, rows, cell, width: w, height: h, data: out };
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const report = [];
for (const file of fs.readdirSync(MASKS)) {
  const mm = file.match(/^map(\d+)\.json$/);
  if (!mm) continue;
  const mapNum = mm[1];
  const colour = JSON.parse(fs.readFileSync(path.join(MASKS, file), "utf8"));
  const xml = buildXmlMask(mapNum, colour);
  if (!xml) continue;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(xml));

  let falseWall = 0, falseFloor = 0, same = 0;
  for (let i = 0; i < colour.cols * colour.rows; i++) {
    const a = colour.data[i] === "1";
    const b = xml.data[i] === "1";
    if (a === b) same++;
    else if (!a && b) falseWall++;
    else falseFloor++;
  }
  report.push({ map: "map" + mapNum, falseWall, falseFloor, same });
}

report.sort((a, b) => b.falseWall + b.falseFloor - (a.falseWall + a.falseFloor));
const totalFW = report.reduce((a, r) => a + r.falseWall, 0);
const totalFF = report.reduce((a, r) => a + r.falseFloor, 0);
console.log(`maps: ${report.length}, total false-wall cells: ${totalFW}, total false-floor cells: ${totalFF}`);
console.log("worst mismatches (falseWall / falseFloor):");
for (const r of report.slice(0, 25)) console.log(`  ${r.map}: ${r.falseWall} / ${r.falseFloor}`);
fs.writeFileSync(path.join(OUT, "_compare.json"), JSON.stringify(report, null, 2));
