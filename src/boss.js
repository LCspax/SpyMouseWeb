/**
 * boss.js - M1 proposal: Boss entity + native win pipeline for SpyMouseWeb.
 *
 * STATUS: proposal only. Nothing under src/ or tools/ is modified, and the
 * assets have not been re-imported. See notes.md for the integration steps.
 *
 * Native pipeline being mirrored (parallel-L1 / parallel-K2):
 *   win condition -> emit "boss_win" (0x254b0) -> map_events.xml maps
 *   boss_win -> 'win' cutscene -> script dispatcher 0xcb428 case 0x04265f6a
 *   sets session+0x25 (win)=1 and session+0x24 (ended)=1. For mode 2 the scene
 *   push at 0xe38d0 selects 'world_complete' instead of 'game_results'.
 *   Contact with a live boss (state != 0x19) -> 0x80b8c -> 0xb52e4 = player
 *   death = level fail (same outcome as a cat catch; there are no lives).
 *
 * Trigger policy (M1):
 *   "implemented" = the exact win-emission condition was located in
 *   libSpyMouse.so and checkWin() evaluates it against a raw host input.
 *   The gameplay driver that produces that raw input may still be unverified;
 *   it is listed in that level's `unverified` entry and is NEVER simulated
 *   here. With no host input the boss stays alive: no fake defeat, no timers,
 *   no invented hit thresholds, no invented exit.
 *   "unknown" = no win-emission condition was located. checkWin() is always
 *   false and update() can never end the level; only an explicit host call to
 *   bossDefeated() (the integration seam) can.
 *
 * Suggested integration (performed by the main agent, not by this lane):
 *   tools/import-entities.mjs : apply ./importer-snippet.js / ./importer.patch
 *   src/level.js             : import { Boss } from "./boss.js";
 *                              this.bosses = (def.bosses || []).map((b) => new Boss(b));
 *                              this.bossParts = def.bossParts || [];
 *   src/game.js step()       : for (const b of this.level.bosses) {
 *                                b.update(dt, {
 *                                  mouse: this.mouse, cell: u, game: this,
 *                                  caught: () => this.caught(),
 *                                });
 *                              }
 *                              Game.prototype.bossDefeated = function (b) {
 *                                return bossDefeated(this, b);
 *                              };
 *   src/game.js resetLevel() : this.bossWin = false;
 *                              this.bossWorldComplete = false;
 *   src/main.js showOverlay() "clear" branch:
 *                              if (game.bossWorldComplete) ovTitle.textContent = "WORLD COMPLETE";
 *
 * Coordinate conventions: BOSS_LEVELS[].boss.designX/designY and
 * parts[].designX/designY are the authored XML design coordinates. The map
 * importer converts them with world = 2*design + (32, 64); the runtime Boss
 * x/y are world pixels, like every other entity in the port.
 */

import { audio } from "./audio.js";

export const WIN_EVENT = "boss_win";
export const WIN_SCENE = "world_complete";

// Boss audio ids (analysis/rea/audio/sound-map.json, native 0x7EAD8/0x7EF24/
// 0x80B8C/0x12E7E4/0x12FCA8): 8 boss_robot_agro, 9 boss_robot_hit,
// 11 oil_fast, 12 fly, 14-16 lightning (6-Boss random), 96 death_cloud,
// 143 boss_robot_die, 162 boss_water_die, 0xA3-0xA8 boss rail/vacuum/dynamite
// loops. This class is host-driven (no per-prop AI yet), so only
// contact/hit-counter-change/death are wired; agro and the _loop sounds are
// left for a future per-prop controller (commented, not invented).
const BOSS_HIT_ID = 9;
const BOSS_DEATH_ID = 143;
const BOSS_WATER_DEATH_ID = 162;
const DEATH_CLOUD_ID = 96;

// Native boss collision extents were not measured. This is a proposed port
// default only; a level importer or level def may override Boss.radius.
export const DEFAULT_BOSS_RADIUS_CELLS = 2.4;

// ObjControllerBoss registry props 300-306 (0x12c..0x132) plus the 6-Boss
// prop 341 (authored boss body, not in that registry). parallel-K2.
export const BOSS_PROPS = new Set([300, 301, 302, 303, 304, 305, 306, 341]);

