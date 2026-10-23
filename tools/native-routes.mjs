// Shared native MBN route traversal, extracted from extract-mbn-routes.mjs.
function toWorld(p) {
  return { x: 2 * p.x + 32, y: 2 * (320 - p.y) + 64 };
}

export function buildRoute(info, tag, maxLen = 1000) {
  const verts = info.vertices;
  const lines = info.linesB;
  let startV = null;
  let firstLine = -1;
  for (let i = 0; i < lines.length && startV === null; i++) {
    for (const v of [lines[i].vA, lines[i].vB]) {
      // Route markers proven in decomp 0x7042c: 101 (0x65), 130 (0x82), 132 (0x84).
      if (
        verts[v] &&
        (verts[v].prop === 101 || verts[v].prop === 130 || verts[v].prop === 132) &&
        Math.abs(verts[v].tag) === Math.abs(tag)
      ) {
        startV = v;
        firstLine = i;
        break;
      }
    }
  }
  if (startV === null) return null;
  const chain = [startV];
  let usedLine = firstLine;
  let cur = startV;
  const f = lines[firstLine];
  let next = f.vA === cur ? f.vB : f.vA;
  chain.push(next);
  cur = next;
  let modeFlag = false;
  let closeLoop = false;
  let regenerate = false;
  for (let guard = 0; guard < maxLen; guard++) {
    const cv = verts[cur];
    // Native generator 0x7042c sets the path mode from the chain's endpoint
    // property (disasm 0x708d0/0x70924/0x70930): 0x67 -> mode 2 loop
    // (appends point[0]), 0x66 -> mode 1 pingpong, 0x83 -> mode 3 regenerate
    // (appends point[last]); no marker -> mode 0 stop at the end.
    if (cv && cv.prop === 102) modeFlag = true;
    if (cv && cv.prop === 103) closeLoop = true;
    if (cv && cv.prop === 131) regenerate = true;
    let found = null;
    for (let i = 0; i < lines.length; i++) {
      if (i === usedLine) continue;
      if (lines[i].vA === cur) {
        found = { line: i, next: lines[i].vB };
        break;
      }
      if (lines[i].vB === cur) {
        found = { line: i, next: lines[i].vA };
        break;
      }
    }
    if (!found) break;
    usedLine = found.line;
    chain.push(found.next);
    cur = found.next;
  }
  // Convert to world pixels. Native keeps duplicate points; do not dedupe.
  const points = [];
  for (const idx of chain) {
    const v = verts[idx];
    if (!v) continue;
    const w = toWorld(v);
    points.push({ x: Math.round(w.x), y: Math.round(w.y), wait: v.wait | 0 });
  }
  // Mode heuristic: closed chain or mode flag -> loop, else pingpong.
  // The native +0x140 mode source is UNVERIFIED; mark it.
  if (closeLoop) {
    // Native 0x67 appends an unconditional copy of point[0] with wait 0.
    const start = verts[chain[0]];
    if (start) {
      const w = toWorld(start);
      points.push({ x: Math.round(w.x), y: Math.round(w.y), wait: 0 });
    }
  }
  if (regenerate && points.length) {
    // Native 0x83 appends a copy of the last point with wait 0.
    const last = points[points.length - 1];
    points.push({ x: last.x, y: last.y, wait: 0 });
  }
  // Native +0x140 mode mapping (proven at generator 0x708d0/0x70924/0x70930):
  // 0x67 -> loop (2), 0x66 -> pingpong (1), 0x83 -> regenerate (3),
  // no marker -> stop at the end (0).
  const mode = closeLoop ? "loop" : modeFlag ? "pingpong" : regenerate ? "regenerate" : "stop";
  const stationary = points.length > 0 && points.every((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y) < 1);
  return { tag, mode, modeEvidence: "mbn-0x66/0x67/0x83-rule", modeFlag, closeLoop, regenerate, stationary, points };
}

