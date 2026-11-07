// Imports usable assets from the extracted APK into ./assets.
//   node tools/import-assets.mjs
import fs from "fs";
import path from "path";

const ROOT = path.resolve(".");
const RES = path.join(ROOT, "com.ea.spymouse_row", "files", "res");
const HI = path.join(ROOT, "com.ea.spymouse_row", "files", "res_960x640");
const OUT = path.join(ROOT, "assets");

function ensure(p) { fs.mkdirSync(p, { recursive: true }); }
function copy(src, dst) {
  if (!fs.existsSync(src)) return false;
  ensure(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}

// ---- sprite sheets to bundle --------------------------------------------
// Frame grids are uniform: player frames are 74x74, cat/cheese frames 64x64.
const SPRITES = [
  "player_main", "player_run", "player_idle", "player_sniff", "player_eatcheese",
  "player_lookaround", "player_checkmap", "player_scratch", "player_yoyo", "player_juggle",
  "browncat01", "browncat02", "browncat03", "browncat04", "browncat05",
  "browncat_common", "browncat_idle01", "browncat_rotate",
  "orangecat01", "orangecat02", "orangecat03", "orangecat04", "orangecat05",
  "blackcat01", "blackcat02", "blackcat03", "blackcat04", "blackcat05", "blackcat_common",
  // anim_sequences/black_cat_idle.xml: idle_tv_00..04 (rows cy=5..9), the
  // native sitting-watching-TV animation. 64px cells = 2x the XML's 32
  // design units. Not part of the old <prefix>_common strip.
  "blackcat_idle",
  "bosscat01", "bosscat02", "bosscat03", "bosscat04", "bosscat05", "bosscat_common",
  "blindcat01", "blindcat02", "blindcat03", "blindcat04", "blindcat05",
  "ghostcat_slow01", "ghostcat_slow02", "ghostcat_slow03", "ghostcat_slow04", "ghostcat_slow05",
  "ghostcat_fast01", "ghostcat_fast02", "ghostcat_fast03", "ghostcat_fast04", "ghostcat_fast05",
  "ninjacat01", "ninjacat02", "ninjacat03", "ninjacat04", "ninjacat05", "ninjacat_common",
  "lavacat01", "lavacat02", "lavacat03", "lavacat04", "lavacat05", "lavacat_common",
  "junglecat01", "junglecat02", "junglecat03", "junglecat04", "junglecat05",
  "cheese", "cheese01", "cheese02", "cheese03", "cheese04", "cheese05", "cheese_inf", "cheesetrail_effect",
  // Mechanism art added in the round-1 repair (trap disarm mask, pipe sparkles).
  "mouse_trap_cheesemask", "pipe_sparkles_01", "pipe_sparkles_02", "pipe_sparkles_03",
  "cannon01", "cannon02", "cannon03", "cannon04", "cannon05", "cannon06", "cannon07", "cannon08",
  "timer", "trigger_bomb", "trigger_exclamation", "drawers",
  "teacup01", "teacup02", "teacup03", "teacup04", "teacup05", "teacup06", "teacup07", "teacup08",
  "cwmouse01", "ghostcat_exclamation", "fight",
  "pipe_d", "pipe_r", "pipe_u", "pipe_l",
  "pipe_flipflap_d", "pipe_flipflap_r", "pipe_flipflap_u", "pipe_flipflap_l",
  "mouse_hole_d", "mouse_hole_u", "mouse_hole_l", "mouse_hole_r",
  "home_mousehole_d", "home_mousehole_u", "home_mousehole_l", "home_mousehole_r",
  "key_mousehole_d", "key_mousehole_u", "key_mousehole_l", "key_mousehole_r",
  "munch_hole_d", "munch_hole_u", "munch_hole_l", "munch_hole_r",
  "exit_door", "entrance_door",
  "cat_alert", "cat_angry", "cat_eyes", "cat_peer", "cat_stun", "sleep_ptcl",
  "object_shadow", "shadow_generic",
];

// ---- level list from level_data.xml -------------------------------------
function parseLevelData() {
  const xml = fs.readFileSync(path.join(RES, "level_data.xml"), "utf8");
  const levels = [];
  const re = /<level\s+([^>]*)>([\s\S]*?)<\/level>/g;
  let m;
  while ((m = re.exec(xml))) {
    const head = m[1];
    const body = m[2];
    const attr = (name) => (head.match(new RegExp(name + '\\s*=\\s*"([^"]*)"')) || [])[1];
    const type = body.match(/<type\s+([^>]*)\/>/);
    const ta = (name) => (type ? (type[1].match(new RegExp(name + '\\s*=\\s*"([^"]*)"')) || [])[1] : undefined);
    if (!attr("map")) continue;
    levels.push({
      uid: +attr("uid"),
      map: attr("map"),
      num: attr("num") || "",
      name: attr("name") || "",
      theme: ta("theme") || "",
      mode: ta("mode") || "normal",
      trailLength: ta("trailLength") ? +ta("trailLength") : 1,
    });
  }
  return levels;
}

// ---- run -----------------------------------------------------------------
const report = { sprites: 0, maps: 0, missing: [] };
ensure(OUT);
ensure(path.join(OUT, "sprites"));
ensure(path.join(OUT, "maps"));

for (const s of SPRITES) {
  if (copy(path.join(HI, "sprites", s + ".png"), path.join(OUT, "sprites", s + ".png"))) report.sprites++;
  else report.missing.push("sprites/" + s + ".png");
}
// Boss5 gas-vent art lives in the shipped pack's sprites/boss5/ subdirectory;
// the game addresses it as a flat sheet name (props 279-281).
const BOSS5_SPRITES = ["gas_vent", "gas_stream", "gas_puff", "gas_vent_top"];
for (const s of BOSS5_SPRITES) {
  if (copy(path.join(HI, "sprites", "boss5", s + ".png"), path.join(OUT, "sprites", s + ".png"))) report.sprites++;
  else report.missing.push("sprites/boss5/" + s + ".png");
}

const levels = parseLevelData();
function pickBackground(mapNum) {
  const dir = path.join(HI, "map" + mapNum);
  if (!fs.existsSync(dir)) return null;
  const cands = fs.readdirSync(dir).filter(
    (f) => f.endsWith(".jpg") && !f.includes("_padleft") && !f.includes("_padright")
  );
  if (!cands.length) return null;
  const exact = cands.find((f) => f === "map" + mapNum + ".jpg") || cands.find((f) => f === "map.jpg");
  return path.join(dir, exact || cands[0]);
}
// Segment files: mapNNN.jpg, mapNNN_1.jpg, ... (pads excluded). Suffixed
// variants that also have their own mapNNN_k.xml are alternate floors, not
// horizontal chunks, and are skipped.
function levelSegments(mapNum) {
  const dir = path.join(HI, "map" + mapNum);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => ({ f, m: f.match(/^map(\d+)(?:_(\d+))?\.jpg$/) }))
    .filter(({ m }) => m && m[1] === String(mapNum))
    .map(({ f, m }) => ({ name: f, suffix: m[2] ? +m[2] : 0 }))
    .sort((a, b) => a.suffix - b.suffix);
}
for (const lv of levels) {
  const segs = levelSegments(lv.map);
  if (!segs.length) {
    report.missing.push("map" + lv.map + "/*.jpg");
    continue;
  }
  // Immutable source segments live under assets/maps/_segments/mapNNN/.
  // walkmask stitches from there into assets/maps/mapNNN.jpg, so re-running
  // the mask step can never append the stitched image to itself.
  const segDir = path.join(OUT, "maps", "_segments", "map" + lv.map);
  ensure(segDir);
  let copied = 0;
  for (const s of segs) {
    const altFloorXml = path.join(RES, "map" + lv.map, `map${lv.map}_${s.suffix}.xml`);
    if (s.suffix > 0 && fs.existsSync(altFloorXml)) continue;
    const src = path.join(HI, "map" + lv.map, s.name);
    if (copy(src, path.join(segDir, s.name))) copied++;
    // Keep the raw base available for the editor/index before walkmask runs.
    if (s.suffix === 0) {
      const target=path.join(OUT,"maps",s.name);
      const chunks=segs.filter(segment=>!segment.suffix||!fs.existsSync(path.join(RES,`map${lv.map}`,`map${lv.map}_${segment.suffix}.xml`)));
      // Preserve an existing wide composite during a resource-only import.
      // walkmask rebuilds it from immutable segments during a complete build.
      if(chunks.length===1||!fs.existsSync(target))copy(src,target);
    }
  }
  if (copied) report.maps++;
  report.wideCandidates = report.wideCandidates || [];
  if (segs.length > 1) report.wideCandidates.push(`map${lv.map}:${segs.length}`);
}

fs.writeFileSync(path.join(OUT, "levels.json"), JSON.stringify(levels, null, 2));

// index of every map that has a background + mask (for the level editor)
const mapIndex = [];
for (const f of fs.readdirSync(path.join(OUT, "maps"))) {
  if (!f.endsWith(".jpg")) continue;
  const id = f.replace(/\.jpg$/, "");
  if (fs.existsSync(path.join(OUT, "masks", id + ".json"))) mapIndex.push(id);
}
mapIndex.sort((a, b) => (parseInt(a.replace("map", "")) - parseInt(b.replace("map", ""))));
fs.writeFileSync(path.join(OUT, "maps", "index.json"), JSON.stringify(mapIndex, null, 2));
console.log(`maps with masks: ${mapIndex.length}`);

console.log(`sprites copied: ${report.sprites}`);
console.log(`map backgrounds: ${report.maps}`);
console.log(`levels parsed: ${levels.length}`);
if (report.missing.length) {
  console.log(`missing (${report.missing.length}):`);
  report.missing.slice(0, 30).forEach((x) => console.log("  " + x));
}
