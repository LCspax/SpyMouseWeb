/**
 * boss-links.js - authored Boss level chain for the web port.
 *
 * Evidence (res/level_data.xml):
 *   Every chapter authors TWO levels with the same `num`:
 *     <level uid="102" map="736" num="1-Boss" ...>   mode="infinite" autostart="103"
 *     <level uid="103" map="791" num="1-Boss" ...>   mode="boss"     autostart="-1"
 *   `autostart` is the native "when this level ends, start that uid" link, so the
 *   wide entrance arena (map736, ~4008 px) hands over to the boss-mode fight map
 *   (map791). The world-map node points at the entrance map (assets/menu/worlds.json),
 *   which is why selecting "1-Boss" on the map must enter through map736.
 *
 * Win conditions come from analysis/parallel/L1/findings.json + src/boss.js
 * (native ObjControllerBoss registry props 300-306, 341). Where the native
 * driver is still undecoded, `hits` is a WEB-COMPATIBLE parameter chosen so the
 * arena can be finished; it is never presented as a decoded native value.
 *
 * `hits` semantics in the port: number of times the boss has to crash into the
 * level geometry (lure it while hidden / behind a wall). Native counters that
 * the value mirrors:
 *   1-Boss obj+0x1fc (levelPhase) == 9         -> 9
 *   2-Boss collision query & 0x40              -> 6 (web-compatible)
 *   3-Boss boss+0xa8 (hitCounter) == 8         -> 8
 *   4-Boss turret puzzle (282 tags 1-5)        -> 5
 *   5-Boss custom_02 event                     -> 6 (web-compatible)
 *   6-Boss no defeat flow located              -> 8 (web-compatible)
 *   7-Boss 16 droid slots empty                -> 16
 *   8-Boss prop-304 phase maps                 -> 6 (web-compatible)
 */

export const BOSS_LINKS = [
  {
    key: 'map791',
    world: 1,
    num: '1-Boss',
    entrance: 'map736',
    arena: 'map791',
    arenaUid: 103,
    bossProps: [301],
    hits: 9,
    hitsEvidence: 'levelPhase == 9 (0x833b0)',
    cutscene: ['showFluffy', 'slamEntrance', 'dialogue', 'hideFluffy', 'closeExit'],
  },
  {
    key: 'map795',
    world: 2,
    num: '2-Boss',
    entrance: 'map555',
    arena: 'map795',
    arenaUid: 2101,
    bossProps: [302],
    hits: 6,
    hitsEvidence: 'collisionBits & 0x40 (0x824a8) - hit count is web-compatible',
    cutscene: ['boss_intro'],
  },
  {
    key: 'map733',
    world: 3,
    num: '3-Boss',
    entrance: 'map565',
    arena: 'map733',
    arenaUid: 35,
    bossProps: [300],
    hits: 8,
    hitsEvidence: 'boss+0xa8 (hitCounter) == 8 (0x7e3f8)',
    cutscene: ['boss_intro'],
  },
  {
    key: 'map789',
    world: 4,
    num: '4-Boss',
    entrance: 'map556',
    arena: 'map789',
    arenaUid: 4101,
    bossProps: [283],
    synthetic: true,
    hits: 5,
    hitsEvidence: '5 turret targets (prop 282 tags 1-5); win emission site unverified',
    cutscene: ['boss_intro', 'turretSwitch'],
  },
  {
    key: 'map782',
    world: 5,
    num: '5-Boss',
    entrance: 'map568',
    arena: 'map782',
    arenaUid: 5101,
    bossProps: [305],
    hits: 6,
    hitsEvidence: 'custom_02 -> win; trigger areas absent from the data (web-compatible hits)',
    cutscene: ['fatCatEat'],
  },
  {
    key: 'map797',
    world: 6,
    num: '6-Boss',
    entrance: 'map531',
    arena: 'map797',
    arenaUid: 6102,
    bossProps: [341],
    hits: 8,
    hitsEvidence: 'no native defeat flow located (web-compatible hits)',
    cutscene: ['boss_intro'],
  },
  {
    key: 'map817',
    world: 7,
    num: '7-Boss',
    entrance: 'map816',
    arena: 'map817',
    arenaUid: 802,
    bossProps: [306],
    hits: 16,
    hitsEvidence: '16 droid slots empty + collision & 0x20 (0x828cc)',
    cutscene: ['boss_intro'],
  },
  {
    key: 'map781',
    world: 8,
    num: '8-Boss',
    entrance: 'map575',
    arena: 'map781',
    arenaUid: 8214,
    bossProps: [304],
    hits: 6,
    hitsEvidence: 'prop-304 update 0x7daa8 not decoded (web-compatible hits)',
    cutscene: ['boss_intro', 'toggleFlames'],
  },
];

