// Headless frame-selection verification for the sprite mapping (parallel-J3):
// cat sheets are multi-animation strips (0-3 walk, 5-8 alert/chase, 9+
// specials) and cheese uses cheese0(11-prop).png. Records the drawImage source
// rectangle and asserts the frame ranges per state/type.
import { Sprites, catPrefixFor } from "../src/sprites.js";

const WIDTHS = {
  cheese: 240,
  cheese01: 768,
  cheese02: 768,
  cheese03: 768,
  cheese04: 768,
  cheese05: 768,
};
const PREFIX_WIDTH = {
  browncat: 640,
  orangecat: 896,
  blackcat: 1024,
  bosscat: 256,
  blindcat: 256,
  ghostcat_slow: 576,
  ghostcat_fast: 576,
  ninjacat: 1024,
  lavacat: 1024,
  junglecat: 1024,
};
for (const [prefix, w] of Object.entries(PREFIX_WIDTH)) {
  for (const dir of ["01", "02", "03", "04", "05"]) WIDTHS[`${prefix}${dir}`] = w;
}

class FakeImage {
  constructor() {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this._src = "";
    this.onload = null;
  }
  set src(v) {
    this._src = v;
    const name = v.split("/").pop().replace(".png", "");
    this.naturalWidth = WIDTHS[name] || 64;
    this.naturalHeight = 64;
    if (this.onload) this.onload();
  }
  get src() {
    return this._src;
  }
}

globalThis.Image = FakeImage;
globalThis.location = undefined;

const recorded = [];
const ctx = {
  save() {}, restore() {}, translate() {}, scale() {},
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    recorded.push({ img, sx, sy, sw, sh, dx, dy, dw, dh });
  },
};

const sprites = new Sprites();
sprites.load();

const DIRS = ["up", "upLeft", "left", "downLeft", "down", "downRight", "right", "upRight"];
const ANGLES = { up: -Math.PI / 2, upLeft: -3*Math.PI/4, left: Math.PI, downLeft: 3*Math.PI/4, down: Math.PI/2, downRight: Math.PI/4, right: 0, upRight: -Math.PI/4 };
const STATES = [
  { state: "patrol", min: 0, max: 3 },
  { state: "return", min: 0, max: 3 },
  { state: "spot", min: 5, max: 8 },
  { state: "chase", min: 5, max: 8 },
  { state: "stunned", min: 9, max: 12 },
];
const TYPES = [
  { type: 0, prefix: "browncat" },
  { type: 1, prefix: "orangecat" },
  { type: 2, prefix: "blackcat" },
  { type: 3, prefix: "bosscat" },
  { type: 4, prefix: "blindcat" },
  { type: 5, prefix: "ghostcat_slow", stateOverrides: { chase: "ghostcat_fast", spot: "ghostcat_fast" } },
  { type: 6, prefix: "ninjacat" },
  { type: 7, prefix: "lavacat" },
  { type: 8, prefix: "bosscat" },
  { type: 9, prefix: "bosscat" },
  { type: 10, prefix: "junglecat" },
];

const failures = [];
const cases = [];
for (const t of TYPES) {
  for (const dir of DIRS) {
    for (const s of STATES) {
      const cat = { type: t.type, prop: 50 + t.type };
      let prefix = catPrefixFor(cat, s.state);
      if (t.stateOverrides && t.stateOverrides[s.state]) prefix = t.stateOverrides[s.state];
      recorded.length = 0;
      const ok = sprites.catFrame(ctx, prefix, s.state, 0.25, 10, 10, 32, 32, ANGLES[dir]);
      if (!ok) {
        failures.push({ type: t.type, dir, state: s.state, reason: "frame-not-ready" });
        continue;
      }
      const rec = recorded[0];
      const col = Math.round(rec.sx / 64);
      const DIR_NUM = { up: "01", upLeft: "02", left: "03", downLeft: "04", down: "05", downRight: "04", right: "03", upRight: "02" };
      const cols = Math.floor((WIDTHS[`${prefix}${DIR_NUM[dir]}`] || 64) / 64);
      let min = s.min;
      let max = s.max;
      if (s.state === "stunned") {
        // Native uses common-sheet frames 19-22 where available; the
        // direction sheets only have a special frame 9 (brown crouch), so the
        // implementation clamps to 9..cols-1 or falls back to walk.
        if (cols > 9) {
          min = 9;
          max = Math.min(12, cols - 1);
        } else {
          min = 0;
          max = Math.min(3, cols - 1);
        }
      } else if (max >= cols) {
        min = 0;
        max = Math.min(3, cols - 1);
      }
      const pass = col >= min && col <= max;
      cases.push({ type: t.type, dir, state: s.state, prefix, col, cols, expected: [min, max], pass });
      if (!pass) failures.push({ type: t.type, dir, state: s.state, prefix, col, expected: [min, max] });
    }
  }
}

// Cheese: prop 6 -> cheese05 ... prop 10 -> cheese01, 16 frames.
const cheeseCases = [];
for (let prop = 6; prop <= 10; prop++) {
  const key = `cheese0${11 - prop}`;
  recorded.length = 0;
  const ok = sprites.frame(ctx, key, 3, 10, 10, 32, 32);
  const rec = recorded[0];
  const pass = ok && rec && Math.round(rec.sx / 48) === 3 && Math.floor((WIDTHS[key] || 0) / 48) === 16;
  cheeseCases.push({ prop, key, pass, frame: rec ? Math.round(rec.sx / 48) : null, cols: Math.floor((WIDTHS[key] || 0) / 48) });
  if (!pass) failures.push({ cheese: prop, key });
}

console.log(
  JSON.stringify(
    {
      cases: cases.length,
      failures: failures.length,
      failuresDetail: failures.slice(0, 12),
      cheeseCases,
      sample: cases.slice(0, 8),
    },
    null,
    2
  )
);
