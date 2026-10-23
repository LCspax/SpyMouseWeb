// Applies checked-in mask patches after the colour walkmask pass.
//
// The colour walkmask (tools/walkmask.ps1) keeps one floor colour region per
// map, so rooms whose floor differs slightly (or that are overprinted by hole
// sprites) can be missed. Patches are generated from original evidence by the
// H1 rule (art floor-likeness + gap-sealed XML prop-0 enclosure + authored hole
// mouths) and stored per map under assets/masks/patches/mapNNN.json. This tool
// only flips WALL -> FLOOR for the listed cells; it never touches floor cells,
// entities or coordinates.
//
//   node tools/patch-masks.mjs [--check] [map...]
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const MASKS = path.join(ROOT, "assets", "masks");
const PATCHES = path.join(MASKS, "patches");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const wanted = args.filter((a) => /^\d+$/.test(a));

if (!fs.existsSync(PATCHES)) {
  console.log("no mask patches");
  process.exit(0);
}
const files = fs
  .readdirSync(PATCHES)
  .filter((f) => /^map\d+\.json$/.test(f))
  .filter((f) => !wanted.length || wanted.includes(f.match(/\d+/)[0]));

let totalApplied = 0;
let totalAlready = 0;
const results = [];
for (const f of files) {
  const patch = JSON.parse(fs.readFileSync(path.join(PATCHES, f), "utf8"));
  const maskPath = path.join(MASKS, f);
  if (!fs.existsSync(maskPath)) {
    results.push({ map: f, error: "missing mask" });
    continue;
  }
  const mask = JSON.parse(fs.readFileSync(maskPath, "utf8"));
  if (mask.cell !== patch.cell) {
    results.push({ map: f, error: `cell mismatch mask=${mask.cell} patch=${patch.cell}` });
    continue;
  }
  const chars = String(mask.data).split("");
  let applied = 0;
  let already = 0;
  let outOfBounds = 0;
  for (const c of patch.changedCells) {
    if (c.tx < 0 || c.ty < 0 || c.tx >= mask.cols || c.ty >= mask.rows) {
      outOfBounds++;
      continue;
    }
    const i = c.ty * mask.cols + c.tx;
    if (chars[i] === "1") {
      already++;
      continue;
    }
    if (chars[i] !== "0") {
      outOfBounds++;
      continue;
    }
    chars[i] = "1";
    applied++;
  }
  mask.data = chars.join("");
  const expected = patch.changedCells.length - outOfBounds;
  const finalOpen = patch.changedCells.filter((c) => {
    if (c.tx < 0 || c.ty < 0 || c.tx >= mask.cols || c.ty >= mask.rows) return true;
    return mask.data[c.ty * mask.cols + c.tx] === "1";
  }).length;
  if (!checkOnly && applied) fs.writeFileSync(maskPath, JSON.stringify(mask));
  totalApplied += applied;
  totalAlready += already;
  results.push({
    map: f,
    cells: patch.changedCells.length,
    applied: checkOnly ? 0 : applied,
    alreadyFloor: already,
    outOfBounds,
    finalOpen,
    expected,
    ok: finalOpen === patch.changedCells.length,
  });
}
for (const r of results) {
  if (r.error) console.log(`ERROR ${r.map}: ${r.error}`);
  else
    console.log(
      `${checkOnly ? "check" : "apply"} ${r.map}: cells=${r.cells} applied=${r.applied} already=${r.alreadyFloor} finalOpen=${r.finalOpen}/${r.cells}${r.ok ? "" : " NOT-OK"}`
    );
}
console.log(`total: ${totalApplied} applied, ${totalAlready} already floor`);
const bad = results.filter((r) => r.error || !r.ok);
process.exit(bad.length ? 1 : 0);