// Boss-controlled parts / presentation props. Kept in a separate bucket so
// they are never imported as cats, cheese, holes or decor. parallel-K2 step1.
export const BOSS_PART_PROPS = new Set([282, 283, 349, 350, 353, 357, 358, 366, 367]);

// Per-map win registry. One entry per shipped boss-mode map (plus the 8-Boss
// phase maps, which carry prop 304 even when level_data.xml says mode=normal).
export const BOSS_LEVELS = [
  {
    map: "791",
    uid: 103,
    num: "1-Boss",
    mode: "boss",
    prop: 301,
    boss: { id: 62, tag: 120, designX: 91, designY: 163 },
    parts: [
      { id: 77, prop: 357, tag: 0, designX: 15, designY: 314 },
      { id: 60, prop: 358, tag: 0, designX: 464, designY: 117 },
    ],
    trigger: {
      status: "implemented",
      driver: "unknown",
      kind: "levelPhase",
      phase: 9,
      description: "obj+0x1fc (levelPhase) == 9",
    },
    evidence: [
      "tick 0x833b0: prop 301 checks obj+0x1fc == 9",
      "0x83410 builds 'boss_win' (0x26efa0) and calls the emit helper 0x254b0",
      "map_events.xml: boss_win -> win -> sequence blowUpDroid",
      "0xcb428 case 0x04265f6a sets session+0x25=1 / session+0x24=1; mode 2 -> 'world_complete'",
    ],
    unverified: ["what drives obj+0x1fc to 9 (charge/slam phase progression)"],
    cutscene: { event: WIN_EVENT, name: "win", sequences: ["blowUpDroid"] },
  },
  {
    map: "795",
    uid: 2101,
    num: "2-Boss",
    mode: "boss",
    prop: 302,
    boss: { id: 30, tag: 20, designX: 238, designY: 99 },
    parts: [
      { id: 50, prop: 366, tag: 123, designX: 72, designY: 72 },
      { id: 51, prop: 366, tag: 124, designX: 402, designY: 274 },
      { id: 49, prop: 367, tag: 200, designX: 19, designY: 178 },
      { id: 52, prop: 367, tag: 201, designX: 460, designY: 177 },
      { id: 38, prop: 357, tag: 0, designX: 18, designY: 288 },
      { id: 24, prop: 358, tag: 0, designX: 459, designY: 122 },
    ],
    trigger: {
      status: "implemented",
      driver: "unknown",
      kind: "collisionBits",
      mask: 0x40,
      description: "collision query 0xd67cc(..., 0x73) result & 0x40",
    },
    evidence: [
      "update 0x824a8 runs 0xd67cc(..., 0x73); result & 0x40 -> state 0x19 + emit boss_win (0x82508-0x825d0)",
      "map_events.xml: boss_win -> win -> sequence blowUpDroid",
    ],
    unverified: ["what produces the 0x40 collision bit (cannon/projectile interaction)"],
    cutscene: { event: WIN_EVENT, name: "win", sequences: ["blowUpDroid"] },
  },
  {
    map: "733",
    uid: 35,
    num: "3-Boss",
    mode: "boss",
    prop: 300,
    boss: { id: 66, tag: 127, designX: 56, designY: 112 },
    parts: [
      { id: 68, prop: 357, tag: 0, designX: 17, designY: 255 },
      { id: 51, prop: 358, tag: 0, designX: 461, designY: 162 },
    ],
    trigger: {
      status: "implemented",
      driver: "unknown",
      kind: "fieldEquals",
      field: "hitCounter",
      value: 8,
      description: "boss+0xa8 (hitCounter) == 8",
    },
    evidence: [
      "update 0x7e3f8: boss+0xa8 == 8 -> found flag (+4) = 0 and emit boss_win (0x7e85c-0x7e864, helper 0x7e970-0x7e9d0)",
      "map_events.xml: boss_win -> win (blowUpDroid, launchHenchman, shockHenchman)",
    ],
    unverified: ["meaning and increment site of boss+0xa8 (assumed hit counter)"],
    cutscene: { event: WIN_EVENT, name: "win", sequences: ["blowUpDroid", "launchHenchman", "shockHenchman"] },
  },
  {
    map: "789",
    uid: 4101,
    num: "4-Boss",
    mode: "boss",
    prop: null,
    boss: null,
    parts: [
      { id: 71, prop: 282, tag: 1, designX: 129, designY: 162 },
      { id: 72, prop: 282, tag: 2, designX: 126, designY: 288 },
      { id: 73, prop: 282, tag: 3, designX: 347, designY: 287 },
      { id: 74, prop: 282, tag: 4, designX: 345, designY: 160 },
      { id: 75, prop: 282, tag: 5, designX: 236, designY: 161 },
      { id: 80, prop: 283, tag: 55, designX: 418, designY: 167 },
      { id: 64, prop: 357, tag: 0, designX: 7, designY: 101 },
      { id: 67, prop: 358, tag: 0, designX: 472, designY: 98 },
    ],
    trigger: {
      status: "unknown",
      driver: "unknown",
      kind: "none",
      description: "no 300-306 controller; 282/283 turret-target puzzle completion site not located",
    },
    evidence: [
      "map789.xml has 5x prop 282 (tags 1-5) + prop 283 (tag 55); no ObjControllerBoss prop 300-306",
      "map_events.xml: boss_win -> win -> turretSwitch + dunkHenchman2",
    ],
    unverified: [
      "282/283 controller behaviour and the site that emits boss_win",
      "contact/death semantics for 282/283 (they are not ObjControllerBoss)",
    ],
    cutscene: { event: WIN_EVENT, name: "win", sequences: ["turretSwitch", "dunkHenchman2"] },
  },
  {
    map: "782",
    uid: 5101,
    num: "5-Boss",
    mode: "boss",
    prop: 305,
    boss: { id: 32, tag: 0, designX: 695, designY: 200 },
    parts: [
      { id: 29, prop: 357, tag: 0, designX: 30, designY: 215 },
      { id: 39, prop: 358, tag: 1, designX: 602, designY: 94 },
    ],
    trigger: {
      status: "implemented",
      driver: "unknown",
      kind: "event",
      event: "custom_02",
      description: "authored event route custom_02 -> win",
    },
    evidence: [
      "map_events.xml: custom_01 -> boss_intro (fatCatEat); custom_02 -> win (fatCatSpitOut, handler 0x132114)",
      "update 0x82e18 only advances when obj+0x1fc == 2 (handler 0x130258)",
    ],
    unverified: [
      "what fires custom_01/custom_02 (tool2D trigger areas absent from the XML/brd)",
      "obj+0x1fc == 2 gate semantics",
    ],
    cutscene: { event: "custom_02", name: "win", sequences: ["fatCatSpitOut"] },
  },
  {
    map: "797",
    uid: 6102,
    num: "6-Boss",
    mode: "boss",
    prop: 341,
    boss: { id: 86, tag: 0, designX: 242, designY: 313 },
    parts: [
      { id: 88, prop: 357, tag: 0, designX: 13, designY: 299 },
      { id: 101, prop: 358, tag: 0, designX: 468, designY: 302 },
    ],
    trigger: {
      status: "unknown",
      driver: "unknown",
      kind: "none",
      description: "no defeat flow located for prop 341",
    },
    evidence: [
      "prop 341 is authored (Flags=10) but is NOT in the ObjControllerBoss registry 300-306",
      "map_events.xml maps only intro, restart and custom_01 -> reveal (revealGhostFluffy); there is no boss_win mapping",
    ],
    unverified: ["entire 6-Boss defeat flow", "whether prop 341 is a boss body at all"],
    cutscene: null,
  },
  {
    map: "817",
    uid: 802,
    num: "7-Boss",
    mode: "boss",
    prop: 306,
    boss: { id: 76, tag: 2, designX: 229, designY: 136 },
    parts: [
      { id: 73, prop: 357, tag: 0, designX: 26, designY: 294 },
      { id: 80, prop: 358, tag: 0, designX: 454, designY: 115 },
    ],
    trigger: {
      status: "implemented",
      driver: "unknown",
      kind: "collisionBitsAndSlots",
      mask: 0x20,
      slots: 16,
      description: "collision query 0xd67cc & 0x20 AND all 16 part slots empty",
    },
    evidence: [
      "update 0x828cc: collision 0xd67cc & 0x20 and all 16 slots at game+0x13518.. empty (0x82a4c-0x82a90)",
      "state 0x19 + emit boss_win (0x82a94-0x82ad8)",
      "map_events.xml: boss_win -> win -> sequence blowUpDroid",
    ],
    unverified: ["what the 16 slots are (droid parts/targets) and what fills/empties them"],
    cutscene: { event: WIN_EVENT, name: "win", sequences: ["blowUpDroid"] },
  },
  {
    map: "781",
    uid: 8214,
    num: "LEVEL_8_Boss2 (phase 1)",
    mode: "boss",
    prop: 304,
    boss: { id: 184, tag: 12, designX: 263, designY: 203 },
    parts: [
      { id: 189, prop: 353, tag: 501, designX: 339, designY: 262 },
      { id: 190, prop: 353, tag: 503, designX: 339, designY: 223 },
      { id: 191, prop: 353, tag: 505, designX: 339, designY: 184 },
      { id: 192, prop: 353, tag: 600, designX: 195, designY: 132 },
      { id: 193, prop: 353, tag: 602, designX: 195, designY: 171 },
      { id: 194, prop: 353, tag: 604, designX: 195, designY: 209 },
      { id: 195, prop: 353, tag: 650, designX: 195, designY: 248 },
    ],
    trigger: {
      status: "unknown",
      driver: "unknown",
      kind: "none",
      description: "prop-304 win condition not decoded for this phase map",
    },
    evidence: [
      "map_events.xml: intro -> boss_intro (dialogue, toggleFlames); no boss_win mapping",
      "prop-304 update 0x7daa8 not decoded",
      "authored home hole Property 243 exists (native can end via hole handler 0x90f2c)",
    ],
    unverified: [
      "prop-304 win condition",
      "whether 781 is won by boss defeat or by the authored home hole",
      "349/350/353 part semantics",
    ],
    cutscene: null,
  },
  {
    map: "780",
    uid: 8216,
    num: "LEVEL_8_Boss2 (phase 2)",
    mode: "normal",
    prop: 304,
    boss: { id: 208, tag: 100, designX: 28, designY: 171 },
    parts: [
      { id: 212, prop: 353, tag: 123, designX: 142, designY: 231 },
      { id: 213, prop: 353, tag: 124, designX: 141, designY: 191 },
      { id: 214, prop: 353, tag: 125, designX: 140, designY: 150 },
      { id: 215, prop: 353, tag: 126, designX: 138, designY: 107 },
      { id: 216, prop: 353, tag: 135, designX: 212, designY: 237 },
      { id: 217, prop: 353, tag: 134, designX: 210, designY: 197 },
      { id: 218, prop: 353, tag: 132, designX: 210, designY: 156 },
      { id: 219, prop: 353, tag: 130, designX: 209, designY: 111 },
      { id: 220, prop: 353, tag: 140, designX: 275, designY: 112 },
      { id: 221, prop: 353, tag: 141, designX: 276, designY: 154 },
      { id: 222, prop: 353, tag: 143, designX: 276, designY: 196 },
      { id: 223, prop: 353, tag: 145, designX: 276, designY: 237 },
      { id: 224, prop: 353, tag: 150, designX: 340, designY: 111 },
      { id: 225, prop: 353, tag: 151, designX: 342, designY: 155 },
      { id: 226, prop: 353, tag: 153, designX: 343, designY: 196 },
      { id: 227, prop: 353, tag: 155, designX: 347, designY: 238 },
      { id: 228, prop: 353, tag: 163, designX: 418, designY: 241 },
      { id: 229, prop: 353, tag: 161, designX: 418, designY: 199 },
      { id: 230, prop: 353, tag: 160, designX: 418, designY: 157 },
    ],
    trigger: {
      status: "unknown",
      driver: "unknown",
      kind: "none",
      description: "prop-304 win condition not decoded for this phase map",
    },
    evidence: [
      "level_data.xml uid 8216 map 780 is authored mode=normal (phase-2 map, not mode=boss)",
      "map_events.xml: intro/restart boss7_phase2_start, outro escape (boss7_phase2_end); no boss_win mapping",
      "authored home hole Property 243 exists",
    ],
    unverified: [
      "prop-304 win condition",
      "home-hole/outro vs boss-defeat completion",
      "349/350/353 part semantics",
    ],
    cutscene: null,
  },
  {
    map: "779",
    uid: 8215,
    num: "LEVEL_8_Boss2 (phase 3)",
    mode: "boss",
    prop: 304,
    boss: { id: 100, tag: 2000, designX: 240, designY: 209 },
    parts: [
      { id: 53, prop: 349, tag: 1506, designX: 347, designY: 59 },
      { id: 54, prop: 349, tag: 1505, designX: 396, designY: 170 },
      { id: 55, prop: 349, tag: 1504, designX: 322, designY: 291 },
      { id: 56, prop: 349, tag: 1503, designX: 141, designY: 281 },
      { id: 57, prop: 349, tag: 1502, designX: 88, designY: 167 },
      { id: 58, prop: 349, tag: 1501, designX: 128, designY: 61 },
      { id: 99, prop: 350, tag: 2000, designX: 237, designY: 245 },
    ],
    trigger: {
      status: "unknown",
      driver: "unknown",
      kind: "none",
      description: "prop-304 win condition not decoded for this phase map",
    },
    evidence: [
      "map_events.xml: boss_win -> boss_defeat (boss7_phase3_prefall, empororDeathScene 0x12e470, launchFluffy 0x12dbfc, boss7_phase3_dead)",
      "prop-304 update 0x7daa8 not decoded",
      "authored home hole Property 240 exists",
    ],
    unverified: [
      "prop-304 win condition",
      "whether 779 ends by boss defeat or by the authored home hole",
      "349/350/353 part semantics",
    ],
    cutscene: { event: WIN_EVENT, name: "boss_defeat", sequences: ["empororDeathScene", "launchFluffy"] },
  },
];

