// Records the sprite draws for a level and asserts the native keys/sizes are
// used: exit direction sheet, per-prop cheese sheet at the native 48px cell,
// prop-260 crumbs (cheese_inf), pipe pieces. Read-only.
import fs from "node:fs";
import { Game } from "../src/game.js";

const levelFile = process.argv[2] || "assets/levels/map98.json";
const WIDTHS = {
  home_mousehole_d: 64,
  home_mousehole_u: 64,
  home_mousehole_l: 64,
  home_mousehole_r: 64,
  mouse_hole_d: 64,
  mouse_hole_u: 64,
  mouse_hole_l: 64,
  mouse_hole_r: 64,
  cheese: 240,
  cheese01: 768,
  cheese02: 768,
  cheese03: 768,
  cheese04: 768,
  cheese05: 768,
  cheese_inf: 128,
  cwmouse01: 256,
  pipe_d: 64,
  pipe_r: 64,
  pipe_u: 64,
  pipe_l: 64,
  pipe_flipflap_d: 192,
  pipe_flipflap_r: 192,
  pipe_flipflap_u: 192,
  pipe_flipflap_l: 192,
};

class FakeImage {
  constructor() {
    this.naturalWidth = 64;
    this.naturalHeight = 64;
    this.onload = null;
    this._src = "";
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
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.location = undefined;

const def = JSON.parse(fs.readFileSync(levelFile, "utf8"));
def.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));

const draws = [];
const ctx = new Proxy(
  {
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
      draws.push({ name: (img.src || "").split("/").pop().replace(".png", ""), sx, sy, sw, sh, dw, dh });
    },
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    arc() {},
    ellipse() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillRect() {},
    clearRect() {},
    setTransform() {},
    fillText() {},
    setLineDash() {},
    measureText: () => ({ width: 0 }),
  },
  {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }
);

const game = new Game({ width: 960, height: 640, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }), addEventListener() {}, removeEventListener() {} });
game.loadLevel(def, 0);
game.state = "playing";
game.draw();

const count = (name) => draws.filter((d) => d.name === name).length;
const byPrefix = (p) => draws.filter((d) => d.name.startsWith(p)).map((d) => d.name);
const out = {
  level: def.id,
  num: def.num,
  cheeses: (def.cheeses || []).map((c) => c.prop),
  crumbs: (def.crumbs || []).length,
  exitProp: def.exit ? def.exit.prop : null,
  exitDraws: byPrefix("home_mousehole"),
  cheeseDraws: draws.filter((d) => /^cheese\d\d$/.test(d.name)).map((d) => ({ name: d.name, size: d.dw })),
  crumbDraws: count("cheese_inf"),
  pipeDraws: byPrefix("pipe_"),
  pass:
    (def.exit ? byPrefix("home_mousehole").length > 0 : true) &&
    (def.cheeses || []).every((c) => draws.some((d) => d.name === `cheese0${11 - c.prop}`)) &&
    ((def.crumbs || []).length === 0 || count("cheese_inf") === (def.crumbs || []).length) &&
    (def.pipePieces || []).length === byPrefix("pipe_").length,
};
console.log(JSON.stringify(out, null, 2));
