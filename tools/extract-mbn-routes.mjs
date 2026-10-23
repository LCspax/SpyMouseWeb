// Extracts authentic cat patrol routes from the decoded .mbn map graph.
// Proven in analysis/parallel/E2/findings.md:
//   0x7042c walks the map+0x348 line array from a Property-101 vertex whose
//   Tag matches the cat's spawn Tag, emitting {x,y,wait} points.
// Output: assets/levels/routes-native/mapNNN.json (source mbn-graph-walk).
import fs from "node:fs";
import path from "node:path";
import { parseMbn } from "./decode-mbn.mjs";

const RES = path.join("com.ea.spymouse_row", "files", "res");
const OUT = path.join("assets", "levels", "routes-native");
const index = JSON.parse(fs.readFileSync(path.join("assets", "levels", "index.json"), "utf8"));

// mbn y is flipped relative to XML design y: mbn y = 320 - xml y.
// World pixels: x = 2*designX + 32, y = 2*(320 - mbnY) + 64.
import {buildRoute} from './native-routes.mjs';

let written = 0;
const summary = [];
for (const entry of index) {
  const mapNum = entry.id.replace(/^map/, "");
  const mbnPath = path.join(RES, `map${mapNum}`, `map${mapNum}.mbn`);
  if (!fs.existsSync(mbnPath)) continue;
  let info;
  try {
    info = parseMbn(mbnPath);
  } catch (e) {
    summary.push({ map: entry.id, error: String(e.message || e) });
    continue;
  }
  // Extract every route-start marker in the map, not only tags present in the
  // current imported def: the importer may keep more cats after connectivity
  // fixes, and re-running the importer must not need the extractor first.
  const tags = [
    ...new Set(
      info.vertices
        .filter((v) => v.prop === 101 || v.prop === 130 || v.prop === 132)
        .map((v) => Math.abs(v.tag))
        .filter((t) => t !== 0)
    ),
  ];
  const routes = [];
  for (const tag of tags) {
    const r = buildRoute(info, tag);
    if (r && r.points.length >= 1) routes.push({ ...r, stationary: r.stationary === true || r.points.length < 2 });
  }
  if (!routes.length) {
    summary.push({ map: entry.id, routes: 0 });
    continue;
  }
  const out = {
    source: "mbn-graph-walk",
    map: entry.id,
    mbn: `map${mapNum}.mbn`,
    routes,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${entry.id}.json`), JSON.stringify(out, null, 2));
  written++;
  summary.push({ map: entry.id, routes: routes.length, points: routes.map((r) => r.points.length) });
}

console.log(JSON.stringify({ written, summary }, null, 2));