export function bossLevelByMap(map) {
  const key = String(map ?? "");
  return BOSS_LEVELS.find((level) => level.map === key) || null;
}

export function triggerFor(map) {
  const level = bossLevelByMap(map);
  return level ? level.trigger : null;
}

export function isBossProp(prop) {
  return BOSS_PROPS.has(Number(prop));
}

export function isBossPartProp(prop) {
  return BOSS_PART_PROPS.has(Number(prop));
}

/**
 * One live boss body. All state in this class is either imported from the map
 * XML or fed by the host (future boss controllers / collision layer). The class
 * never advances levelPhase, hitCounter, collisionBits or slots by itself.
 */
export class Boss {
  constructor(def = {}) {
    if (!def || typeof def !== "object") throw new TypeError("Boss(def) needs an object");
    this.id = def.id ?? null;
    this.map = def.map != null ? String(def.map) : null;
    this.prop = def.prop;
    this.tag = def.tag ?? 0;
    this.x = def.x;
    this.y = def.y;
    this.radius =
      Number.isFinite(def.radius) && def.radius > 0
        ? def.radius
        : DEFAULT_BOSS_RADIUS_CELLS * (Number.isFinite(def.cell) ? def.cell : 16);
    this.parts = Array.isArray(def.parts) ? def.parts : [];
    // Native obj+0x1fc counterparts. levelPhase is host/debug driven; nothing
    // here increments it.
    this.levelPhase = def.levelPhase ?? 0;
    // Native boss+0xa8 counterpart (3-Boss; semantics unverified).
    this.hitCounter = def.hitCounter ?? 0;
    this._prevHitCounter = this.hitCounter;
    // Native 0xd67cc collision-query result bits (2-Boss / 7-Boss).
    this.collisionBits = def.collisionBits ?? 0;
    // Native 16 slots at game+0x13518 (7-Boss). Defaults to the authored count
    // for the one trigger that uses it.
    this.trigger = triggerFor(this.map);
    this.slotsRemaining =
      def.slotsRemaining ??
      (this.trigger && this.trigger.kind === "collisionBitsAndSlots" ? this.trigger.slots : null);
    this.receivedEvents = new Set();
    this.dead = false;
    this.defeated = false;
    this.defeat = null;
  }

