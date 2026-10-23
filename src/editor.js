import { World } from "./world.js";
import { Sprites } from "./sprites.js";

const canvas = document.getElementById("edcanvas");
const ctx = canvas.getContext("2d");
const mapSel = document.getElementById("mapSel");
const fId = document.getElementById("fId");
const fNum = document.getElementById("fNum");
const fTheme = document.getElementById("fTheme");
const edjson = document.getElementById("edjson");

const sprites = new Sprites();
sprites.load();

const state = {
  mapId: "map10",
  world: null,
  bg: null,
  mask: null,
  mouseStart: null,
  exit: null,
  cheeses: [],
  cats: [],
  tool: "mouse",
  catDraft: null,
  history: [],
  cam: { scale: 1, ox: 0, oy: 0 },
  dpr: 1,
};

function snapshot() {
  state.history.push(JSON.stringify(collect()));
  if (state.history.length > 50) state.history.shift();
}

function collect() {
  return {
    id: state.mapId,
    num: fNum.value,
    name: fId.value || state.mapId,
    theme: fTheme.value,
    bg: `assets/maps/${state.mapId}.jpg`,
    mask: `assets/masks/${state.mapId}.json`,
    mouseStart: state.mouseStart,
    exit: state.exit,
    cheeses: state.cheeses,
    cats: state.cats,
  };
}

async function loadMap(mapId) {
  state.mapId = mapId;
  const [mask, bg] = await Promise.all([
    fetch(`assets/masks/${mapId}.json`).then((r) => r.json()),
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = `assets/maps/${mapId}.jpg`;
    }),
  ]);
  state.mask = mask;
  state.world = World.fromMask(mask);
  state.bg = bg;
  state.mouseStart = state.exit = null;
  state.cheeses = [];
  state.cats = [];
  fId.value = mapId;
  resize();
  updateJson();
}

function resize() {
  const wrap = document.getElementById("edcanvasWrap");
  const r = wrap.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = r.width * state.dpr;
  canvas.height = r.height * state.dpr;
  if (state.world) {
    const w = state.world.w;
    const h = state.world.h;
    const scale = Math.min((r.width - 20) / w, (r.height - 20) / h);
    state.cam = { scale, ox: (r.width - w * scale) / 2, oy: (r.height - h * scale) / 2 };
  }
}

function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left - state.cam.ox) / state.cam.scale,
    y: (e.clientY - r.top - state.cam.oy) / state.cam.scale,
  };
}

function snap(p) {
  return state.world ? state.world.closestOpen(p.x, p.y) : p;
}

function draw() {
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.world) return;
  const { scale, ox, oy } = state.cam;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  if (state.bg) ctx.drawImage(state.bg, 0, 0, state.world.w, state.world.h);

  // walkable tint
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#00ff88";
  for (let y = 0; y < state.world.rows; y++)
    for (let x = 0; x < state.world.cols; x++)
      if (!state.world.isWall(x, y)) ctx.fillRect(x * state.world.cell, y * state.world.cell, state.world.cell, state.world.cell);
  ctx.globalAlpha = 1;

  const u = state.world.cell;
  // cats + routes
  for (const c of state.cats) {
    if (c.route && c.route.length > 1) {
      ctx.beginPath();
      ctx.moveTo(c.route[0].x, c.route[0].y);
      for (const p of c.route) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = "rgba(255,90,90,.85)";
      ctx.lineWidth = u * 0.2;
      ctx.stroke();
    }
    drawCat(c.x, c.y, u);
  }
  if (state.catDraft) {
    const c = state.catDraft;
    ctx.beginPath();
    ctx.moveTo(c.route[0].x, c.route[0].y);
    for (const p of c.route) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "rgba(255,170,60,.9)";
    ctx.lineWidth = u * 0.2;
    ctx.stroke();
  }
  for (const ch of state.cheeses) drawCheese(ch.x, ch.y, u);
  if (state.exit) drawExit(state.exit.x, state.exit.y, u);
  if (state.mouseStart) drawMouse(state.mouseStart.x, state.mouseStart.y, u);
  ctx.restore();
}

