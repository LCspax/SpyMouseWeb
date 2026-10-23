// Native hazard layers (mechanisms lane; see IMPLEMENTATION-CONTRACT §1.2).
//
// The shipped native maps have no lava/water props: hazard damage is a layer
// over the art/tile data (parallel-J2). The web build imports the per-level
// `hazardMask.cells` (lava tiles) into `level.hazardCells`; water tiles are
// optional (`level.waterCells`) and are only present when a level definition
// actually carries them, because the current data pack cannot prove which
// painted tiles are water.
//
// Semantics (native evidence in analysis/rea/mechanisms/findings.md):
//  - playerwater_speed_mult = 0.9 while the mouse is in a water cell;
//  - lava/fire contact starts the 400 ms burn timer and kills the mouse
//    (player_flamedeath + burn.sps / death_fire.sps). The exact static trigger
//    was not located (J2), so this layer is HYPOTHESIS only in its *source*
//    (painted cells), not in the death effect;
//  - zapper/electric contact is an optional colour layer (map789 boss parts
//    282/283 are not proven hazards; implement only when a level provides
//    `electricCells`, do not invent them in the importer).
//
// Called by Game before Mechanisms.prepare each fixed step (Lead owns game.js).

const WATER_SPEED_MULT = 0.9;

function cellOf(level, x, y) {
  const w = level?.world;
  if (!w) return null;
  const tx = Math.floor(x / w.cell), ty = Math.floor(y / w.cell);
  if (tx < 0 || ty < 0 || tx >= w.cols || ty >= w.rows) return null;
  return ty * w.cols + tx;
}

// Optional helper for UI/tests: which layer is at a world point?
export function hazardAt(level, x, y) {
  const i = cellOf(level, x, y);
  if (i == null) return null;
  if (level.waterCells?.has(i)) return 'water';
  if (level.hazardCells?.has(i)) return 'lava';
  if (level.electricCells?.has(i)) return 'electric';
  return null;
}

export function updateHazards(game, dt) {
  if (!game || !game.level || !game.mouse) return;
  const m = game.mouse;
  const level = game.level;
  // Reset every step; other systems may add multipliers later.
  game.envSpeedMult = 1;
  game.inWater = false;

  const i = cellOf(level, m.x, m.y);
  if (i == null) return;

  if (level.waterCells?.has(i)) {
    game.envSpeedMult = WATER_SPEED_MULT;
    game.inWater = true;
  }

  if (m.hidden || m.airborne) return;

  if (level.hazardCells?.has(i)) {
    // Native: player+0x580 accumulates against player_burning_time (400 ms);
    // the port keeps the same observable outcome (death) with a single call.
    game.stats.touched_lava = (game.stats.touched_lava || 0) + 1;
    if (game.state === 'playing' && typeof game.caught === 'function') game.caught(null, 'lava');
    return;
  }

  if (level.electricCells?.has(i)) {
    game.stats.touched_electric = (game.stats.touched_electric || 0) + 1;
    if (game.state === 'playing' && typeof game.caught === 'function') game.caught(null, 'electric');
  }
}
