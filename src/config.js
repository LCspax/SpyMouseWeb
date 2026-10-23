// All gameplay values are expressed in "cells per second" and multiplied by
// World.cell at runtime, so the same tuning works for tile maps (cell=1) and
// pixel-sized mask maps (cell=16).
export const CFG = {
  mouse: {
    radiusCells: 0.35,
    // Movement clearance stays small; contact follows the visible body.
    contactRadiusCells: 0.9,
    speedCells: 9,
  },

  cat: {
    radiusCells: 0.4,
    contactRadiusCells: 1.0,
    patrolCells: 3.75,
    chaseCells: 8.625,
    fov: (145 * Math.PI) / 180,
    // Native defaults recovered by parallel-K1 from the ctor defaults pass
    // (0x140674, stub getters): cat_sight_dist 400.0 world px, cat_pounce_dist
    // 50.0 world px, cat_turn_speed 1.0, cat_patrol_speed 0.5. The slew gain is
    // K = stateReturn * cat_turn_speed with stateReturn = patrol_speed * AI
    // (default 1.0) -> K = 0.5, i.e. K/pi = 0.159 per frame. Applied at a 60 Hz
    // cadence (native frame rate unverified).
    rangeCells: 25,
    turnGain: 0.5,
    alertGrace: 0.6,
    alertLoseTime: 0.5,
    angryWait: 2,
    pounceDistCells: 3.125,
    pounceMultiplier: 1.5,
    pounceWait: 0.7,
    pounceRun: 0.55,
    pounceStun: 2.5,
    pounceCooldown: 2.0,
    waypointEpsCells: 0.15,
    typeChaseSpeed: [0.8, 1.6, 1.0, 1.0, 1.0, 0.7, 1.45, 1.25, 1.0, 1.0, 0.8, 1.0],
    typePatrolSpeed: [0.8, 1.6, 1.0, 1.0, 1.0, 0.35, 1.45, 1.25, 1.0, 1.0, 0.8, 1.0],
  },

  draw: {
    minStepCells: 0.5,
    maxLengthCells: 140,
  },

  game: {
    lives: 3,
    caughtFightSeconds: 1.2,
    caughtCloseSeconds: 0.6,
    caughtBlackSeconds: 0.15,
    caughtRetractSeconds: 0.45,
    fightFrameSeconds: 0.08,
    // Win transition reworked to the user-visible original flow: the hero
    // shrinks into the exit door, then the results scrolling background masks
    // the screen and the results panel pops. The level itself must NOT zoom.
    clearEnterSeconds: 0.5,
    emergeGrowSeconds: 0.28,
    clearAnnouncementSeconds: 1.1,
    scoreCountdownSeconds: 0.2,
  },
};