function drawCheese(x, y, u) {
  if (sprites.ready("cheese")) return void sprites.frame(ctx, "cheese", Math.floor(performance.now() / 160), x, y, u * 1.9, u * 1.9);
  ctx.fillStyle = "#ffcf3f";
  ctx.beginPath();
  ctx.moveTo(x - u * 0.4, y + u * 0.3);
  ctx.lineTo(x + u * 0.4, y + u * 0.3);
  ctx.lineTo(x, y - u * 0.4);
  ctx.closePath();
  ctx.fill();
}
function drawExit(x, y, u) {
  if (sprites.ready("mousehole")) return void sprites.frame(ctx, "mousehole", 0, x, y, u * 3, u * 3);
  ctx.fillStyle = "#05080b";
  ctx.beginPath();
  ctx.arc(x, y, u * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8ff0e4";
  ctx.stroke();
}
function drawMouse(x, y, u) {
  if (sprites.ready("playerRun")) return void sprites.playerFrame(ctx, performance.now() / 1000, x, y, u * 2.9, u * 2.9, 0);
  ctx.fillStyle = "#cdd6df";
  ctx.beginPath();
  ctx.arc(x, y, u * 0.5, 0, Math.PI * 2);
  ctx.fill();
}
function drawCat(x, y, u) {
  if (sprites.ready("browncat_down")) return void sprites.catFrame(ctx, "browncat", performance.now() / 600, x, y, u * 3.4, u * 3.4, Math.PI / 2);
  ctx.fillStyle = "#f28b30";
  ctx.beginPath();
  ctx.arc(x, y, u * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

// ---- editing -------------------------------------------------------------

let mode = null; // 'cat-drag' | 'erase-drag'
let dragging = false;

canvas.addEventListener("pointerdown", (e) => {
  if (!state.world) return;
  canvas.setPointerCapture(e.pointerId);
  const w = snap(toWorld(e));
  const t = state.tool;
  if (t === "mouse") {
    snapshot();
    state.mouseStart = w;
  } else if (t === "exit") {
    snapshot();
    state.exit = w;
  } else if (t === "cheese") {
    snapshot();
    state.cheeses.push(w);
  } else if (t === "cat") {
    snapshot();
    state.catDraft = { x: w.x, y: w.y, angle: Math.PI / 2, route: [w] };
    mode = "cat-drag";
  } else if (t === "erase") {
    eraseAt(w);
    mode = "erase-drag";
  }
  updateJson();
});

canvas.addEventListener("pointermove", (e) => {
  if (!state.world) return;
  const w = snap(toWorld(e));
  if (mode === "cat-drag" && state.catDraft) {
    const last = state.catDraft.route[state.catDraft.route.length - 1];
    if (Math.hypot(last.x - w.x, last.y - w.y) > state.world.cell) state.catDraft.route.push(w);
  } else if (mode === "erase-drag") {
    eraseAt(w);
  }
});

canvas.addEventListener("pointerup", () => {
  if (mode === "cat-drag" && state.catDraft) {
    const c = state.catDraft;
    const route = c.route.length > 1 ? c.route : [{ x: c.x, y: c.y }];
    let angle = Math.PI / 2;
    if (route.length > 1) {
      const a = route[route.length - 1];
      angle = Math.atan2(a.y - c.y, a.x - c.x);
    }
    state.cats.push({ x: c.x, y: c.y, angle, route });
    state.catDraft = null;
    updateJson();
  }
  mode = null;
});

function eraseAt(w) {
  const u = state.world.cell;
  const near = (p) => Math.hypot(p.x - w.x, p.y - w.y) < u;
  if (state.mouseStart && near(state.mouseStart)) return (state.mouseStart = null), updateJson();
  if (state.exit && near(state.exit)) return (state.exit = null), updateJson();
  for (let i = state.cheeses.length - 1; i >= 0; i--) if (near(state.cheeses[i])) return (state.cheeses.splice(i, 1), updateJson());
  for (let i = state.cats.length - 1; i >= 0; i--) {
    const c = state.cats[i];
    if (near(c) || (c.route && c.route.some(near))) return (state.cats.splice(i, 1), updateJson());
  }
}

// ---- ui ------------------------------------------------------------------

for (const btn of document.querySelectorAll(".tool[data-tool]")) {
  btn.addEventListener("click", () => {
    state.tool = btn.dataset.tool;
    document.querySelectorAll(".tool[data-tool]").forEach((b) => b.classList.toggle("active", b === btn));
  });
}

document.getElementById("btnUndo").addEventListener("click", () => {
  const prev = state.history.pop();
  if (!prev) return;
  apply(JSON.parse(prev));
});

document.getElementById("btnClear").addEventListener("click", () => {
  snapshot();
  state.mouseStart = state.exit = null;
  state.cheeses = [];
  state.cats = [];
  updateJson();
});

document.getElementById("btnLoad").addEventListener("click", async () => {
  try {
    const def = JSON.parse(edjson.value);
    const m = (def.mask || "").match(/masks\/(map\d+)\.json/);
    if (m && m[1] !== state.mapId) {
      mapSel.value = m[1];
      await loadMap(m[1]);
    }
    apply(def);
  } catch (e) {
    alert("Invalid JSON: " + e.message);
  }
});

document.getElementById("btnCopy").addEventListener("click", async () => {
  updateJson();
  try {
    await navigator.clipboard.writeText(edjson.value);
    flash("Copied!");
  } catch {
    edjson.select();
  }
});

document.getElementById("btnDownload").addEventListener("click", () => {
  updateJson();
  const blob = new Blob([edjson.value], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fId.value || state.mapId}.json`;
  a.click();
});

function apply(def) {
  state.mouseStart = def.mouseStart || null;
  state.exit = def.exit || null;
  state.cheeses = def.cheeses || [];
  state.cats = def.cats || [];
  if (def.num) fNum.value = def.num;
  if (def.name) fId.value = def.name;
  if (def.theme) fTheme.value = def.theme;
  updateJson();
}

function updateJson() {
  edjson.value = JSON.stringify(collect(), null, 2);
}

function flash(msg) {
  const hint = document.getElementById("edhint");
  const old = hint.textContent;
  hint.textContent = msg;
  setTimeout(() => (hint.textContent = old), 900);
}

function loop() {
  draw();
  requestAnimationFrame(loop);
}

async function boot() {
  const index = await fetch("assets/maps/index.json").then((r) => r.json()).catch(() => []);
  mapSel.innerHTML = "";
  for (const id of index) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    mapSel.appendChild(o);
  }
  mapSel.addEventListener("change", () => loadMap(mapSel.value));
  window.addEventListener("resize", resize);
  await loadMap(index.includes("map10") ? "map10" : index[0]);
  loop();
}

boot();