  get triggerStatus() {
    return this.trigger ? this.trigger.status : "unknown";
  }

  /** Authored event feed (map_events.xml custom_XX etc.). */
  notifyEvent(name) {
    if (this.dead) return false;
    this.receivedEvents.add(String(name));
    return this.checkWin();
  }

  /**
   * Exact win-emission condition from the native controller, or false when the
   * level's trigger is unverified. Evaluates raw host inputs only.
   */
  checkWin() {
    if (this.dead) return false;
    const t = this.trigger;
    if (!t || t.status !== "implemented") return false;
    switch (t.kind) {
      case "levelPhase":
        return this.levelPhase === t.phase;
      case "collisionBits":
        return (this.collisionBits & t.mask) === t.mask;
      case "fieldEquals":
        return this[t.field] === t.value;
      case "collisionBitsAndSlots":
        return (this.collisionBits & t.mask) === t.mask && this.slotsRemaining === 0;
      case "event":
        return this.receivedEvents.has(t.event);
      default:
        return false;
    }
  }

  /** Same contact rule as cats: a hidden mouse cannot be caught. */
  contact(mouse) {
    if (this.dead || !mouse || mouse.hidden) return false;
    const dx = mouse.x - this.x;
    const dy = mouse.y - this.y;
    const r = this.radius + (Number.isFinite(mouse.radius) ? mouse.radius : 0);
    return dx * dx + dy * dy < r * r;
  }

