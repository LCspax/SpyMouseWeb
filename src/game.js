import { CFG } from "./config.js";
import { Level } from "./level.js";
import { Mouse } from "./entities.js";
import { clamp, dist } from "./math.js";
import { Sprites, catPrefixFor } from "./sprites.js";
import { resetCwmice, updateCwmice, drawCwmice } from "./cwmouse.js";
import { CHEESE_SIZE_CELLS, cheeseSheet, carriedCheeseFrame, mouthPosition, propDirection, playerSpawnPoint, holeColour } from "./props.js";
import { updateCarried, resetCarried } from './carried.js';
import {pipeDestination} from './pipe-portals.js';
import {entranceScale} from './entrance-feedback.js';
import {bossDefeated} from './boss.js';
import {createBossFlow, normaliseBossRun, newBossRun} from './boss-flow.js';
import {arenaLink, entranceLink} from './boss-links.js';
import {BonusPortal, bonusTargetFor, EXIT_BONUS_MULTIPLIER} from './bonus.js';
import {audio} from './audio.js';
import {updateHazards} from './hazards.js';
import {SECRET_CRACKS} from './secrets.js';

const COLORS = {
  floor: "#2a3540",
  floorAlt: "#26303a",
  wall: "#111820",
  wallTop: "#3a4a5a",
  path: "#f5fbff",
  cheese: "#ffcf3f",
  mouse: "#cdd6df",
  cat: "#f28b30",
  cone: "rgba(242,139,48,0.16)",
  coneAlert: "rgba(255,80,80,0.24)",
};

const CAT_ROUTE_COLORS = [
  "#c98a4b",
  "#ff8a3d",
  "#9aa4b2",
  "#ff4d4d",
  "#a7b0b8",
  "#7ce7ff",
  "#b98cff",
  "#ff5a36",
  "#ff5ab0",
  "#e05cff",
  "#7bdc6a",
  "#ffd166",
];

export class Game {
  constructor(canvas, options = {}) {
    this.options = options;
    this.introCount = 0;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.cssW = 0;
    this.cssH = 0;
    this.level = null;
    this.levelIndex = 0;
    this.mouse = null;
    this.lives = CFG.game.lives;
    this.emergeGrow = null;
    this.state = "menu";
    this.cam = { scale: 1, ox: 0, oy: 0 };
    this.stroke = null;
    this.time = 0;
    this.timeLeft = null;
    this.lastHudTime = null;
    this.cheeseLeft = 0;
    this.pipesUsed = 0;
    this.transportsUsed = 0;
    this.pipeCooldown = 0;
    this.floats = [];
    this.projectiles = [];
    this.bgImg = null;
    this.sprites = new Sprites();
    this.sprites.load();
    this.onHud = null;
    this.onLevelEnd = null;
    // Native dossier ids 0..16 (0x2af2dc table). Permanent across level
    // resets; main.js seeds this from localStorage before the first loadLevel.
    this.dossiers = new Set();
    this.onDossier = null;
    // Wall-crack / hidden-level state (see src/secrets.js).
    this.levelCatalog = [];
    this.secretsFound = new Set();
    this.cracks = [];
    this.crackEnter = null;
    this.bonusReturn = null;
    this.bonusLevelId = null;
    // Reward-room entrance (src/bonus.js) + its one-shot payout.
    this.bonusPortal = null;
    this.bonusMultiplier = 1;
    this.bonusClaimed = false;
    this.bonusClaims = {};
    this.onBonusReward = null;
    // Wall-crack entrances that were pushed through and cleared, keyed by the
    // authored crack id. main.js persists it as `progress.cracks`.
    this.crackClaims = {};
    this.onCrackUsed = null;
    // Boss run (src/boss-flow.js): `bossRun` mirrors the persisted save, the
    // flow owns the entrance/arena presentation for the loaded level.
    this.bossFlow = null;
    this.bossRun = null;
    this.bossResume = null;
    this.bossTransition = null;
    this.inputLocked = false;
    this.language = 'zh';
    this.onBossRun = null;
    this.onSecretFound = null;
    this.envSpeedMult = 1;
    // Audio is optional: init() resolves to a no-op when there is no browser
    // audio context or the manifest has not been generated yet.
    audio.init().catch(() => {});
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.updateCamera();
  }

  updateCamera() {
    if (!this.level) return;
    const w = this.level.world.w;
    const h = this.level.world.h;
    const pad = 8;
    // Original render: 480x320 design -> a 960x640 world-px viewport. Wide
    // maps follow the mouse at that zoom instead of fitting the whole map.
    const viewW = 960;
    const viewH = 640;
    const fit = Math.min((this.cssW - pad * 2) / w, (this.cssH - pad * 2) / h);
    const zoom = Math.min(this.cssW / viewW, this.cssH / viewH);
    // Boss entrance maps are 4-6 screen widths wide. Fitting them would show
    // the whole run at once, which is exactly what a scroll advance must not
    // do: those levels pan horizontally with the advance
    // (src/boss-flow.js BossApproach.cameraFocus). Vertically they DO fit the
    // whole map: the run is horizontal and every floor lane has to stay visible,
    // so the camera never pans up/down with the hero.
    const scroll = this.bossFlow?.cameraMode === 'scroll';
    const fitHeight = (this.cssH - pad * 2) / Math.max(1, h);
    const scale = scroll ? Math.max(1e-4, Math.min(zoom, fitHeight)) : Math.min(zoom, fit);
    this.cam.scale = scale;
    const m = this.mouse || { x: w / 2, y: h / 2 };
    const focus = (scroll && this.bossFlow?.cameraFocus?.(this, scale)) || { x: m.x, y: m.y };
    let ox = this.cssW / 2 - focus.x * scale;
    let oy = this.cssH / 2 - focus.y * scale;
    if (w * scale <= this.cssW - pad * 2) ox = (this.cssW - w * scale) / 2;
    else ox = Math.max(this.cssW - pad - w * scale, Math.min(pad, ox));
    if (h * scale <= this.cssH - pad * 2) oy = (this.cssH - h * scale) / 2;
    else oy = Math.max(this.cssH - pad - h * scale, Math.min(pad, oy));
    this.cam.ox = ox;
    this.cam.oy = oy;
  }

  loadLevel(def, index) {
    this.levelIndex = index;
    this.level = new Level(def);
    this.crackEnter = null;
    this.bonusPortal = null; // re-created by setupBonusPortal() after resetLevel
    this.floorLevels=new Map([[0,this.level]]);
    for(const floor of def.extraFloors||[])this.floorLevels.set(floor.floor,new Level({...floor,num:def.num,name:def.name,times:def.times,goals:def.goals,mode:def.mode}));
    this.updateCamera();    this.bgImg = null;
    if (def.bg) {
      const img = new Image();
      img.onload = () => {
        this.bgImg = img;
      };
      img.src = def.bg;
    }
    this.resetLevel(true);
    this.state = "playing";
    this.bonusLevelId = def.secret ? def.id : null;
    // Wall cracks are painted into the parent background; resolve their
    // trigger/return point to the nearest open floor at load time.
    const cracks = SECRET_CRACKS[def.id] || def.cracks || [];
    this.cracks = cracks.map((crack) => {
      const reach = this.level.world.cell * 0.4;
      const loose = this.level.world.closestOpen(crack.trigger.x, crack.trigger.y, reach);
      const back = this.level.world.closestOpen(crack.returnTo.x, crack.returnTo.y, reach);
      return {
        ...crack,
        trigger: loose,
        returnTo: back,
        // Spent only when THIS entrance was pushed through and the room was
        // cleared (crackClaims, persisted by main.js). Keying it on the target's
        // "discovered" flag would close every other door into the same hidden
        // level as soon as one of them was used.
        used: !!(this.crackClaims && this.crackClaims[crack.id]),
      };
    });
    // Boss run: an entrance map starts the scroll run, an arena map starts (or
    // resumes) the fight. `bossResume` is consumed once so a stale save can
    // never hijack a normal level load, while a run that is already live is
    // carried across the entrance -> arena hand-over (attempts, sector).
    const resume = this.bossResume && (this.bossResume.entrance === def.id || this.bossResume.arena === def.id)
      ? this.bossResume
      : null;
    const carry = this.bossRun && (this.bossRun.arena === def.id || this.bossRun.entrance === def.id)
      ? this.bossRun
      : null;
    this.bossFlow = createBossFlow(this, def, resume || carry);
    this.bossResume = null;
    if (this.bossFlow) {
      this.bossRun = resume || carry || newBossRun(this.bossFlow.link, {
        stage: def.mode === 'boss' ? 'arena' : 'approach',
      });
      this.bossFlow.attach?.(this);
      // The arena has its own slam/roar intro; the level iris would hide it.
      if (this.bossFlow.kind === 'arena') this.intro = null;
      this.updateCamera();
      // Persist the moment the run becomes live, so quitting during the intro
      // is resumable like any fight checkpoint.
      if (!resume) this.saveBossRun({ stage: def.mode === 'boss' ? 'intro' : 'approach' });
    }
    // In-level reward-room entrance (see src/bonus.js for the evidence limits).
    this.setupBonusPortal(def);
    // Per-level music from level_data.xml <music play="…sps"/> (imported as
    // def.music). Safe when the field or the audio manifest is missing.
    this.currentMusic = def.music || null;
    if (def.music) audio.playMusic(def.music, { loop: true });
  }

  setupBonusPortal(def) {
    this.bonusPortal = null;
    this.bonusMultiplier = 1;
    this.bonusClaimed = false;
    const target = bonusTargetFor(def, this.levelCatalog || []);
    if (!target) return;
    const claimed = !!(this.bonusClaims && this.bonusClaims[def.id]);
    this.bonusPortal = new BonusPortal(this, target, { claimed });
    if (claimed) this.bonusClaimed = true;
  }

  // ---- boss run persistence seam ---------------------------------------
  // Everything is plain data so main.js owns localStorage; the flow only says
  // what changed. Returning null means "this level is not part of a boss run".
  saveBossRun(patch = {}) {
    const link = this.bossFlow?.link || arenaLink(patch.arena) || entranceLink(patch.entrance);
    if (!link) return null;
    const base = this.bossRun && this.bossRun.arena === link.arena
      ? this.bossRun
      : newBossRun(link, { stage: patch.stage || 'approach' });
    const next = normaliseBossRun({
      ...base,
      ...patch,
      arena: link.arena,
      entrance: link.entrance,
      updatedAt: Date.now(),
    });
    if (!next) return null;
    next.updatedAt = Date.now();
    this.bossRun = next;
    this.onBossRun?.(next);
    return next;
  }

  clearBossRun() {
    this.bossRun = null;
    this.onBossRun?.(null);
  }

  // ---- wall-crack / hidden levels ---------------------------------------
  // The crack itself is painted in the parent background. Entering it stashes
  // the live parent level (so cheese/cat/switch state is preserved) and loads
  // the hidden level; clearing the hidden level restores the parent at the
  // crack's specific return point.
  //
  // Claim order matters: the crack is NOT marked used here. A hidden level that
  // is abandoned or failed must stay reachable, otherwise the entrance's reward
  // is lost without ever being paid (the old code marked it on entry).
  enterCrack(crack) {
    if (this.crackEnter || this.bonusReturn) return false;
    const target = this.levelCatalog.find((level) => level.id === crack.target);
    if (!target) return false;
    audio.playSound(141, { priority: 7 }); // ui_findsecret
    this.crackEnter = { elapsed: 0, duration: 0.42, crack, target };
    this.mouse.clearPath();
    this.mouse.moving = false;
    return true;
  }

  /** Reward-room portal entry (src/bonus.js). */
  enterBonusFromPortal(portal) {
    if (!portal || this.bonusReturn) return false;
    const target = this.levelCatalog?.[portal.targetIndex];
    if (!target) return false;
    return this.beginBonus(target, {
      kind: 'portal',
      id: `bonus:${target.id}`,
      returnTo: { x: portal.x, y: portal.y },
      portal,
    });
  }

