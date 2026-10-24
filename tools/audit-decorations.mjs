// Decoration / item-animation audit.
//   node tools/audit-decorations.mjs
// Reads only repo assets + source constants; does not touch the game.
import fs from "node:fs";
import path from "node:path";
import { ITEM_PROPS, MECHANISM_SHEETS } from "../src/mechanism-types.js";

const root = process.cwd();
const sprites = path.join(root, "assets", "sprites");
const nativeSprites = path.join(root, "com.ea.spymouse_row", "files", "res_960x640", "sprites");
const nativeFluff = path.join(root, "com.ea.spymouse_row", "files", "res_960x640", "mapfluff");

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function exists(...parts) { return fs.existsSync(path.join(...parts)); }
const rows = [];
function row(kind, name, status, detail) { rows.push({ kind, name, status, detail }); }

// Item art: every item must resolve to a sheet, and the sheet must exist.
const ITEM_ART = {
  string: "twine_ball", chilli: "cheese_speed", chilli2: "speedy", cover: "teacup",
  fish: "catnip", balloon: "balloon", dossier: "dossier_icon",
  robodog: "robodog_broken01", keepsake: "keepsake", cheese_inf: "cheese_inf"
};
// cheese_inf is registered in src/sprites.js (32x32, not a mechanism sheet).
const SPECIAL_SHEETS = { cheese_inf: [32, 32] };
for (const [item, art] of Object.entries(ITEM_ART)) {
  const file = path.join(sprites, art + ".png");
  if (!fs.existsSync(file)) { row("item", item, "MISSING", `${art}.png`); continue; }
  const size = pngSize(file);
  const sheet = MECHANISM_SHEETS[art] || SPECIAL_SHEETS[art];
  row("item", item, sheet ? "OK" : "UNREGISTERED", `${art}.png ${size?.w}x${size?.h}, sheet=${sheet || "-"}`);
}

// Native picks / ambient decorations that the web must at least ship.
const fluff = [
  ["bush", "bush.png", [72, 72], "4 frames x 72x72; native mapfluff/bush.png"],
  ["ambush_01", "ambush_01.png", [188, 175], "single plant decoration"],
  ["ambush_02", "ambush_02.png", [154, 142], "single plant decoration"],
];
for (const [key, file, expected, note] of fluff) {
  const local = path.join(sprites, file);
  if (!fs.existsSync(local)) { row("decoration", key, "MISSING", note); continue; }
  const size = pngSize(local);
  const ok = size && (!expected || (size.w % expected[0] === 0 && size.h % expected[1] === 0));
  row("decoration", key, ok ? "ASSET_OK" : "SIZE_MISMATCH", `${size?.w}x${size?.h}; ${note}`);
}

// Native filenames that existed in the APK but are not imported into the runnable asset set.
const nativeMissing = [];
if (fs.existsSync(nativeSprites)) {
  for (const f of fs.readdirSync(nativeSprites)) {
    if (!/\.png$/i.test(f)) continue;
    if (!fs.existsSync(path.join(sprites, f))) nativeMissing.push(f);
  }
}
row("native-sprites", "not-imported", nativeMissing.length ? "INFO" : "OK", `${nativeMissing.length} native sprite files not in assets/sprites`);

// Native mapfluff files not imported.
const nativeFluffMissing = [];
if (fs.existsSync(nativeFluff)) {
  for (const f of fs.readdirSync(nativeFluff)) {
    if (!/\.png$/i.test(f)) continue;
    if (!fs.existsSync(path.join(sprites, f))) nativeFluffMissing.push(f);
  }
}
row("native-mapfluff", "not-imported", nativeFluffMissing.length ? "INFO" : "OK", `${nativeFluffMissing.length} mapfluff files not in assets/sprites`);

const out = {
  generatedAt: new Date().toISOString(),
  summary: {
    rows: rows.length,
    missing: rows.filter(r => r.status === "MISSING").length,
    unregistered: rows.filter(r => r.status === "UNREGISTERED").length,
    nativeMissing: nativeMissing.length,
    nativeFluffMissing: nativeFluffMissing.length,
  },
  nativeSpriteMissing: nativeMissing,
  nativeMapfluffMissing: nativeFluffMissing,
  rows,
};
fs.mkdirSync(path.join(root, "analysis"), { recursive: true });
fs.writeFileSync(path.join(root, "analysis", "decorations-audit.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary, null, 2));
for (const r of rows) console.log(`${r.status.padEnd(13)} ${r.kind}/${r.name}: ${r.detail}`);
