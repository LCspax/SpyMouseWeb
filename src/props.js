// Sprite suffixes describe the wall/rim, not the direction of travel.
// Keep rendering and interaction in the same coordinate convention (+y down).
const HOLE_DIR = ["u", "l", "d", "r"];
const PIPE_DIR = ["d", "r", "u", "l"];
// Native 0x6808c reads RGB triples at 0x272248 using Tag % 8.
export const HOLE_COLOURS=['#ffd800','#d61212','#fd8300','#cf28e8','#45d020','#6d7173','#ffffff','#1962f6'];
export function holeColour(tag=0){return HOLE_COLOURS[Math.abs(tag)%8];}
// The 48px native cheese cell keeps the same scale before and after pickup.
export const CHEESE_SIZE_CELLS = 3;
export function propDirection(prop) {
  if (prop >= 20 && prop <= 23) return HOLE_DIR[prop - 20];
  if (prop >= 240 && prop <= 247) return HOLE_DIR[(prop - 240) % 4];
  if (prop >= 200 && prop <= 207) return PIPE_DIR[(prop - 200) % 4];
  return null;
}

export function mouthPosition(p, offset) {
  const dir = propDirection(p.prop) || p.dir;
  // Native 0x8f4b0 flipflap placement (and the hole convention): the sprite
  // suffix names the WALL/RIM side, so the mouth opens on the opposite side.
  // Engine space is y-up: 204(d) += 2r -> world up; 206(u) -= 2r -> world down;
  // 205(r) x-=2r -> left; 207(l) x+=2r -> right. Same table for holes 20-23
  // and pipe pieces 200-207 (PROVEN for 204-207, consistent for 200-203).
  const vectors = { u: [0, 1], d: [0, -1], l: [1, 0], r: [-1, 0] };
  const [dx, dy] = vectors[dir] || [0, 0];
  return { x: p.x + dx * offset, y: p.y + dy * offset };
}

export function cheeseSheet(prop) {
  return prop >= 6 && prop <= 10 ? `cheese0${11 - prop}` : "cheese01";
}

export function carriedCheeseFrame(angle = 0) {
  // Native 0xb1b4c..0xb1b84: truncate(Y-up angle / (360/16) - 1),
  // then wrap into the directional strip. This is not a looping animation.
  const frame = Math.trunc(-angle / (Math.PI * 2 / 16) - 1);
  return ((frame % 16) + 16) % 16;
}

export function playerSpawnPoint(start, world, radius) {
  // Native factory 0xb3370..0xb338c adds half the 74px sprite height
  // in Y-up coordinates. Convert that pivot before testing floor clearance.
  const x = start.ox ?? start.x;
  const y = start.oy == null ? start.y : start.oy - 37;
  return world.circleHitsWall(x, y, radius) ? world.closestOpen(x, y, radius) : { x, y };
}

// Authored positions are exact sprite/interaction positions. A navigation
// grid centre is only a fallback for a point actually inside a wall.
export function pickupPosition(p, world) {
  const x = p.ox ?? p.x;
  const y = p.oy ?? p.y;
  return world.isWallAt(x, y) ? { x: p.x, y: p.y } : { x, y };
}

export function exitInteractionPoint(exit, world) {
  // Keep ASCII/synthesized exits at their authored floor point.
  if (exit.ox == null || exit.oy == null) return { x: exit.x, y: exit.y };
  const centre = { ...exit, x: exit.ox, y: exit.oy - world.cell };
  if (!world.gridCircleHitsWall(centre.x, centre.y, world.cell * 0.35)) return { x: centre.x, y: centre.y };
  const mouth = mouthPosition(centre, world.cell * 0.75);
  if (!world.gridCircleHitsWall(mouth.x, mouth.y, world.cell * 0.35)) return mouth;
  return world.closestOpen(mouth.x, mouth.y);
}
