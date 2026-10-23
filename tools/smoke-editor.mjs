// Headless smoke test for the level editor.
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const root = path.resolve(".");

function makeCtx() {
  const noop = () => {};
  return {
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop, save: noop, restore: noop,
    translate: noop, scale: noop, rotate: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, arc: noop, ellipse: noop, fill: noop, stroke: noop, drawImage: noop, fillText: noop,
    setLineDash: noop, measureText: () => ({ width: 10 }),
  };
}
function makeEl() {
  return {
    style: {}, children: [], textContent: "", innerHTML: "", value: "", dataset: {}, disabled: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() {}, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {}, select() {}, click() {},
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 700 }; },
    setPointerCapture() {},
  };
}

const cache = {};
globalThis.window = { devicePixelRatio: 2, addEventListener() {}, requestAnimationFrame(cb) { cache._raf = cb; } };
globalThis.document = {
  getElementById: (id) => (cache[id] ||= makeEl()),
  createElement: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.performance = { now: () => Date.now() };
globalThis.Image = class { set src(v) { queueMicrotask(() => this.onload && this.onload()); } };
globalThis.Blob = class {};
globalThis.URL.createObjectURL = () => "blob:";
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.fetch = async (url) => {
  const fp = path.join(root, String(url).split("?")[0]);
  if (!fs.existsSync(fp)) return { ok: false, status: 404 };
  const body = fs.readFileSync(fp);
  return { ok: true, status: 200, json: async () => JSON.parse(body.toString("utf8")), text: async () => body.toString("utf8") };
};

const errors = [];
process.on("uncaughtException", (e) => errors.push(e));
process.on("unhandledRejection", (e) => errors.push(e));

try {
  await import(pathToFileURL(path.join(root, "src", "editor.js")).href);
} catch (e) {
  errors.push(e);
}
await new Promise((r) => setTimeout(r, 120));
if (cache._raf) { try { cache._raf(performance.now()); } catch (e) { errors.push(e); } }

console.log(errors.length ? "EDITOR SMOKE FAIL" : "EDITOR SMOKE OK");
for (const e of errors) console.log("  " + (e && e.stack ? e.stack.split("\n").slice(0, 5).join("\n  ") : e));
process.exit(errors.length ? 1 : 0);