  beginBonus(target, origin) {
    if (!target || this.bonusReturn) return false;
    const returnTo = origin?.returnTo || origin?.trigger || { x: this.mouse.x, y: this.mouse.y };
    const saved = {
      level: this.level,
      floorLevels: this.floorLevels,
      levelIndex: this.levelIndex,
      mouse: this.mouse,
      carried: this.carried,
      tools: this.tools,
      stats: this.stats,
      score: this.score,
      time: this.time,
      timeLeft: this.timeLeft,
      cheeseLeft: this.cheeseLeft,
      cheeseCounts: this.cheeseCounts,
      lives: this.lives,
      lastSettlement: this.lastSettlement,
      bossWorldComplete: this.bossWorldComplete,
      bgImg: this.bgImg,
      cracks: this.cracks,
      currentMusic: this.currentMusic,
      // Run/portal objects are stashed by reference: they hold the live claim
      // flags and the boss flow, which must not be rebuilt on return.
      bossFlow: this.bossFlow,
      bossRun: this.bossRun,
      portal: this.bonusPortal,
      bonusMultiplier: this.bonusMultiplier,
      bonusClaimed: this.bonusClaimed,
      arrowTimer: this.arrowTimer,
      exitWasOpen: this.exitWasOpen,
      exitOpenTime: this.exitOpenTime,
      origin: { kind: origin?.kind || 'crack', id: origin?.id ?? null, returnTo },
      targetId: target.id,
    };
    this.bonusReturn = saved;
    this.loadLevel(target, this.levelCatalog.indexOf(target));
    this.intro = null;
    this.state = 'playing';
    this.bonusLevelId = target.id;
    this.emitHud();
    return true;
  }

  abandonBonus() {
    // Dropping the parent stash (level select / new level) must never consume
    // a reward: the claim is only written by a successful finishBonus().
    this.bonusReturn = null;
    this.crackEnter = null;
    this.bonusLevelId = null;
  }

  /**
   * Restore the parent level after a reward room. `success` pays the reward
   * exactly once; a failed/aborted run returns to the same spot with the
   * entrance still usable.
   */
  finishBonus(success = true) {
    const saved = this.bonusReturn;
    if (!saved) return false;
    this.level = saved.level;
    this.floorLevels = saved.floorLevels;
    this.levelIndex = saved.levelIndex;
    this.mouse = saved.mouse;
    this.carried = saved.carried;
    this.tools = saved.tools;
    this.stats = saved.stats;
    this.score = saved.score;
    this.time = saved.time;
    this.timeLeft = saved.timeLeft;
    this.cheeseLeft = saved.cheeseLeft;
    this.cheeseCounts = saved.cheeseCounts;
    this.lives = saved.lives;
    this.lastSettlement = saved.lastSettlement;
    this.bossWorldComplete = saved.bossWorldComplete;
    this.bgImg = saved.bgImg;
    this.currentMusic = saved.currentMusic;
    this.cracks = saved.cracks;
    this.bossFlow = saved.bossFlow || null;
    this.bossRun = saved.bossRun || null;
    this.bonusPortal = saved.portal || null;
    this.bonusMultiplier = saved.bonusMultiplier ?? 1;
    this.bonusClaimed = saved.bonusClaimed ?? false;
    this.arrowTimer = saved.arrowTimer ?? 0;
    this.exitWasOpen = saved.exitWasOpen ?? false;
    this.exitOpenTime = saved.exitOpenTime ?? null;
    if (success) {
      // Only the entrance that was actually used is spent. Keying it on the
      // target instead would close every other door into the same hidden level
      // (e.g. 1-7's painted crack once 1-S was cleared from map10's reward
      // room). The record is persisted so it survives a reload.
      if (saved.origin?.kind === 'crack' && saved.origin.id) {
        this.crackClaims = this.crackClaims || {};
        this.crackClaims[saved.origin.id] = true;
        this.onCrackUsed?.(saved.origin.id);
      }
      for (const crack of this.cracks || []) {
        if (crack.id === saved.origin?.id) crack.used = true;
      }
      this.secretsFound.add(saved.targetId);
      this.onSecretFound?.(saved.targetId);
      if (!this.bonusClaimed) {
        this.bonusClaimed = true;
        this.bonusMultiplier = EXIT_BONUS_MULTIPLIER;
        this.bonusClaims = this.bonusClaims || {};
        this.bonusClaims[saved.level.id] = true;
        this.onBonusReward?.({
          levelId: saved.level.id,
          targetId: saved.targetId,
          multiplier: EXIT_BONUS_MULTIPLIER,
        });
      }
      audio.playSound(144, { priority: 7 }); // ui_reward
    }
    this.bonusPortal?.onReturn(this, success);
    // Specific return position beside the entrance, never the parent start.
    const back = saved.origin?.returnTo;
    if (back) {
      const open = this.level.world.closestOpen(back.x, back.y, this.mouse.radius);
      this.mouse.x = open.x;
      this.mouse.y = open.y;
    }
    this.mouse.angle = 0;
    this.mouse.lift = 0;
    this.mouse.hidden = false;
    this.mouse.hiddenTag = null;
    this.mouse.furnitureId = null;
    this.mouse.clearPath();
    this.mouse.moving = false;
    if (success) {
      // Payout feedback where the player left: the pickup float layer is the
      // existing "text above the hero" surface.
      this.floats.push({
        x: this.mouse.x,
        y: this.mouse.y,
        t: 0,
        text: this.language === 'en' ? 'x2 BONUS' : '奖励 x2',
        color: '#ffd166',
      });
    }
    this.bonusReturn = null;
    this.bonusLevelId = null;
    this.crackEnter = null;
    this.clearPresentation = null;
    this.death = null;
    this.intro = null;
    this.pipeTransit = null;
    this.emergeGrow = { elapsed: 0, duration: CFG.game.emergeGrowSeconds };
    this.state = 'playing';
    this.updateCamera();
    if (saved.currentMusic) audio.playMusic(saved.currentMusic, { loop: true });
    this.emitHud();
    return true;
  }

  resetLevel(fullReset) {
    this.death = null;
    this.clearPresentation = null;
    this.inputLocked = false;
    this.bumpedCats = new Set();
    this.pipeTransit = null;
    this.emergeGrow = null;
    const all=[...(this.floorLevels?.values()||[this.level])];
    if(this.floorLevels?.has(0)&&this.level!==this.floorLevels.get(0)){this.level=this.floorLevels.get(0);this.loadFloorBackground();}
    const lvl = this.level;
    for(const floor of all){floor.mechanisms.reset();floor.cheeses=floor.cheeses.filter(ch=>!ch.generated);}
    const world = lvl.world;
    const { x: sx, y: sy } = playerSpawnPoint(lvl.mouseStart, world, CFG.mouse.radiusCells * world.cell);
    this.mouse = new Mouse(sx, sy, 0, world);
    this.mouse.vx = 0;
    this.mouse.vy = 0;
    for(const catLevel of all){const world=catLevel.world;for (const c of catLevel.cats) {
      const p = world.closestOpen(c.route[0].x, c.route[0].y, c.radius || CFG.cat.radiusCells * world.cell);
      c.x = p.x;
      c.y = p.y;
      c.routeIndex = c.route.length > 1 ? c.nearestWaypointIndex() : 0;
      c.state = "patrol";
      c.navPath = null;
      c.navGoal = null;
      c.repathTimer = 0;
      c.navInvalidated = true;
      c.lastSeen = null;
      c.searchTimer = 0;
      c.returnIndex = null;
      c.angle = c.homeAngle;
      c.routeDir = 1;
      c.endpointTimer = 0;
      c.waypointTimer = 0;
      c.stopped = false;
      c.seeTimer = 0;
      c.loseTimer = 0;
      c.pounceTimer = 0;
      c.pounceCooldown = 0;
      c.pounceTarget = null;
      c.stunTimer = 0;
      c.attackCooldown = 0;
      c.attackTimer = 0;
      c.burstLeft = 0;
      c.burstTimer = 0;
      c.attackTarget = null;
      c.distraction=null;c.rest=null;
    }}
    // Some extracted bonus-floor entry points coincide with a cat's first
    // patrol point (map729 floor 1). Move the hero to the nearest safe open
    // cell instead of starting inside a catch radius.
    const floorCats = lvl.cats || [];
    if (floorCats.some((c) => Math.hypot(c.x - this.mouse.x, c.y - this.mouse.y) < (c.radius || CFG.cat.radiusCells * world.cell) + this.mouse.radius + 2)) {
      let safe = null;
      for (let ring = 1; ring <= 5 && !safe; ring++) {
        for (let k = 0; k < 16 && !safe; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = sx + Math.cos(a) * world.cell * ring;
          const y = sy + Math.sin(a) * world.cell * ring;
          if (world.circleHitsWall(x, y, this.mouse.radius)) continue;
          if (floorCats.some((c) => Math.hypot(c.x - x, c.y - y) < (c.radius || CFG.cat.radiusCells * world.cell) + this.mouse.radius + 2)) continue;
          safe = { x, y };
        }
      }
      if (safe) { this.mouse.x = safe.x; this.mouse.y = safe.y; }
    }
    if (fullReset) {
      for (const c of all.flatMap(floor=>floor.cheeses)) {
        c.taken = false;
      }
      // Carried cheese chain (native player+0x190; parallel-O1).
      this.carried = [];
      for (const cr of all.flatMap(floor=>floor.crumbs||[])) cr.taken = false;
      this.lives = CFG.game.lives;
      this.time = 0;
    }
    const actions = ['checkmap1', 'scratch1', 'sniff1', 'yoyo1', 'juggle_loop'];
    this.intro = this.options.intro === false ? null : {
      elapsed: 0, hold: 2, reveal: 0.85,
      animation: actions[this.introCount++ % actions.length],
    };
    resetCarried(this.carried, this.mouse);
    resetCwmice(lvl);
    for(const floor of all)resetCwmice(floor);
    for (const b of lvl.bosses || []) {
      b.defeated = false;
      if ('dead' in b) b.dead = false;
      if ('defeat' in b) b.defeat = null;
      if ('receivedEvents' in b) b.receivedEvents.clear();
      if ('levelPhase' in b) b.levelPhase = 0;
      if ('hitCounter' in b) b.hitCounter = 0;
      if ('collisionBits' in b) b.collisionBits = 0;
      if ('slotsRemaining' in b) b.slotsRemaining = b.trigger?.kind === 'collisionBitsAndSlots' ? b.trigger.slots : null;
    }
    this.bossWin = false;
    this.bossWorldComplete = false;
    this.lastBossDefeat = null;
    this.pipesUsed = 0;
    this.transportsUsed = 0;
    this.pipeCooldown = 0;
    this.pendingHide = null;
    this.pipeExitLock=null;
    this.floorExitLock=null;
    this.entrancePulses=new Map();this.pipeGlow=null;
    // Reward-room entrance presentation resets with the level, but its claim
    // flag is never cleared here (that would allow a duplicate payout).
    this.bonusPortal?.reset(this);
    // Native teleport state machine (0xfda2c: states 0/1/2, 50 ms sprite
    // sequences): the player shrinks into the entry mouth, swaps to the exit
    // mouth, then grows back out. `pipeTransit` drives that brief lock.
    this.pipeTransit=null;
    this.cheeseLeft = all.reduce((sum,floor)=>sum+floor.cheeses.filter(c=>!c.taken).length,0);
    this.score = 0;
    this.envSpeedMult = 1;
    this.cheeseCounts = {};
    this.caughtCount = 0;
    this.lastSettlement = null;
    // Exit state + arrow indicator (parallel-O2: open state 0x27, arrow 5 s).
    this.arrowTimer = 0;
    this.exitWasOpen = false;
    this.exitOpenTime = null;
    // Native goal counters (parallel-L1): paths/seen/used_pipe/used_mousehole
    // are the ones trackable in the port today.
    this.stats = { paths: 0, spotted: 0, bump: 0, pipes: 0, mouseHoles: 0, crumbsTaken: 0 };
    // Stop looped sfx that a previous attempt may have left running (timer
    // ticks, platform loop, purr, boss robot loops, mech loops).
    for (const id of [117, 118, 72, 29, 5, 6, 7, 163, 164, 165, 166, 167, 168]) audio.stopSound(id);
    // No time limit (the game has no level timer); `times` stays for goals.
    this.timeLeft = null;
    this.lastHudTime = null;
    this.projectiles = [];
    this.pickupEffects = [];
    this.stroke = null;
    this.floats = [];
    this.emitHud();
  }