// Native `autostart` chain between boss-phase maps (level_data.xml). Only the
// 8-Boss fight is authored as several maps; every other boss arena has
// autostart="-1" and ends after one map.
export const BOSS_CHAIN_NEXT = {
  map781: 'map769',
  map769: 'map768',
  map768: 'map783',
  map783: 'map764',
  map764: 'map770',
  map770: 'map780',
  map780: 'map771',
  map771: 'map767',
  map767: 'map779',
};

const ENTRANCE_TO_LINK = new Map(BOSS_LINKS.map((link) => [link.entrance, link]));
const ARENA_TO_LINK = new Map(BOSS_LINKS.map((link) => [link.arena, link]));

/** Link for a boss ENTRANCE map (mode="infinite" approach arena). */
export function entranceLink(mapId) {
  return ENTRANCE_TO_LINK.get(String(mapId || '')) || null;
}

/** Link for a boss ARENA map (mode="boss" fight map). */
export function arenaLink(mapId) {
  return ARENA_TO_LINK.get(String(mapId || '')) || null;
}

/** True when the level definition is a boss entrance (scroll approach). */
export function isBossEntrance(def) {
  return !!def && !!entranceLink(def.id);
}

/** True when the level definition is a boss arena fight map. */
export function isBossArena(def) {
  return !!def && !!arenaLink(def.id);
}

/**
 * Next map in the authored boss chain, or null. A phase map is only chained
 * while a boss run for that chapter is active (`link`), so replaying a world-8
 * phase level from the map screen keeps the normal results screen.
 */
export function chainNext(mapId, link = null) {
  if (!link) return null;
  return BOSS_CHAIN_NEXT[String(mapId || '')] || null;
}

/** Stable save key for a boss chapter (its arena map id). */
export function bossKey(link) {
  return link ? link.arena : '';
}

/**
 * Stage fractions for the entrance scroll run. The authored entrance maps are
 * 4-6 screen widths long; three checkpoints keep the advance readable and give
 * the resume feature a defined anchor. WEB-COMPATIBLE parameter.
 */
export const APPROACH_STAGES = [
  { at: 0.0, label: { zh: '潜入中', en: 'INFILTRATION' } },
  { at: 0.34, label: { zh: '第 2 区段', en: 'SECTOR 2' } },
  { at: 0.66, label: { zh: '第 3 区段', en: 'SECTOR 3' } },
  { at: 0.82, label: { zh: 'Boss 出现！', en: 'BOSS INCOMING' } },
];

/** Boss display names (native dialogue ids exist; art/name table unverified). */
export const BOSS_NAMES = {
  '1-Boss': { zh: '机器鼠 · 弗拉菲', en: 'Fluffy the Droid' },
  '2-Boss': { zh: '双炮机甲', en: 'Twin Cannon Mech' },
  '3-Boss': { zh: '钢铁猎手', en: 'Steel Hunter' },
  '4-Boss': { zh: '炮塔核心', en: 'Turret Core' },
  '5-Boss': { zh: '肥猫', en: 'Fat Cat' },
  '6-Boss': { zh: '幽灵弗拉菲', en: 'Ghost Fluffy' },
  '7-Boss': { zh: '机甲军团', en: 'Droid Legion' },
  '8-Boss': { zh: '皇帝', en: 'The Emperor' },
};
