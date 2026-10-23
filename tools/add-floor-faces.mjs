// Adds floor faces (bounded by the original XML lines, Property = 0) that
// contain gameplay entities back into the colour-derived masks. This recovers
// rugs/mats/shaded floor that colour segmentation classified as walls, while
// leaving walls and furniture untouched.
//   node tools/add-floor-faces.mjs
import fs from "fs";
import path from "path";

const ROOT = path.resolve(".");
const RES = path.join(ROOT, "com.ea.spymouse_row", "files", "res");
const MASKS = path.join(ROOT, "assets", "masks");

function parseMap(mapNum) {
  const file = path.join(RES, "map" + mapNum, "map" + mapNum + ".xml");
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8");
  const verts = new Map();
  const lines = [];
  const ents = [];
  for (const m of xml.matchAll(/<Vertex\s+([^>]*)\/>/g)) {
    const a = m[1];
    const g = (k) => {
      const r = a.match(new RegExp(k + '\\s*=\\s*(-?\\d+)'));
      return r ? +r[1] : 0;
    };
    const v = { x: 2 * g("x") + 32, y: 2 * g("y") + 64, prop: g("Property"), flags: g("Flags") };
    verts.set(g("id"), v);
    if (v.flags === 10) {
      const p = v.prop;
      if (p === 1 || (p >= 6 && p <= 10) || (p >= 240 && p <= 243) || (p >= 50 && p <= 59))
        ents.push(v);
    }
  }
  for (const m of xml.matchAll(/<Line\s+([^>]*)\/>/g)) {
    const a = m[1];
    const g = (k) => {
      const r = a.match(new RegExp(k + '\\s*=\\s*(-?\\d+)'));
      return r ? +r[1] : 0;
    };
    if (g("Property") !== 0) continue;
    lines.push({ a: g("VertexA"), b: g("VertexB") });
  }
  return { verts, lines, ents };
}

function stampBarrier(barrier, w, h, x, y, r) {
  const ix = Math.round(x), iy = Math.round(y);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = ix + dx, ny = iy + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) barrier[ny * w + nx] = 1;
    }
}

let modified = 0;
let addedCells = 0;

for (const file of fs.readdirSync(MASKS)) {
  const mm = file.match(/^map(\d+)\.json$/);
  if (!mm) continue;
  const data = parseMap(mm[1]);
  if (!data) continue;

  const maskPath = path.join(MASKS, file);
  const mask = JSON.parse(fs.readFileSync(maskPath, "utf8"));
  const w = mask.width, h = mask.height, cell = mask.cell;
  const cols = mask.cols, rows = mask.rows;

  const barrier = new Uint8Array(w * h);
  for (const l of data.lines) {
    const a = data.verts.get(l.a), b = data.verts.get(l.b);
    if (!a || !b) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampBarrier(barrier, w, h, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 1);
    }
  }

  const visited = new Uint8Array(w * h);
  const extra = new Uint8Array(w * h);

  for (const e of data.ents) {
    let sx = Math.max(0, Math.min(w - 1, Math.round(e.x)));
    let sy = Math.max(0, Math.min(h - 1, Math.round(e.y)));
    if (barrier[sy * w + sx]) {
      let found = false;
      for (let r = 1; r <= 10 && !found; r++)
        for (let dy = -r; dy <= r && !found; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const nx = sx + dx, ny = sy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (!barrier[ny * w + nx]) { sx = nx; sy = ny; found = true; break; }
          }
      if (!found) continue;
    }
    const start = sy * w + sx;
    if (visited[start]) continue;

    const q = new Int32Array(w * h);
    let head = 0, tail = 0;
    q[tail++] = start;
    visited[start] = 1;
    const face = [];
    let touchesBorder = false;

    while (head < tail) {
      const cur = q[head++];
      face.push(cur);
      const cx = cur % w, cy = (cur / w) | 0;
      if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touchesBorder = true;
      const nb = [
        cx > 0 ? cur - 1 : -1,
        cx + 1 < w ? cur + 1 : -1,
        cy > 0 ? cur - w : -1,
        cy + 1 < h ? cur + w : -1,
      ];
      for (const n of nb) {
        if (n < 0 || visited[n] || barrier[n]) continue;
        visited[n] = 1;
        q[tail++] = n;
      }
    }

    // Skip the outdoor background face.
    if (touchesBorder) continue;
    for (const p of face) extra[p] = 1;
  }

  // Union the recovered floor faces into the colour mask.
  const grid = mask.data.split("");
  let changed = false;
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < cols; gx++) {
      if (grid[gy * cols + gx] === "1") continue;
      let on = 0, tot = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++)
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
          tot++;
          if (extra[y * w + x]) on++;
        }
      if (tot > 0 && on * 2 >= tot) {
        grid[gy * cols + gx] = "1";
        addedCells++;
        changed = true;
      }
    }

  if (changed) {
    mask.data = grid.join("");
    fs.writeFileSync(maskPath, JSON.stringify(mask));
    modified++;
  }
}

console.log(`added ${addedCells} floor cells across ${modified} maps`);