  get pendingMachineCheese(){return [...(this.floorLevels?.values()||[this.level])].reduce((n,floor)=>n+floor.mechanisms.pendingCheese,0);}
  loadFloorBackground(){
    this.bgImg=null;const url=this.level.bg;
    if(url){const img=new Image();img.onload=()=>{if(this.level.bg===url)this.bgImg=img;};img.src=url;}
  }
  switchFloor(number){
    const target=this.floorLevels?.get(number);if(!target||target===this.level)return false;
    const previous=this.level,old=previous.mechanisms,next=target.mechanisms;
    for(const key of ['boost','coverTime','balloon','tools']){next[key]=old[key];old[key]=key==='tools'?[]:key==='coverTime'?0:null;}
    this.level=target;const open=target.world.closestOpen(this.mouse.x,this.mouse.y,this.mouse.radius);
    Object.assign(this.mouse,{x:open.x,y:open.y,hidden:false,hiddenTag:null,furnitureId:null,airborne:false,lift:0});this.mouse.clearPath();
    this.floorExitLock={...open};
    this.projectiles=[];old.pendingInteraction=null;
    this.cancelStroke();this.pendingHide=null;this.pipeCooldown=1;this.pipeExitLock=null;
    resetCarried(this.carried,this.mouse);resetCarried(next.tools,this.mouse);
    this.exitWasOpen=false;this.exitOpenTime=null;this.loadFloorBackground();this.updateCamera();this.emitHud();return true;
  }

  emitHud() {
    if (this.onHud) {
      this.onHud({
        lives: this.lives,
        cheeseLeft: this.cheeseLeft,
        timeLeft: this.timeLeft,
        pipesUsed: this.pipesUsed,
        transportsUsed: this.transportsUsed,
        score: this.score,
        goals: this.level ? this.level.goals : null,
      });
    }
  }

  worldToScreen(x, y) {
    return { x: this.cam.ox + x * this.cam.scale, y: this.cam.oy + y * this.cam.scale };
  }

  screenToWorld(x, y) {
    return { x: (x - this.cam.ox) / this.cam.scale, y: (y - this.cam.oy) / this.cam.scale };
  }

  // ---- input -----------------------------------------------------------

  onPointerDown(pt) {
    if (this.state !== "playing") return;
    // Boss intro/approach cinematics lock drawing but never the simulation.
    if (this.inputLocked || this.bossFlow?.inputLocked) return;
    let w = this.screenToWorld(pt.x, pt.y);
    const rawPoint={...w};
    const wasHidden=this.mouse.hidden;
    if(wasHidden&&this.mouse.furnitureId==null)this.handleTap(rawPoint);
    const emergedOnDown=wasHidden&&!this.mouse.hidden;
    if(emergedOnDown)w={x:this.mouse.x,y:this.mouse.y};
    // Dragging may start on furniture/decor: snap to the nearest floor.
    w = this.level.world.clearPoint(w.x, w.y, this.mouse.radius);
    this.pendingHide = null;
    this.stroke = { points: [{ x: w.x, y: w.y }], rawPoint, emergedOnDown, length: 0, live: false };
  }

  onPointerMove(pt) {
    if (this.state !== "playing" || !this.stroke) return;
    const u = this.level.world.cell;
    let w = this.screenToWorld(pt.x, pt.y);
    const entrance=this.snapTarget(w);
    if(entrance?.type==='hole'||entrance?.type==='pipe')w={x:entrance.x,y:entrance.y};
    w = this.level.world.clearPoint(w.x, w.y, this.mouse.radius);
    const last = this.stroke.points[this.stroke.points.length - 1];
    const d = dist(last.x, last.y, w.x, w.y);
    if (d < CFG.draw.minStepCells * u) return;
    if (this.stroke.length + d > CFG.draw.maxLengthCells * u * (this.level.trailLength || 1)) return;
    // A stroke may not cross a wall: ignore moves that would, but keep the
    // stroke alive so it still commits when the pointer is released.
    if (!this.level.world.lineClear(last.x, last.y, w.x, w.y)) return;
    this.stroke.points.push({ x: w.x, y: w.y });
    this.stroke.length += d;
    // Live follow (user rule): once the stroke is a real line, the mouse starts
    // moving toward the current endpoint and keeps following later updates
    // without waiting for pointerup. Appending to the existing path keeps the
    // drawn trail and never restarts the move.
    if (!this.mouse.hidden) {
      if (!this.stroke.live) {
        this.stroke.live = true;
        this.stats.paths++;
        let route = this.stroke.points.slice(1);
        if (!this.level.world.lineClear(this.mouse.x, this.mouse.y, route[0].x, route[0].y)) {
          const bridge = this.level.world.bfsToWorld(this.mouse.x, this.mouse.y, route[0].x, route[0].y);
          if (bridge) route = [...bridge, ...route];
        }
        const snap0 = this.snapTarget(w);
        this.pendingHide=snap0?.type==='hole'?snap0.hole:null;
        if (snap0 && route.length) {
          route[route.length - 1] = { x: snap0.x, y: snap0.y };
        }
        this.mouse.setPath(route);
      } else {
        this.mouse.path.push({ x: w.x, y: w.y });
        const snap = this.snapTarget(w);
        this.pendingHide=snap?.type==='hole'?snap.hole:null;
        if (snap && this.mouse.path.length) {
          const last = this.mouse.path[this.mouse.path.length - 1];
          last.x = snap.x;
          last.y = snap.y;
        }
      }
    }
  }

  // Snap the drawn endpoint to a nearby cheese (any) or the OPEN exit.
  // The native snap rule is unverified (parallel-O1/O2); radius TUNED at 1.6
  // cells, the evidence-based interaction radius is ~20px + 2*radius.
  snapTarget(p) {
    const u = this.level.world.cell;
    const r = u * 1.6;
    if (
      this.level.exit &&
      this.cheeseLeft === 0 &&
      this.pendingMachineCheese===0 &&
      dist(p.x, p.y, this.level.exit.x, this.level.exit.y) < r
    ) {
      return { type: "exit", x: this.level.exit.x, y: this.level.exit.y };
    }
    for (const c of this.level.cheeses) {
      if (!c.taken && dist(p.x, p.y, c.x, c.y) < r) return { type: "cheese", x: c.x, y: c.y };
    }
    for(const hole of this.level.hideables||[]){
      const raw=this.holeMouth(hole),mouth=this.level.world.closestOpen(raw.x,raw.y,this.mouse.radius);
      const art={x:hole.ox??hole.x,y:(hole.oy??hole.y)-u};
      if(dist(p.x,p.y,mouth.x,mouth.y)<r||dist(p.x,p.y,art.x,art.y)<u*2)return {type:'hole',hole,...mouth};
    }
    for(const group of this.level.pipeGroups||[])for(const piece of group.pieces){
      if(!pipeDestination(group,piece))continue;
      const mouth=this.level.transportMouth(piece,piece.prop);
      if(dist(p.x,p.y,mouth.x,mouth.y)<r||dist(p.x,p.y,piece.x,piece.y)<u*2)return {type:'pipe',...mouth};
    }
    for(const object of this.level.mechanisms.objects){
      if(['item','switch','cannon','floor'].includes(object.kind)&&!object.taken&&dist(p.x,p.y,object.x,object.y)<r){const open=this.level.world.closestOpen(object.x,object.y,this.mouse.radius);return {type:'mechanism',...open};}
    }
    return null;
  }

  onPointerUp() {
    if (this.state !== "playing") {
      this.stroke = null;
      return;
    }
    this.finalizeStroke();
  }

  cancelStroke() {
    this.stroke = null;
  }

  finalizeStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    const u = this.level.world.cell;
    const world = this.level.world;
    const last = s.points[s.points.length - 1];
    if(s.emergedOnDown&&!s.live)return;
    if (this.mouse.hidden || !s.live) {
      // A tap is an interaction in the original game: tap a hole to hide in
      // it; while hidden, a tap on a same-Tag hole pops out there (0xdbbd4
      // builds its scan reference from the screen->world input point, 45
      // design units, Tag == player Tag; 0x9e990 places at that object).
      this.handleTap(s.live?last:(s.rawPoint||last));
      return;
    }
    // Live stroke (user rule): the mouse already follows the drawn line, so
    // releasing only ends the session; it keeps walking to the current end.
  }

  // Hole interaction (native 0xb8e00 tag assignment + 0xdbbd4 scan):
  // a tap on a hole hides the mouse; while hidden, a tap within 45 design
  // units of a same-Tag hole (the scan reference is the screen->world input
  // point) emerges there; otherwise the hidden mouse stays put.
  handleTap(p) {
    if(this.bonusPortal?.tryTap(this, p))return;
    if(this.handlePipeTap(p))return;
    if(this.level.mechanisms.handleTap(this,p))return;
    const holes = this.level.hideables || [];
    if (!holes.length) return;
    const u = this.level.world.cell;
    const nearest = (tag, ref = p) => {
      let best = null;
      let bestD = Infinity;
      for (const h of holes) {
        if (tag != null && Math.abs(h.tag) !== Math.abs(tag)) continue;
        const d = Math.min(dist(h.x,h.y,ref.x,ref.y),dist(h.ox??h.x,(h.oy??h.y)-u,ref.x,ref.y));
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
      // Native scan radius is 45 design units (= u*5.6 world px); allow 5
      // cells so a tap on the wall face still finds its hole.
      return bestD <= u * 5 ? best : null;
    };
    if (this.mouse.hidden) {
      const target = nearest(this.mouse.hiddenTag);
      if (target) this.emergeAt(target);
      return;
    }
    const hole = nearest(null);
    if (!hole) return;
    const raw = this.holeMouth(hole);
    const mouth = this.level.world.closestOpen(raw.x, raw.y, this.mouse.radius);
    const route = this.level.world.bfsToWorld(this.mouse.x, this.mouse.y, mouth.x, mouth.y);
    if (!route || !route.length) {
      // Already at the mouth (or the mouth cell is not a BFS goal): hide now.
      if (dist(this.mouse.x, this.mouse.y, mouth.x, mouth.y) < u * 1.2) this.enterHole(hole);
      return;
    }
    this.pendingHide = hole;
    this.mouse.setPath(route);
  }

  holeMouth(hole) {
    // Engine exit offset (0x9e990) is 2*(radius+5) design units in the hole's
    // opening direction; world px = 2*design. P20 down, P21 right, P22 up,
    // P23 left (mbn y is up, world y is down).
    return mouthPosition(hole, this.mouse.radius + 10);
  }

  enterHole(hole) {
    this.pulseEntrance(hole);
    // Native 0x90f2c: prop 20-23 / 360-363 use 50 (hole hide); other hideable
    // props use 39 (hide). The old code used 39 for every hole.
    const holeSound = [20, 21, 22, 23, 360, 361, 362, 363].includes(hole.prop) ? 50 : 39;
    audio.playSound(holeSound);
    this.level.mechanisms.onHide();
    this.pendingHide = null;
    this.mouse.hidden = true;
    this.mouse.hiddenTag = hole.tag;
    this.mouse.clearPath();
    this.stats.mouseHoles++;
  }

  emergeAt(hole) {
    this.pulseEntrance(hole);
    audio.playSound(51); // native 0xB55B0 hide_out (0x33)
    const mouth = this.holeMouth(hole);
    const open = this.level.world.closestOpen(mouth.x, mouth.y, this.mouse.radius);
    this.mouse.x = open.x;
    this.mouse.y = open.y;
    resetCarried(this.carried, this.mouse);
    this.mouse.hidden = false;
    this.mouse.hiddenTag = null;
    this.mouse.clearPath();
    this.emergeGrow = { elapsed: 0, duration: CFG.game.emergeGrowSeconds };
    this.pipeCooldown = 0.4;
  }

  // ---- update ----------------------------------------------------------

  update(dt) {
    if (this.bossTransition) {
      this.updateBossTransition(dt);
      return;
    }
    if (this.state === 'levelclear' && this.clearPresentation) {
      const clear = this.clearPresentation;
      clear.elapsed += Math.max(0, dt);
      if (clear.phase === 'enter') {
        const p = clamp(clear.elapsed / Math.max(1e-4, clear.duration), 0, 1);
        // Ease-in: the hero accelerates into the door while shrinking.
        const e = p * p * p;
        this.mouse.x = clear.startX + (clear.x - clear.startX) * e;
        this.mouse.y = clear.startY + (clear.y - clear.startY) * e;
        this.mouse.angle = Math.atan2(clear.y - clear.startY, clear.x - clear.startX);
        clear.scale = Math.max(0, 1 - 0.94 * Math.min(1, p * 1.08));
        if (p >= 1) {
          this.mouse.x = clear.x;
          this.mouse.y = clear.y;
          clear.scale = 0;
          clear.phase = 'announcement';
          clear.elapsed = 0;
          // Hidden/bonus level: return to the parent at the crack's exact exit
          // instead of opening the normal results overlay.
          if (this.bonusReturn) this.finishBonus();
          else this.onLevelEnd?.({ type: 'clear', level: this.levelIndex, settlement: this.lastSettlement });
        }
      } else if (clear.phase === 'announcement' && clear.elapsed >= CFG.game.clearAnnouncementSeconds) {
        clear.phase = 'results';
        this.onLevelEnd?.({ type: 'results', level: this.levelIndex, settlement: this.lastSettlement });
      }
      return;
    }
    if (this.state === 'caught' && this.death) {
      this.death.elapsed += Math.max(0, dt);
      const fight = CFG.game.caughtFightSeconds;
      const close = CFG.game.caughtCloseSeconds;
      this.death.phase = this.death.elapsed < fight ? 'fight'
        : this.death.elapsed < fight + close ? 'closing'
        : 'fail';
      // Native fail flow (0xe3594): the game waits delay_results_on_level_fail
      // (default 1000 ms) before the fail scene; the scene is the PinholeManager
      // case-2 iris (cat silhouette over bg_death). The port keeps the purple
      // fail frame until the player picks Retry - it no longer reloads the
      // level underneath the mask.
      if (this.death.phase === 'fail' && !this.death.failNotified) {
        this.death.failNotified = true;
        this.onLevelEnd?.({ type: 'caught', level: this.levelIndex });
      }
      return;
    }
    if (this.state !== "playing") return;
    // Follow camera (wide maps): keep the mouse centered at the original zoom.
    this.updateCamera();
    // Fixed 60 Hz simulation step. The native cat logic is per-frame and its
    // frame rate is unverified, but a fixed web step keeps fixed-input replays
    // stable across display rates (30/60/120 Hz).
    const STEP = 1 / 60;
    if (dt > STEP * 1.5) {
      let remaining = dt;
      while (remaining > 1e-9 && this.state === "playing") {
        const s = Math.min(STEP, remaining);
        this.step(s);
        remaining -= s;
      }
      return;
    }
    this.step(dt);
  }

  step(dt) {
    if (this.state !== "playing") return;
    if (this.intro) {
      this.intro.elapsed += dt;
      if (this.intro.elapsed < this.intro.hold + this.intro.reveal) return;
      this.intro = null;
    }
    if (this.emergeGrow) {
      this.emergeGrow.elapsed += dt;
      if (this.emergeGrow.elapsed >= this.emergeGrow.duration) this.emergeGrow = null;
    }
    if (this.updatePipeTransit(dt)) return;
    if (this.crackEnter) {
      this.crackEnter.elapsed += dt;
      if (this.crackEnter.elapsed >= this.crackEnter.duration) {
        const transit = this.crackEnter;
        this.crackEnter = null;
        this.beginBonus(transit.target, transit.crack);
      }
      return;
    }
    // Wall-crack entrance: walking onto the open point beside a painted crack
    // pushes the hero through. The parent level is stashed by beginBonus().
    if (!this.bonusReturn && this.cracks.length) {
      for (const crack of this.cracks) {
        if (crack.used) continue;
        const cell = this.level.world.cell;
        // Two measurements, because the hero can never stand on the painted
        // crack itself (it is inside the wall):
        //   * the authored trigger point, for an exact walk-up, and
        //   * the crack decal in the art, with a radius wide enough to cover the
        //     whole drawn zigzag. Without the second one, 1-7 was unreachable:
        //     the corridor corner stops the hero ~23 px short of the trigger
        //     point (measured in the browser), so nothing happened.
        const atTrigger = dist(this.mouse.x, this.mouse.y, crack.trigger.x, crack.trigger.y) <= cell * 1.1;
        const atDecal = dist(this.mouse.x, this.mouse.y, crack.x, crack.y) <= cell * 2;
        // Standing still keeps it deliberate; pushing into the crack while still
        // moving counts too, as long as the hero is inside the decal radius.
        if (atTrigger || (atDecal && !this.mouse.moving)) {
          this.enterCrack(crack);
          return;
        }
      }
    }
    this.time += dt;
    if (this.timeLeft != null) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        this.timeout();
        return;
      }
      const shown = Math.ceil(this.timeLeft);
      if (shown !== this.lastHudTime) {
        this.lastHudTime = shown;
        this.emitHud();
      }
    }
    const world = this.level.world;
    const u = world.cell;

    const px = this.mouse.x;
    const py = this.mouse.y;
    const wasMoving = this.mouse.moving;
    // Hazard layer first: it refreshes envSpeedMult (water) and may kill on
    // lava/electric contact. Mechanisms.prepare applies the speed multiplier.
    updateHazards(this, dt);
    if (this.state !== "playing") return;
    this.level.mechanisms.prepare(this,dt);
    if(!this.mouse.airborne)this.mouse.update(dt, world);
    updateCarried(this.carried || [], this.mouse, world, dt);
    this.mouse.vx = (this.mouse.x - px) / Math.max(dt, 1e-6);
    this.mouse.vy = (this.mouse.y - py) / Math.max(dt, 1e-6);

    this.pipeCooldown = Math.max(0, this.pipeCooldown - dt);
    if(this.level.nativePipes||wasMoving&&!this.mouse.moving)this.tryPipeTravel();
    if (this.pendingHide && !this.mouse.moving) {
      const h = this.pendingHide;
      const raw = this.holeMouth(h);
      const mouth = world.closestOpen(raw.x, raw.y, this.mouse.radius);
      if (dist(this.mouse.x, this.mouse.y, mouth.x, mouth.y) < u * 1.2) this.enterHole(h);
      else this.pendingHide = null;
    }

    // Safety net: if the mouse ever ends up inside geometry while idle, pull it
    // back to the nearest floor instead of leaving it stuck.
    if (
      !this.mouse.moving &&
      !this.mouse.airborne &&
      world.circleHitsWall(this.mouse.x, this.mouse.y, this.mouse.radius * 0.9)
    ) {
      const open = world.closestOpen(this.mouse.x, this.mouse.y, this.mouse.radius);
      this.mouse.x = open.x;
      this.mouse.y = open.y;
      this.mouse.stuckTimer = 0;
    }

    // Boss controller seam (parallel-M1). The native win conditions are
    // evaluated only from raw host inputs; no gameplay driver is invented.
    // Contact with a live boss remains lethal.
    for (const b of this.level.bosses || []) {
      if (b.defeated) continue;
      if (typeof b.update === 'function') {
        b.update(dt, { mouse: this.mouse, game: this, caught: () => this.caught(b) });
        if (this.state !== 'playing') return;
      } else {
        const r = b.radius != null ? b.radius : u * 2.4;
        if (!this.mouse.hidden && dist(b.x, b.y, this.mouse.x, this.mouse.y) < r + this.mouse.radius) {
          this.caught();
          return;
        }
      }
    }

    const catWorld = this.level.catWorld || world;
    for (const c of this.level.cats) {
      const beforeState = c.state;
      c.update(dt, catWorld, this.mouse.hidden ? null : this.mouse, this.projectiles);
      if (beforeState === 'pounceRun' && c.state === 'stunned') {
        this.bumpedCats.add(c); this.stats.bump = this.bumpedCats.size;
      }
      // Native 'seen' stat (parallel-L1): a first detection transition.
      if (beforeState !== "spot" && beforeState !== "chase" && c.state === "spot") this.stats.spotted++;
      // Body contact uses separate extents from navigation clearance.
      // Any physical contact with a cat kills the mouse - not only while chasing.
      // A hidden mouse is inside a hole and cannot be caught.
      if (
        !this.mouse.hidden &&
        c.state !== "stunned" && !this.mouse.airborne &&
        dist(c.x, c.y, this.mouse.x, this.mouse.y) < u * (CFG.mouse.contactRadiusCells + CFG.cat.contactRadiusCells) &&
        (c.ghost || catWorld.lineClear(c.x, c.y, this.mouse.x, this.mouse.y))
      ) {
        this.caught(c);
        return;
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= p.speed * dt + 1e-6) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        p.x += (dx / d) * p.speed * dt;
        p.y += (dy / d) * p.speed * dt;
      }
      if (!this.mouse.hidden && dist(p.x, p.y, this.mouse.x, this.mouse.y) < p.radius + this.mouse.radius) {
        if(this.level.mechanisms.absorbProjectile()){this.projectiles.splice(i,1);continue;}
        this.projectiles.splice(i, 1);
        this.caught();
        return;
      }
      if (
        p.life <= 0 ||
        d <= p.speed * dt + 1e-6 ||
        world.circleHitsWall(p.x, p.y, p.radius)
      ) {
        this.projectiles.splice(i, 1);
        continue;
      }
    }

    for (const effect of this.pickupEffects) effect.elapsed += dt * 1000;
    this.pickupEffects = this.pickupEffects.filter(effect => effect.elapsed < 375);

    if(!this.mouse.hidden&&!this.mouse.airborne)updateCwmice(this.level,this.mouse,dt,(id)=>audio.playSound(id));
    this.level.mechanisms.update(this,dt,{x:px,y:py});
    if(this.state!=='playing'||this.level.world!==world)return;
    // Reward-room entrance: appears when the level has nothing left to collect,
    // then waits for an explicit tap (src/bonus.js).
    this.bonusPortal?.update(dt, this);
    if (this.state !== 'playing') return;
    // Boss run: approach stages/camera or the arena fight, resolved before the
    // normal exit check so the entrance gate hands over instead of clearing.
    this.bossFlow?.step?.(this, dt);
    if (this.state !== 'playing') return;
    if (this.bossFlow?.interceptExit?.(this)) return;
    // A boss entrance ends at the gate hand-over, never with a normal clear -
    // even while the boss-appearance cinematic keeps the player waiting there.
    if (this.bossFlow?.kind === 'approach'
      && (this.level.mechanisms.exitDoorReady || this.bossFlow.atGate?.(this))) return;
    // Native exit doors 358 (boss) / 359 (level): only an OPEN door wins on
    // contact; 357 is a decorative entrance (special factory 0x9ed40). The
    // Mechanisms update resolves the open state and the interaction point.
    if (this.level.mechanisms.exitDoorReady) {
      this.levelClear();
      return;
    }
    if (!this.mouse.hidden&&!this.mouse.airborne) {
      for (const ch of this.level.cheeses) {
        if (!ch.taken && dist(ch.x, ch.y, this.mouse.x, this.mouse.y) < u * 0.7) {
          ch.taken = true;
          this.pickupEffects.push({ x: ch.x, y: ch.y, elapsed: 0 });
          this.cheeseLeft--;
          audio.playSound(110); // native 0x6e pickup_food
          this.cheeseCounts[ch.prop] = (this.cheeseCounts[ch.prop] || 0) + 1;
          this.carried.push({ prop: ch.prop, x: ch.x, y: ch.y, angle: this.mouse.angle });
          this.floats.push({ x: ch.x, y: ch.y, t: 0, text: "+1", color: COLORS.cheese });
          this.emitHud();
        }
      }
      // Prop-260 crumbs (native all_crumbs goal).
      if (Array.isArray(this.level.crumbs)) {
        for (const cr of this.level.crumbs) {
          if (!cr.taken && dist(cr.x, cr.y, this.mouse.x, this.mouse.y) < u * 0.7) {
            cr.taken = true;
            this.stats.crumbsTaken++;
            this.score += 2; // native cheese_crumb_score
            audio.playSound(34); // native eat_food.sps (crumb pickup)
          }
        }
      }

      // Prop-11 cwmouse pickup/follow/vanish (parallel-L2).

      // Native exit gating (parallel-O2): the hole is CLOSED (state 0x26)
      // until the level goal (all cheese) is collected, then OPEN (state 0x27);
      // only an open hole wins. Opening sets the 5 s arrow indicator.
      const exitOpen = !!(this.level.exit && this.cheeseLeft === 0 && this.pendingMachineCheese===0);
      if (exitOpen && !this.exitWasOpen) {
        this.arrowTimer = 5000;
        this.exitOpenTime = this.time;
        audio.playSound(35); // native 0x23 exit_ready.sps
      }
      this.exitWasOpen = exitOpen;
      if (this.arrowTimer > 0) {
        this.arrowTimer = Math.max(0, this.arrowTimer - dt * 1000);
        if (this.level.exit && dist(this.level.exit.x, this.level.exit.y, this.mouse.x, this.mouse.y) < u * 0.8) {
          this.arrowTimer = Math.max(this.arrowTimer, 1000);
        }
      }
      if (exitOpen && dist(this.level.exit.x, this.level.exit.y, this.mouse.x, this.mouse.y) < u * 0.6) {
        this.levelClear();
        return;
      }
    }

    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < 0.9);
  }

  tryPipeTravel() {
    if(this.level.nativePipes)return this.tryNativePipeTravel();
    if (this.pipeCooldown > 0 || this.mouse.hidden) return false;
    const list = this.level.transports.length ? this.level.transports : this.level.pipes;
    if (!list.length) return false;
    const u = this.level.world.cell;
    const m = this.mouse;
    for (const p of list) {
      const da = dist(m.x, m.y, p.aExit.x, p.aExit.y);
      const db = dist(m.x, m.y, p.bExit.x, p.bExit.y);
      if (Math.min(da, db) > u * 1.6) continue;
      const to = da <= db ? p.bExit : p.aExit;
      const kind = p.kind || "pipe";
      this.startPipeTransit(to, { kind });
      if (kind === "pipe") this.pipesUsed++;
      else this.transportsUsed++;
      this.stats.pipes++;
      return true;
    }
    return false;
  }

  handlePipeTap(point){
    if(this.mouse.hidden)return false;
    const u=this.level.world.cell;
    for(const group of this.level.pipeGroups||[])for(const entry of group.pieces){
      if(!pipeDestination(group,entry)||dist(point.x,point.y,entry.x,entry.y)>u*2.5)continue;
      const mouth=this.level.transportMouth(entry,entry.prop),route=this.level.world.bfsToWorld(this.mouse.x,this.mouse.y,mouth.x,mouth.y);
      this.pendingHide=null;
      if(dist(this.mouse.x,this.mouse.y,mouth.x,mouth.y)<u*1.25){this.pipeExitLock=null;this.tryNativePipeTravel(entry.id);}
      else if(route)this.mouse.setPath(route);
      return true;
    }
    return false;
  }

  tryNativePipeTravel(entryId=null){
    const m=this.mouse,u=this.level.world.cell;
    if(m.hidden||m.airborne)return false;
    if(this.pipeExitLock&&dist(m.x,m.y,this.pipeExitLock.x,this.pipeExitLock.y)>u*2.1)this.pipeExitLock=null;
    if(this.pipeCooldown>0||this.pipeExitLock)return false;
    const candidates=[];
    for(const group of this.level.pipeGroups||[])for(const entry of group.pieces){
      if(entryId!=null&&entry.id!==entryId)continue;
      const destination=pipeDestination(group,entry);if(!destination)continue;
      const mouth=this.level.transportMouth(entry,entry.prop),d=dist(m.x,m.y,mouth.x,mouth.y);
      if(d<u*1.25)candidates.push({d,destination,entry,tag:group.tag});
    }
    candidates.sort((a,b)=>a.d-b.d);if(!candidates.length)return false;
    const target=candidates[0].destination,to=this.level.transportMouth(target,target.prop);
    this.pulseEntrance(candidates[0].entry,'pipe');this.pulseEntrance(target,'pipe');
    this.startPipeTransit(to,{tag:candidates[0].tag,kind:'pipe'});
    this.pipesUsed++;this.stats.pipes++;return true;
  }

  // Native teleport state machine 0xfda2c (states 0/1/2): the player scale
  // shrinks into the entry mouth, is placed at the exit mouth, then grows out.
  // Both ends keep the group's tag colour (pipe portal TINT in drawPipes).
  startPipeTransit(to, {tag=null, kind='pipe'} = {}) {
    if (!to || this.pipeTransit) return false;
    const m = this.mouse;
    m.clearPath(); m.vx = 0; m.vy = 0;
    this.pendingHide = null;
    this.pipeTransit = {
      elapsed: 0, phase: 'in', duration: 0.16,
      dest: { x: to.x, y: to.y }, tag, kind,
    };
    this.pipeGlow = { tag, time: this.time };
    audio.playSound(71); // native 0x47 use_pipe.sps
    this.emitHud();
    return true;
  }

  pipeTransitScale() {
    const t = this.pipeTransit;
    if (!t) return 1;
    const p = clamp(t.elapsed / Math.max(1e-4, t.duration), 0, 1);
    const eased = p * p * (3 - 2 * p);
    return t.phase === 'in' ? 1 - 0.75 * eased : 0.25 + 0.75 * eased;
  }

  updatePipeTransit(dt) {
    const t = this.pipeTransit;
    if (!t) return false;
    t.elapsed += Math.max(0, dt);
    if (t.phase === 'in' && t.elapsed >= t.duration) {
      const m = this.mouse;
      m.x = t.dest.x; m.y = t.dest.y; m.vx = 0; m.vy = 0; m.clearPath();
      resetCarried(this.carried, m);
      resetCarried(this.level.mechanisms.tools, m);
      t.phase = 'out'; t.elapsed = 0;
      this.pipeCooldown = 0.6;
      this.pipeExitLock = { ...t.dest };
    } else if (t.phase === 'out' && t.elapsed >= t.duration) {
      this.pipeTransit = null;
    }
    this.emitHud();
    return true;
  }

  caught(cat = null, cause = null) {
    if (this.state !== 'playing' || !this.mouse || this.mouse.hidden) return;
    this.caughtCount++;
    // Native death cues: normal catch = mouse_dies (77) + death_cloud (96);
    // lava/fire = death_fire (122). These are call-site ids, not runtime proof.
    // 'scroll' (boss entrance advance reaching the hero) is not a catcher, so it
    // only plays the death cry - no cloud, no trap sting.
    if (cause === 'lava' || cause === 'fire') audio.playSound(122);
    else { audio.playSound(77); if (cause !== 'trap' && cause !== 'scroll') audio.playSound(96); }
    this.emitHud();
    this.cancelStroke();
    this.mouse.clearPath();
    this.intro = null;
    this.death = { elapsed: 0, phase: 'fight', cat, cause, failNotified: false,
      x: cat ? (cat.x + this.mouse.x) / 2 : this.mouse.x,
      y: cat ? (cat.y + this.mouse.y) / 2 : this.mouse.y };
    this.state = "caught";
    // Boss attempt bookkeeping (no-op outside a boss arena).
    this.bossFlow?.onCaught?.(this);
  }

  // Native levelOver retry: reset the whole map and reopen the pinhole. The
  // fail frame stays on screen until the player chooses Retry.
  retryLevel() {
    this.death = null;
    this.resetLevel(true);
    this.state = "playing";
    this.intro = { elapsed: 0, hold: 0.2, reveal: 0.45, animation: 'idle1' };
    // A boss retry rebuilds the fight; hits only survive a resume, not a death.
    this.bossFlow?.onRetry?.(this);
  }

  resumeAfterCaught() {
    this.retryLevel();
  }

  // Native dossier pickup (prop 431, id table at 0x2af2dc): permanent
  // collectible, counted once, surfaced to the backpack via main.js.
  collectDossier(tag) {
    const id = Number(tag);
    if (!Number.isInteger(id) || id < 0 || id > 16 || this.dossiers.has(id)) return false;
    this.dossiers.add(id);
    this.onDossier?.(id);
    return true;
  }

  // Native trap disarm (0xa2400 -> 0xb3908): the bait cheese joins the carried
  // chain and scores. It is a bonus pickup, not a change to the exit gate
  // (cheeseLeft only counts ground cheeses).
  collectTrapCheese(trap) {
    if (!trap || trap.cheeseTaken) return;
    trap.cheeseTaken = true;
    const prop = 10; // wedge art (mouse_trap_cheesemask is the 64x84 wedge)
    this.cheeseCounts[prop] = (this.cheeseCounts[prop] || 0) + 1;
    this.carried.push({ prop, x: trap.x, y: trap.y, angle: 0 });
    this.pickupEffects.push({ x: trap.x, y: trap.y, elapsed: 0 });
    audio.playSound(110); // native pickup_food
    this.emitHud();
  }

  // Native win seam (parallel-M1): only an evidence-backed trigger may call
  // this. Future per-boss controllers call it after feeding their raw state.
  bossDefeated(boss) {
    return bossDefeated(this, boss, { explicit: true });
  }

  restart() {
    this.resetLevel(true);
    this.state = "playing";
    // Replaying a boss arena rebuilds the fight (fresh attempt, boss home).
    this.bossFlow?.onRetry?.(this);
  }

  // Native `autostart`: the entrance run hands over to the boss arena without a
  // results screen. A two-stage fade covers the map swap so the hero, camera
  // and HUD never show a half-loaded level.
  startBossTransition(targetId, { reason = 'arena', delay = 0 } = {}) {
    if (this.bossTransition) return false;
    const catalog = this.levelCatalog || [];
    const index = catalog.findIndex((level) => level && level.id === targetId);
    if (index < 0) return false;
    this.bossTransition = {
      elapsed: 0, duration: 1.15, delay, reason, targetId, index, loaded: false, fade: 0,
    };
    // Remember which half of the run the save is in before the swap.
    this.saveBossRun({ stage: reason === 'chain' ? 'arena' : 'arena' });
    this.state = 'boss_transition';
    this.inputLocked = true;
    this.cancelStroke();
    this.mouse.clearPath();
    this.mouse.moving = false;
    audio.playSound(140, { priority: 7 }); // ui_woosh
    return true;
  }

  updateBossTransition(dt) {
    const t = this.bossTransition;
    if (!t) return;
    t.elapsed += Math.max(0, dt);
    if (t.delay > 0) {
      t.delay -= dt;
      t.fade = 0;
      if (t.delay > 0) return;
    }
    const mid = t.duration * 0.5;
    t.fade = t.elapsed <= mid
      ? clamp(t.elapsed / mid, 0, 1)
      : clamp(1 - (t.elapsed - mid) / mid, 0, 1);
    if (!t.loaded && t.elapsed >= mid) {
      t.loaded = true;
      const def = this.levelCatalog[t.index];
      if (def) {
        this.loadLevel(def, t.index);
        this.state = 'boss_transition';
        this.inputLocked = true;
        this.updateCamera();
      }
    }
    if (t.elapsed >= t.duration) {
      this.bossTransition = null;
      this.state = 'playing';
      this.inputLocked = !!this.bossFlow?.inputLocked;
      this.bossFlow?.attach?.(this);
      this.emitHud();
    }
  }

  levelClear() {
    if (this.state !== 'playing') return;
    this.state = "levelclear";
    audio.playSound(70); // native 0x46 use_exit.sps
    // Native 0xB5CBC appends `_Win.sps` to the level music and starts it on
    // the 358/359 win seam. Keep the regular track if a win variant is absent.
    const winMusic = this.currentMusic ? (this.currentMusic.endsWith('_Win') ? this.currentMusic : `${this.currentMusic}_Win`) : 'CM_WinGame';
    audio.playMusic(winMusic, { loop: false, fade: 0.15 });
    // The level itself stays at normal scale. Only the hero (and carried
    // cheese chain) shrinks into the exit; the results overlay then masks the
    // screen with its scrolling background and pops the panel.
    const ex = this.level.exit;
    const tx = ex ? ex.x : this.mouse.x;
    const ty = ex ? ex.y : this.mouse.y;
    this.clearPresentation = {
      elapsed: 0,
      phase: 'enter',
      duration: CFG.game.clearEnterSeconds,
      x: tx,
      y: ty,
      startX: this.mouse.x,
      startY: this.mouse.y,
      scale: 1,
    };
    this.mouse.clearPath();
    this.mouse.moving = false;
    // The exit door gives the same entrance pop as a hole/portal.
    if (ex) this.pulseEntrance(ex, 'exit');
    this.lastSettlement = this.settle();
    this.score = this.lastSettlement.final;
    this.lastSettlement.goals = this.goalResults();
    this.emitHud();
  }

  // Minimal goal evaluation (parallel-K2: 3 goal slots per level, each a type
  // pair ANDed). Only the score/time types are trackable in the port today;
  // the other native types (paths, spotted, stolen, items, crumbs, shuriken)
  // are reported with pass=null until their counters exist.
  // Native goal evaluation (parallel-L1/K2/M2). Only types whose counter the
  // web can actually derive are evaluated; everything else returns
  // pass=null (unknown) instead of a guessed pass. The native combo_* goals
  // count combo OCCURRENCES (map536 combo_triple value=3), which the web's
  // single-settlement model cannot derive, so they stay unknown.
  goalResults() {
    const times = this.level ? this.level.times : null;
    const elapsed =
      times && times.start != null && this.timeLeft != null ? times.start - this.timeLeft : this.time;
    const evaluateGoal = (type, value) => {
      const v = Number(value);
      const stats = this.stats || {};
      if (type === "score") return { pass: this.score >= v, supported: true };
      if (type === "time") return { pass: elapsed <= v, supported: true };
      if (type === "paths") return { pass: stats.paths <= v, supported: true };
      if (type === "spotted") return { pass: stats.spotted === v, supported: true };
      if (type === "bump") return { pass: (stats.bump || 0) === v, supported: true };
      if (type === 'bucket') return { pass: (stats.items?.teacup || 0) <= v, supported: true };
      if(['chilli','balloon','teacup','fish','string','tv','switch','furniture'].includes(type))return {pass:(stats.items?.[type]||0)<=v,supported:true};
      if (type === "pipe") return { pass: stats.pipes <= v, supported: true };
      if (type === "mouse_hole") return { pass: stats.mouseHoles <= v, supported: true };
      if (type === "safe_hole") return { pass: (stats.safeHoles || 0) <= v, supported: true };
      if (type === "disarm_trap") return { pass: (stats.disarm_trap || 0) >= v, supported: true };
      if (type === "stolen") return { pass: (stats.stolen || 0) === 0, supported: true };
      if (type === "shuriken_cheese") return { pass: (stats.shurikenCheese || 0) >= v, supported: true };
      if (type === "dark_areas") return { pass: (stats.darkAreas || 0) <= v, supported: true };
      if (type === "all_crumbs") {
        if (!this.level || !Array.isArray(this.level.crumbs)) {
          return { pass: null, supported: false, reason: "crumbs-not-imported" };
        }
        const total=[...(this.floorLevels?.values()||[this.level])].reduce((n,floor)=>n+(floor.crumbs?.length||0),0);
        return { pass: (stats.crumbsTaken || 0) >= total, supported: true };
      }
      return { pass: null, supported: false };
    };
    const goals = (this.level && this.level.goals) || [];
    return goals.map((g) => {
      if (Array.isArray(g.type)) {
        const values = Array.isArray(g.value) ? g.value : [g.value];
        const subs = g.type.map((t, i) => ({
          type: t,
          value: values[i],
          ...evaluateGoal(t, values[i]),
        }));
        const supported = subs.every((s) => s.supported);
        return {
          type: g.type,
          value: g.value,
          pass: supported ? subs.every((s) => s.pass) : null,
          supported,
          sub: subs,
        };
      }
      const e = evaluateGoal(g.type, g.value);
      return { type: g.type, value: g.value, pass: e.pass, supported: e.supported };
    });
  }

  // Native scoring (parallel-J1): banked = floor(comboMult * sum(count[prop] *
  // weight[prop])), weights {6:50, 7:25, 8:20, 9:15, 10:10}; the final score
  // adds the remaining score-countdown points. Combo names follow the native
  // table (none 1, pair 2, three 3, twopair 4, four 4, fullhouse 5, five 6,
  // id6 7); the exact native detection order for id6 is unverified.
  settle() {
    const weights = { 6: 50, 7: 25, 8: 20, 9: 15, 10: 10 };
    let sum = 0;
    for (const [prop, n] of Object.entries(this.cheeseCounts)) sum += n * (weights[prop] || 0);
    const counts = Object.values(this.cheeseCounts).sort((a, b) => b - a);
    let combo = 1;
    let name = "none";
    if (counts.length >= 6) {
      combo = 7;
      name = "id6";
    } else if (counts[0] === 5) {
      combo = 6;
      name = "five";
    } else if (counts[0] >= 3 && counts[1] === 2) {
      combo = 5;
      name = "fullhouse";
    } else if (counts[0] === 4) {
      combo = 4;
      name = "four";
    } else if (counts[0] === 2 && counts[1] === 2) {
      combo = 4;
      name = "twopair";
    } else if (counts[0] === 3) {
      combo = 3;
      name = "three";
    } else if (counts[0] === 2) {
      combo = 2;
      name = "pair";
    }
    const banked = Math.floor(combo * sum);
    // Reward-room payout: the native exit_bonus_multiplier (2.0) is authored
    // but has an unreachable branch natively; the port applies it once after a
    // reward room is cleared (see src/bonus.js).
    const multiplier = Number.isFinite(this.bonusMultiplier) && this.bonusMultiplier > 0 ? this.bonusMultiplier : 1;
    const boosted = Math.floor(banked * multiplier);
    // Native score countdown: one point per 200ms, independent of the HUD.
    const start = this.level?.times?.start;
    const timeBonus = this.state === 'timeout' ? 0 : this.timeLeft != null ? Math.max(0, Math.floor(this.timeLeft))
      : Number.isFinite(start) ? Math.max(0, Math.floor(start) - Math.floor((this.time + 1e-9) / CFG.game.scoreCountdownSeconds)) : 0;
    return {
      banked: boosted,
      baseBanked: banked,
      bonusMultiplier: multiplier,
      combo,
      comboName: name,
      timeBonus,
      elapsed: this.time,
      final: boosted + timeBonus,
      cheese: { ...this.cheeseCounts },
    };
  }

  timeout() {
    // Native (parallel-K2): time-up settles the level with a zero time bonus.
    this.state = "timeout";
    this.lastSettlement = this.settle();
    this.score = this.lastSettlement.final;
    this.lastSettlement.goals = this.goalResults();
    this.emitHud();
    if (this.onLevelEnd)
      this.onLevelEnd({ type: "timeout", level: this.levelIndex, settlement: this.lastSettlement });
  }

  pause() {
    if (this.state === "playing") this.state = "paused";
  }
  resume() {
    if (this.state === "paused") this.state = "playing";
  }

  // ---- render ----------------------------------------------------------

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (!this.level) return;

    // Win transition: the level stays at normal scale. While the hero shrinks
    // into the exit (clearPresentation.phase==='enter'), drawMouse applies that
    // scale; after the clear event the DOM results background masks the canvas.
    const { scale, ox, oy } = this.cam;
    // Boss charge/crash impacts shake the world, never the DOM panel.
    const shake = this.bossFlow?.shakeOffset?.() || null;
    ctx.save();
    ctx.translate(ox + (shake?.x || 0), oy + (shake?.y || 0));
    ctx.scale(scale, scale);

    const u = this.level.world.cell;
    if (this.bgImg) {
      ctx.drawImage(this.bgImg, 0, 0, this.level.world.w, this.level.world.h);
    } else {
      this.drawTiles(ctx, u);
    }
    this.drawCatRoutes(ctx, u);
    this.drawCheeses(ctx, u);
    this.drawCrumbs(ctx, u);
    this.drawPipes(ctx, u);
    this.drawHoles(ctx, u);
    this.level.mechanisms.draw(this,ctx);
    drawCwmice(ctx, this.sprites, this.level, this.time, u, this.cwmousePresentationScale());
    this.drawExit(ctx, u);
    this.drawCracks(ctx, u);
    this.bonusPortal?.draw?.(ctx, this);
    this.drawPath(ctx, u);
    this.drawCats(ctx, u);
    this.drawBosses(ctx, u);
    this.bossFlow?.draw?.(ctx, this);
    this.drawCatIndicators(ctx, u);
    this.drawProjectiles(ctx, u);
    this.drawMouse(ctx, u);
    this.level.mechanisms.drawPlayer(this,ctx);
    if (this.death) this.drawFight(ctx);
    this.drawPickupEffects(ctx, u);
    this.drawFloats(ctx, u);

    ctx.restore();
    this.bossFlow?.drawBanner?.(ctx, this);
    this.bossFlow?.drawHud?.(ctx, this);
    if (this.bossTransition) {
      ctx.save();
      ctx.globalAlpha = clamp(this.bossTransition.fade || 0, 0, 1);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.restore();
    }
    if (this.death) this.drawCaughtMask(ctx);
    else if (this.intro) this.drawIntro(ctx);
  }

  drawFight(ctx) {
    const death = this.death;
    if (death.phase === 'fail') return;
    const frame = Math.floor(death.elapsed / CFG.game.fightFrameSeconds) % 6;
    this.sprites.frame(ctx, 'fight', frame, death.x, death.y, 64, 64);
  }

  drawCaughtMask(ctx) {
    const death = this.death;
    if (!death || death.phase === 'fight') return;
    const { caughtFightSeconds: fight, caughtCloseSeconds: close } = CFG.game;
    const centre = this.worldToScreen(death.x, death.y);
    if (death.phase === 'closing') {
      const reach = Math.max(Math.hypot(centre.x, centre.y), Math.hypot(this.cssW-centre.x, centre.y),
        Math.hypot(centre.x, this.cssH-centre.y), Math.hypot(this.cssW-centre.x, this.cssH-centre.y));
      const progress = clamp((death.elapsed - fight) / close, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      // Native PinholeManager case 2 (0xaf46c): cat_silhoutte over bg_death.
      const size = reach * 4.5 * (1 - eased);
      if (!this.sprites.catIris(ctx, centre.x, centre.y, size, this.cssW, this.cssH)) {
        ctx.save(); ctx.globalAlpha = progress;
        this.sprites.drawDeathBackground(ctx, this.cssW, this.cssH); ctx.restore();
      }
      return;
    }
    // phase 'fail': hold the full purple fail frame until Retry (native
    // levelOver scene sits on this background).
    this.sprites.drawDeathBackground(ctx, this.cssW, this.cssH);
  }

  drawIntro(ctx) {
    const intro = this.intro;
    const centre = this.worldToScreen(this.mouse.x, this.mouse.y);
    const progress = clamp((intro.elapsed - intro.hold) / intro.reveal, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const radius = 60 * this.cam.scale + Math.hypot(this.cssW, this.cssH) * eased;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(this.cssW, 0);
    ctx.lineTo(this.cssW, this.cssH); ctx.lineTo(0, this.cssH); ctx.closePath();
    ctx.moveTo(centre.x + radius, centre.y);
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.restore();
  }

  drawTiles(ctx, u) {
    const world = this.level.world;
    for (let y = 0; y < world.rows; y++) {
      for (let x = 0; x < world.cols; x++) {
        if (world.isWall(x, y)) continue;
        ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
        ctx.fillRect(x * u, y * u, u + 0.5, u + 0.5);
      }
    }
    for (let y = 0; y < world.rows; y++) {
      for (let x = 0; x < world.cols; x++) {
        if (!world.isWall(x, y)) continue;
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(x * u, y * u, u + 0.5, u + 0.5);
        if (!world.isWall(x, y - 1)) {
          ctx.fillStyle = COLORS.wallTop;
          ctx.fillRect(x * u, y * u, u + 0.5, u * 0.22);
        }
      }
    }
  }

  drawCatRoutes(ctx, u) {
    const active = !!this.stroke;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = u * 0.34;
    ctx.setLineDash([0.01, u * 1.45]);
    for (const c of this.level.cats) {
      if (!c.route || c.route.length < 2) continue;
      const color = '#f4b4a2';
      ctx.globalAlpha = active ? 0.9 : 0.68;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(c.route[0].x, c.route[0].y);
      for (let i = 1; i < c.route.length; i++) ctx.lineTo(c.route[i].x, c.route[i].y);
      if (c.routeMode === "loop") ctx.lineTo(c.route[0].x, c.route[0].y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (c.routeMode !== "loop") {
        const end = c.route[c.route.length - 1];
        ctx.beginPath();
        ctx.arc(end.x, end.y, u * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.setLineDash([0.01, u * 1.45]);
    }
    ctx.restore();
  }

  // Native cat visuals (parallel-N3): ordinary cats NEVER draw a vision cone.
  // Only the prop-53 bosscat art class draws one (radius 150, arc
  // cat_vision_arc, 5-degree steps, colour 0.89/0.16/0.16 @10%, no raycast).
  // Other cats use transient billboards: cat_peer/exclamation on spot,
  // cat_alert on chase, cat_angry when the player is lost.
  drawCatIndicators(ctx, u) {
    for (const c of this.level.cats) {
      if (this.death?.cat === c) continue;
      if (c.type === 3) {
        const r = 150;
        const half = CFG.cat.fov / 2;
        const step = (5 * Math.PI) / 180;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        for (let a = c.angle - half; a <= c.angle + half + 1e-6; a += step) {
          ctx.lineTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(227,41,41,0.1)";
        ctx.fill();
        ctx.restore();
      }
      let key = null;
      let fw = 32;
      let frame = 0;
      if (c.state === "spot") {
        key = c.ghost ? "ghostcat_exclamation" : "cat_peer";
        fw = c.ghost ? 14 : 32;
      } else if (c.state === "chase" || c.state === "pounceWait" || c.state === "pounceRun") {
        key = "cat_alert";
      } else if (c.state === "hypnotized") {
        // Native cat_stun swirl/stars above a TV-hypnotised cat.
        key = "cat_stun";
        frame = Math.floor(this.time * 8) % 2;
      } else if (c.state === "search" || c.state === "return") {
        key = "cat_angry";
        fw = 60;
      }
      if (!key) continue;
      const s = u * 2.2;
      const bob = Math.sin(this.time * 6) * u * 0.15;
      const width = s * (fw / 32);
      const scale = this.cam.scale;
      const x = clamp(c.x, (8 - this.cam.ox) / scale + width / 2,
        (this.cssW - 8 - this.cam.ox) / scale - width / 2);
      const y = Math.max(c.y - u * 1.7 - s / 2 - u * 0.25 + bob,
        (8 - this.cam.oy) / scale + s / 2);
      this.sprites.frame(ctx, key, frame, x, y, width, s);
    }
  }

  drawCheeses(ctx, u) {
    // Native factory 0x924b8 selects sprites/cheese0(11-prop).png for props
    // 6-10; each sheet is 16 coloured frames (parallel-J3). The old grey
    // cheese.png has 5 grey silhouettes and caused the grey/morphing look.
    // Ground cheese holds frame 0. Surface reflection is a separate masked
    // pass; cheesetrail_effect is reserved for the pickup event.
    for (const c of this.level.cheeses) {
      if (c.taken) continue;
      // Native LoadSheet scale 24.0 design units -> 48 world px cell.
      const s = u * CHEESE_SIZE_CELLS;
      const key = cheeseSheet(c.prop);
      this.sprites.frame(ctx, "shadow_generic", 0, c.x, c.y + u * 0.95, u * 2.2, u * 1.1);
      if (this.sprites.frame(ctx, key, 0, c.x, c.y, s, s)) {
        this.drawCheeseReflection(ctx, key, 0, c.x, c.y, s);
        continue;
      }
      const q = u * 1.1;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(0, q * 0.32, q * 0.34, q * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.cheese;
      ctx.beginPath();
      ctx.moveTo(-q * 0.36, q * 0.28);
      ctx.lineTo(q * 0.38, q * 0.28);
      ctx.lineTo(-q * 0.02, -q * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#c99a12";
      ctx.beginPath();
      ctx.arc(-q * 0.1, q * 0.16, q * 0.06, 0, Math.PI * 2);
      ctx.arc(q * 0.14, q * 0.14, q * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Native pipe pieces (parallel-N2): 200-203 pipe_d/r/u/l (1 frame),
  // 204-207 pipe_flipflap_d/r/u/l (3 frames), 64px centred at the vertex.
  drawCheeseReflection(ctx, key, frame, x, y, size) {
    // Native 0x93508 -> 0x9b384 has a separate surface-reflection pass
    // driven by a global horizontal sweep. Web timing/brightness are tuned.
    const sweepX = (this.time * 210) % (this.level.world.w + 160) - 80;
    this.sprites.cheeseReflection(ctx, key, frame, x, y, size, sweepX);
  }

  drawPickupEffects(ctx, u) {
    for (const effect of this.pickupEffects || []) {
      this.sprites.frame(ctx, 'cheesetrail_effect', Math.min(4, Math.floor(effect.elapsed / 75)),
        effect.x, effect.y + 0.8, u * 7.5, u * 5.625);
    }
  }

  drawPipes(ctx, u) {
    for (const p of this.level.pipePieces || []) {
      const dir = propDirection(p.prop) || p.dir || "d";
      const flip = p.prop >= 204;
      const key = flip ? `pipe_flipflap_${dir}` : `pipe_${dir}`;
      const frame = flip ? Math.floor(this.time * 5) % 3 : 0;
      const scale=this.entranceDrawScale(p,'pipe');this.drawEntranceGlow(ctx,p,p.x,p.y,u,scale,'pipe');
      if(!this.sprites.tintedFrame(ctx,key,frame,p.x,p.y,u*4*scale,u*4*scale,holeColour(p.tag)))this.sprites.frame(ctx,key,frame,p.x,p.y,u*4*scale,u*4*scale);
    }
  }

  drawHoles(ctx, u) {
    for (const h of this.level.hideables || []) {
      const dir = propDirection(h.prop) || h.dir || "d";
      const family=Math.abs(h.tag||0)%8===6?'munch_hole':'mouse_hole';
      const key=`${family}_${dir}`,x=h.ox??h.x,y=(h.oy??h.y)-u;
      const scale=this.entranceDrawScale(h);this.drawEntranceGlow(ctx,h,x,y,u,scale);
      if(!this.sprites.tintedFrame(ctx,key,0,x,y,u*4*scale,u*4*scale,holeColour(h.tag)))this.sprites.frame(ctx,key,0,x,y,u*4*scale,u*4*scale);
    }
  }

  entranceKey(entry,kind='hole'){return `${this.level.floor}:${kind}:${entry.id??`${entry.prop}:${entry.x}:${entry.y}`}`;}
  pulseEntrance(entry,kind='hole'){this.entrancePulses.set(this.entranceKey(entry,kind),this.time);}
  entranceDrawScale(entry,kind='hole'){
    const start=this.entrancePulses.get(this.entranceKey(entry,kind));
    return start==null?1:entranceScale(this.time-start);
  }
  drawEntranceGlow(ctx,entry,x,y,u,scale,kind='hole'){
    // Coloured portals: while hidden, every same-Tag hole glows in the native
    // tag colour, showing the possible emerge targets (0xdbbd4 tag scan).
    // Pipes glow in their group colour during/after the teleport.
    const active=kind==='hole'
      ? this.mouse.hidden&&this.mouse.furnitureId==null&&this.mouse.hiddenTag!=null
        &&Math.abs(entry.tag??0)===Math.abs(this.mouse.hiddenTag)&&Math.abs(entry.tag??0)%8!==6
      : this.pipeGlow&&Math.abs(entry.tag||0)===Math.abs(this.pipeGlow.tag)&&this.time-this.pipeGlow.time<1.0;
    if(!active)return;
    ctx.save();ctx.globalAlpha=.76+.12*Math.sin(this.time*5);
    const size=u*6*scale*(1+.07*Math.sin(this.time*4));
    const colour=holeColour(entry.tag||0);
    if(!this.sprites.tintedFrame(ctx,'flare',0,x,y,size,size,colour))this.sprites.frame(ctx,'flare',0,x,y,size,size);
    ctx.restore();
  }

  // Prop-260 crumbs (parallel-L1/N2): cheese_inf.png (32px cells).
  drawCrumbs(ctx, u) {
    if (!Array.isArray(this.level.crumbs)) return;
    for (const cr of this.level.crumbs) {
      if (cr.taken) continue;
      this.sprites.frame(ctx, "cheese_inf", cr.frame ?? 0, cr.x, cr.y, u * 2, u * 2);
    }
  }

  drawCracks(ctx, u) {
    const mouse = this.mouse;
    for (const crack of this.cracks || []) {
      if (crack.used || !mouse || this.bonusReturn) continue;
      const d = dist(mouse.x, mouse.y, crack.trigger.x, crack.trigger.y);
      if (d > u * 4) continue;
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, 0.35 + (1 - d / (u * 4)) * 0.5) * pulse;
      // Highlight the painted crack with a warm, jagged chalk line; no text.
      const x = crack.x, y = crack.y;
      ctx.strokeStyle = '#ffe7a6';
      ctx.lineWidth = u * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - u * 0.75, y - u * 1.15);
      ctx.lineTo(x - u * 0.35, y - u * 0.55);
      ctx.lineTo(x - u * 0.6, y - u * 0.2);
      ctx.lineTo(x - u * 0.15, y + u * 0.35);
      ctx.moveTo(x - u * 0.35, y - u * 0.55);
      ctx.lineTo(x + u * 0.45, y - u * 0.8);
      ctx.moveTo(x - u * 0.6, y - u * 0.2);
      ctx.lineTo(x - u * 1.05, y + u * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(crack.trigger.x, crack.trigger.y, u * (0.35 + 0.15 * pulse), 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd65a';
      ctx.lineWidth = u * 0.08;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawExit(ctx, u) {
    if (!this.level.exit) return;
    // Native exit states (parallel-O2): closed (state 0x26) = frame 0; open
    // (state 0x27, all cheese collected) = frames 1..3 at 100 ms then hold.
    const open = this.cheeseLeft === 0 && this.pendingMachineCheese===0;
    const ex = this.level.exit;
    const prop = ex.prop;
    // Exit sprite by prop (parallel-N2): 240/244 up, 241/245 left,
    // 242/246 down, 243/247 right; 64px centred at (ox, oy-16).
    // The sheet suffix names the WALL side (the rim), so the opening faces the
    // opposite way: _u rim on top (opens down), _l rim left (opens right),
    // _d rim bottom (opens up), _r rim right (opens left). Exit props mirror
    // holes 20-23: 240/244 open down -> _u, 241/245 open right -> _l,
    // 242/246 open up -> _d, 243/247 open left -> _r (parallel-N2 mapping).
    const dir = propDirection(prop) || "d";
    const key = `${prop >= 244 && prop <= 247 ? "key" : "home"}_mousehole_${dir}`;
    // The exit door pops when the hero enters, matching hole/portal feedback.
    // During the clear enter phase this.time is frozen, so drive the pop from
    // the clear presentation clock instead of the world clock.
    const clear = this.clearPresentation;
    const pop = clear?.phase === 'enter'
      ? entranceScale(clear.elapsed)
      : this.entranceDrawScale(ex, 'exit');
    const s = u * 4 * pop;
    const x = ex.ox != null ? ex.ox : ex.x;
    const y = (ex.oy != null ? ex.oy : ex.y) - u;
    ctx.save();
    ctx.translate(x, y);
    // closed -> frame 0; open -> frames 1..3 (100 ms) then hold frame 3.
    const frame = open ? Math.min(3, 1 + Math.floor(Math.max(0, this.time - (this.exitOpenTime ?? this.time)) * 10)) : 0;
    if (this.sprites.frame(ctx, key, frame, 0, 0, s, s)) {
      // Big arrow above the open door while arrowTimer > 0 (parallel-O2).
      if (open && this.arrowTimer > 0) {
        const bob = Math.sin(this.time * 5) * u * 0.5;
        this.sprites.frame(ctx, "arrow", 0, 0, -u * 3 + bob, u * 2.4, u * 2.6);
      }
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.arc(0, 0, u * 0.52 * pop, 0, Math.PI * 2);
    ctx.fillStyle = "#05080b";
    ctx.fill();
    ctx.lineWidth = u * 0.12 * pop;
    ctx.strokeStyle = open ? COLORS.path : "#3a4a5a";
    ctx.stroke();
    ctx.restore();
  }

  drawExitRing(ctx, u, radius) {
    const pulse = 0.9 + Math.sin(this.time * 5) * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, u * radius * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(143,240,228,0.55)";
    ctx.lineWidth = u * 0.09;
    ctx.stroke();
  }

  // Only the unwalked path is shown. Entrances and open exits use an arrow;
  // ordinary floor endpoints keep the dot.
  drawPath(ctx, u) {
    const p = this.mouse.path;
    if (!p || this.mouse.cursor >= p.length) return;
    const end = p[p.length - 1];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.mouse.x, this.mouse.y);
    for (let i = this.mouse.cursor; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
    ctx.strokeStyle = COLORS.path;
    ctx.lineWidth = u * 0.45;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.95;
    ctx.setLineDash([u * 1.15, u * 0.55]);
    ctx.stroke();
    ctx.setLineDash([]);
    // End marker: an arrow when snapped to a mouse hole, pipe or open exit;
    // otherwise a procedural ball. The native end-marker
    // asset is unverified (target_moving belongs to a boss target prop).
    const ex = this.level.exit;
    const snappedExit = !!(ex && this.cheeseLeft === 0 && this.pendingMachineCheese===0 && dist(end.x, end.y, ex.x, ex.y) < u * 0.25);
    const entrance=this.snapTarget(end);
    const snappedEntrance=entrance&&['hole','pipe'].includes(entrance.type)&&dist(end.x,end.y,entrance.x,entrance.y)<u*.25;
    if (snappedExit||snappedEntrance) {
      // A snapped end equals the target: atan2(target-end) is then atan2(0,0).
      // Follow the final nonzero route segment. Match the small filled blue
      // arrow on the original map10 tutorial line, not the gold door cue.
      const ang = this.exitPathAngle(end,entrance?.hole);
      ctx.save();
      ctx.translate(end.x, end.y);
      ctx.rotate(ang);
      ctx.fillStyle = COLORS.path;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-u * 0.7, -u * 0.58);
      ctx.lineTo(-u * 0.7, -u * 0.18);
      ctx.lineTo(-u * 1.25, -u * 0.18);
      ctx.lineTo(-u * 1.25, u * 0.18);
      ctx.lineTo(-u * 0.7, u * 0.18);
      ctx.lineTo(-u * 0.7, u * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = COLORS.path;
      ctx.beginPath();
      ctx.arc(end.x, end.y, u * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  exitPathAngle(end,entrance=null) {
    const path = this.mouse.path;
    for (let i = path.length - 2; i >= this.mouse.cursor; i--) {
      if (dist(path[i].x, path[i].y, end.x, end.y) > 1e-4) return Math.atan2(end.y - path[i].y, end.x - path[i].x);
    }
    if (dist(this.mouse.x, this.mouse.y, end.x, end.y) > 1e-4) return Math.atan2(end.y - this.mouse.y, end.x - this.mouse.x);
    const target=entrance||this.level.exit;if(!target)return this.mouse.angle||0;
    const mouth = mouthPosition({ ...target, x: 0, y: 0 }, 1);
    return Math.atan2(-mouth.y, -mouth.x);
  }

  drawCats(ctx, u) {
    for (const c of this.level.cats) {
      if (this.death?.cat === c) continue;
      const size = u * 3.4;
      const prefix = catPrefixFor(c, c.state);
      let drew = false;
      if (c.state === 'hypnotized') drew = this.sprites.catHypnotizedFrame(ctx, prefix, c, c.x, c.y, size, size, this.time);
      if (!drew) drew = !!c.rest && this.sprites.catRestFrame(ctx,c,c.x,c.y,size,size);
      if(!drew)drew = this.sprites.catFrame(ctx, prefix, c.state, c.anim, c.x, c.y, size, size, c.angle);
      if (!drew) drew = this.sprites.catFrame(ctx, "browncat", c.state, c.anim, c.x, c.y, size, size, c.angle);
      if (!drew) this.drawCatShape(ctx, u, c);
    }
  }

  // Boss placeholders: the native boss body art/placement is not decoded yet,
  // so a neutral marker keeps the lethal contact visible. Authored parts that
  // do have known sprites are drawn at their native anchors.
  drawBosses(ctx, u) {
    // A boss arena draws its own bodies (telegraph halo, crash state) in
    // src/boss-flow.js; the generic placeholder would double up on them.
    if (this.bossFlow?.kind === 'arena') return;
    const PART_ART = {
      282: 'boss4_reflector', 283: 'boss4_breakable',
      349: 'rope_post', 350: 'boss7_support', 366: 'target_moving',
      367: 'emitter_boss2', 372: 'boss1_oil',
    };
    for (const b of this.level.bosses || []) {
      if (b.defeated) continue;
      for (const part of b.parts || []) {
        const key = PART_ART[part.prop];
        if (!key) continue;
        const s = this.sprites.images[key];
        this.sprites.frame(ctx, key, 0, part.x, part.y, s?.fw || 64, s?.fh || 64);
      }
      const r = b.radius != null ? b.radius : u * 2.4;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#3a2a4a";
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#b98cff";
      ctx.lineWidth = u * 0.12;
      ctx.stroke();
      ctx.fillStyle = "#dfe6ee";
      ctx.font = `${u * 1.2}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(String(b.prop), b.x, b.y + u * 0.4);
      ctx.restore();
    }
  }

  drawProjectiles(ctx, u) {
    for (const p of this.projectiles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle || 0);
      if (p.type === 6) {
        ctx.strokeStyle = "#d7dde5";
        ctx.lineWidth = u * 0.1;
        ctx.beginPath();
        ctx.moveTo(-u * 0.22, 0);
        ctx.lineTo(u * 0.22, 0);
        ctx.moveTo(0, -u * 0.22);
        ctx.lineTo(0, u * 0.22);
        ctx.stroke();
        ctx.fillStyle = "#9aa4b2";
        ctx.beginPath();
        ctx.arc(0, 0, u * 0.09, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 9) {
        ctx.fillStyle = "#7bdc6a";
        ctx.beginPath();
        ctx.moveTo(u * 0.35, 0);
        ctx.lineTo(0, u * 0.13);
        ctx.lineTo(-u * 0.3, 0);
        ctx.lineTo(0, -u * 0.13);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = "#ff7a2f";
        ctx.beginPath();
        ctx.arc(0, 0, u * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.arc(-u * 0.06, -u * 0.06, u * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawCatShape(ctx, u, c) {    const r = c.radius * 1.05;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.5, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.cat;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d97520";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.15 * s, -r * 0.8);
      ctx.lineTo(r * 0.6 * s, -r * 1.3);
      ctx.lineTo(r * 0.75 * s, -r * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#1a1a1a";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(r * 0.65, -r * 0.28 * s, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Carried cheese trails behind the player (native player+0x190 chain,
  // parallel-O1). The native speed computation has NO carried-count penalty,
  // so no slowdown is applied here.
  drawCarried(ctx, u) {
    if (!this.carried || !this.carried.length) return;
    const size = u * CHEESE_SIZE_CELLS;
    for (const node of this.carried) {
      this.sprites.frame(ctx, cheeseSheet(node.prop), carriedCheeseFrame(node.angle), node.x, node.y, size, size);
      this.drawCheeseReflection(ctx, cheeseSheet(node.prop), carriedCheeseFrame(node.angle), node.x, node.y, size);
    }
  }

  mousePresentationScale() {
    let s = this.pipeTransitScale();
    // Squeezing through a wall crack: shrink against the wall before the
    // hidden level loads.
    if (this.crackEnter) {
      const p = clamp(this.crackEnter.elapsed / Math.max(1e-4, this.crackEnter.duration), 0, 1);
      s *= Math.max(0.06, 1 - 0.94 * p * p);
    }
    // Win: only the hero shrinks into the exit; the level keeps its scale.
    const clear = this.clearPresentation;
    if (clear) s *= clear.phase === 'enter' ? Math.max(0, clear.scale) : 0;
    // Level start/retry is normal size immediately; no spawn shrink/grow.
    // Hole exit: grow from small at the mouth (native hide_out feel).
    if (this.emergeGrow) {
      const p = clamp(this.emergeGrow.elapsed / Math.max(1e-4, this.emergeGrow.duration), 0, 1);
      s *= 0.15 + 0.85 * (1 - Math.pow(1 - p, 3));
    }
    return s;
  }

  cwmousePresentationScale() {
    // The cwmouse follows the hero into a hole/door/pipe and must shrink/hide
    // with him instead of staying at full size in the room.
    if (this.mouse?.hidden || this.death) return 0;
    let s = this.pipeTransitScale();
    if (this.crackEnter) {
      const p = clamp(this.crackEnter.elapsed / Math.max(1e-4, this.crackEnter.duration), 0, 1);
      s *= Math.max(0.06, 1 - 0.94 * p * p);
    }
    const clear = this.clearPresentation;
    if (clear) s *= clear.phase === 'enter' ? Math.max(0, clear.scale) : 0;
    if (this.emergeGrow) {
      const p = clamp(this.emergeGrow.elapsed / Math.max(1e-4, this.emergeGrow.duration), 0, 1);
      s *= 0.15 + 0.85 * (1 - Math.pow(1 - p, 3));
    }
    return s;
  }

  drawMouse(ctx, u) {
    // Native teleport (0xfda2c) scales the player into/out of the pipe mouth;
    // the carried chain is drawn inside the same transform. The win/exit and
    // hole-exit presentations reuse the same transform.
    const s = this.mousePresentationScale();
    if (s <= 0.01) return;
    if (Math.abs(s - 1) < 1e-4) return this.drawMouseBody(ctx, u);
    const m = this.mouse;
    ctx.save();
    ctx.translate(m.x, m.y - (m.lift || 0) / 2);
    ctx.scale(s, s);
    ctx.translate(-m.x, -(m.y - (m.lift || 0) / 2));
    this.drawMouseBody(ctx, u);
    ctx.restore();
  }

  drawMouseBody(ctx, u) {
    const m = this.mouse;
    if (m.hidden || this.death) return;
    this.drawCarried(ctx, u);
    // Idle: standing look-around animation (native player_lookaround);
    // moving: the 16-direction run strip.
    const y=m.y-(m.lift||0);
    if (this.intro && this.sprites.playerSequenceFrame(ctx, this.intro.animation, this.intro.elapsed * 1000, m.x, y, 74, 74, m.angle)) return;
    if (!m.moving && this.sprites.playerSequenceFrame(ctx, 'idle1', this.time * 1000, m.x, y, 74, 74, m.angle)) return;
    if (this.sprites.playerFrame(ctx, this.time, m.x, y - 12, 74, 74, m.angle)) return;
    const r = m.radius * 1.05;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.5, r * 1.1, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b9c3cd";
    ctx.lineWidth = u * 0.12;
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, 0);
    ctx.quadraticCurveTo(-r * 1.9, Math.sin(m.anim) * u * 0.4, -r * 2.3, u * 0.2);
    ctx.stroke();
    ctx.fillStyle = COLORS.mouse;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#aab4be";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(-r * 0.35, r * 0.7 * s, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#26313b";
    ctx.beginPath();
    ctx.arc(r * 0.65, 0, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFloats(ctx, u) {
    ctx.textAlign = "center";
    const base = u * 1.4;
    for (const f of this.floats) {
      ctx.save();
      ctx.globalAlpha = clamp(1 - f.t / 0.9, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = `${base}px sans-serif`;
      ctx.fillText(f.text, f.x, f.y - u * 1.2 - f.t * u * 1.5);
      ctx.restore();
    }
  }
}