  /**
   * Per-frame hook. Win emission is checked first (native sets state 0x19
   * before the interaction callback); contact against a still-live boss kills.
   * Returns true only when this call ended the level via bossDefeated().
   */
  update(dt, env = {}) {
    void dt;
    if (this.dead) return false;
    if (this.hitCounter !== this._prevHitCounter) {
      this._prevHitCounter = this.hitCounter;
      audio.playSound(BOSS_HIT_ID); // boss_robot_hit - native 0x7F958
    }
    if (this.checkWin()) return bossDefeated(env.game ?? null, this);
    if (this.contact(env.mouse) && typeof env.caught === "function") {
      // Native 0x80B8C: touching a live boss plays death_cloud (0x60) and kills.
      audio.playSound(DEATH_CLOUD_ID);
      env.caught(this);
      return false;
    }
    return false;
  }
}

/**
 * The native win path. Marks the boss dead and ends the level through the
 * port's clear/settlement path, setting the mode-2 world_complete flags the
 * main overlay consumes. This is the integration seam for unverified bosses
 * (call it explicitly from the future controller/puzzle code).
 */
export function bossDefeated(game, boss, opts = {}) {
  if (!boss || boss.dead) return false;
  if (game && game.state && game.state !== "playing") return false;

  boss.dead = true;
  boss.defeated = true;
  // Native boss death: 304 (water boss) uses boss_water_die (0x162) at
  // 0x12FCA8; the robot/droid bosses use boss_robot_die (0x8F) at 0x12E7E4.
  audio.playSound(boss.prop === 304 ? BOSS_WATER_DEATH_ID : BOSS_DEATH_ID);
  const t = boss.trigger;
  const worldComplete = !!(game && game.level && game.level.mode === "boss");
  const cutscene = t && t.cutscene ? t.cutscene : null;
  boss.defeat = {
    prop: boss.prop,
    map: boss.map,
    trigger: t ? t.kind : "none",
    triggerStatus: t ? t.status : "unknown",
    event: cutscene ? cutscene.event : t && t.event ? t.event : WIN_EVENT,
    cutscene: cutscene ? cutscene.name : null,
    sequences: cutscene ? cutscene.sequences || [] : [],
    worldComplete,
    explicit: opts.explicit === true,
  };

  if (!game) return true;
  game.bossWin = true; // session+0x25 analogue
  game.bossWorldComplete = worldComplete; // mode 2 scene : 'world_complete'
  game.lastBossDefeat = boss.defeat;
  if (typeof game.onBossDefeated === "function") game.onBossDefeated(boss);

  if (typeof game.levelClear === "function") {
    game.levelClear();
  } else {
    game.state = "levelclear";
    if (typeof game.onLevelEnd === "function") {
      game.onLevelEnd({
        type: "clear",
        boss: true,
        worldComplete,
        level: game.levelIndex,
      });
    }
  }
  return true;
}

