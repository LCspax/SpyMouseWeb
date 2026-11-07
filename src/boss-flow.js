/**
 * boss-flow.js - Boss level flow for the web port.
 *
 * Two authored halves (see src/boss-links.js for the level_data evidence):
 *
 *   1. ENTRANCE  map736/555/565/... mode="infinite": a 4-6 screen wide approach
 *      arena. The port plays it as a scroll run: the camera locks to the native
 *      960x640 viewport and ratchets forward with the white boss cat's
 *      horizontal motion (a vertical patrol leg stops the scroll), three sector
 *      banners mark the stage boundaries, and at the last sector the boss
 *      appears, roars and leaves (the map_events "boss_intro" beats are
 *      re-created without dialogue assets). Reaching the gate hands the run over
 *      to the arena map instead of opening the normal results screen - this is
 *      the native `autostart` link.
 *
 *   2. ARENA     map791/795/733/... mode="boss": closed exit door (prop 358),
 *      a boss body and its authored parts. The port plays the intro
 *      (slamEntrance / roar / closeExit), then a fight in which the boss charges
 *      at the hero: contact is lethal (native 0x80b8c), and a charge that runs
 *      into level geometry stuns the boss and counts one hit. Enough hits drive
 *      the native counter fields (levelPhase / hitCounter / collisionBits /
 *      slots) to their authored win values, so Boss.checkWin() and
 *      bossDefeated() stay the single win path.
 *
 * Everything a run needs to survive a pause -> level select -> reload is kept
 * in a plain `BossRun` object (see normaliseBossRun); main.js persists it.
 * WEB-COMPATIBLE parameters are marked in the comments; nothing here claims a
 * decoded native value for an undecoded behaviour.
 */

import { clamp, dist } from './math.js';
import { audio } from './audio.js';
import { Boss } from './boss.js';
import { CFG } from './config.js';
import {
  APPROACH_STAGES,
  BOSS_NAMES,
  arenaLink,
  bossKey,
  entranceLink,
} from './boss-links.js';

export const BOSS_RUN_VERSION = 1;

const SOUND = {
  agro: 8,
  hit: 9,
  die: 143,
  run: 6,
  slam: 148,
  crash: 27,
  waterDie: 162,
  ghostAgro: 153,
};

// Web-compatible pacing for the approach sequence.
const APPROACH = {
  revealSpeed: 520, // boss run-in speed (world px/s)
  revealDistance: 420, // how far from the gate the boss stops
  bannerSeconds: 2.2,
  // Forced advance (WEB-COMPATIBLE). The entrance is a chase, not a stroll: the
  // trailing edge of the view is lethal and never rewinds. It is NOT a constant
  // clock any more - the white boss cat (cat type 3 / prop 53 `bosscat`) drives
  // it with its own HORIZONTAL displacement. When the cat walks straight down a
  // corridor, dx is 0 and the camera stops; when it turns back, dx is negative
  // and the ratchet holds the edge. trailSpeedCells is the white cat's patrol
  // speed (3.75 cells/s * cell 16 = 60 world px/s); it is now only a per-frame
  // clamp and the fallback when a level has no white cat, never a timer.
  trailSpeedCells: CFG.cat.patrolCells, // cells/s -> world px/s with world.cell
  catStepSlack: 1.5, // cap one frame of cat dx to this multiple of the walk speed
  heroLead: 0.78, // how far the hero may get AHEAD of the edge (view widths)
  heroStart: 0.3, // where the hero starts relative to the edge (view widths)
  gateHold: 0.25, // the advance halts this far short of the gate (view widths)
};

// Web-compatible pacing for the arena fight.
const FIGHT = {
  idleSeconds: 1.25,
  telegraphSeconds: 0.9,
  chargeSpeed: 26, // cells per second, converted with world.cell
  chargeMinDistance: 220,
  crashSeconds: 1.15,
  stunSeconds: 0.9,
  recoverSpeed: 9,
  deathSeconds: 1.3,
  introSeconds: 2.6,
};

/**
 * Normalise a persisted boss run. Returns null for anything unusable so a
 * corrupt localStorage value can never wedge the game.
 */
export function normaliseBossRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const link = arenaLink(raw.arena) || entranceLink(raw.entrance);
  if (!link) return null;
  const stage = ['approach', 'arena', 'intro', 'fight', 'win', 'lose'].includes(raw.stage)
    ? raw.stage
    : 'approach';
  return {
    version: BOSS_RUN_VERSION,
    key: bossKey(link),
    world: link.world,
    num: link.num,
    entrance: link.entrance,
    arena: link.arena,
    stage,
    sector: clamp(Number(raw.sector) || 0, 0, APPROACH_STAGES.length - 1),
    hits: Math.max(0, Math.min(999, Number(raw.hits) || 0)),
    attempts: Math.max(1, Math.min(999, Number(raw.attempts) || 1)),
    clear: !!raw.clear,
    x: Number.isFinite(raw.x) ? raw.x : null,
    y: Number.isFinite(raw.y) ? raw.y : null,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

/** Build a fresh run for a link, keeping the attempts counter if resuming. */
export function newBossRun(link, options = {}) {
  const run = normaliseBossRun({
    arena: link.arena,
    entrance: link.entrance,
    stage: options.stage || 'approach',
    sector: options.sector || 0,
    hits: options.hits || 0,
    attempts: options.attempts || 1,
    x: options.x ?? null,
    y: options.y ?? null,
  });
  run.updatedAt = Date.now();
  return run;
}

function bossLabel(link, language = 'zh') {
  const name = BOSS_NAMES[link.num];
  return name ? (name[language] || name.en) : link.num;
}

function sectorLabel(index, language = 'zh') {
  const entry = APPROACH_STAGES[index] || APPROACH_STAGES[0];
  return entry.label[language] || entry.label.en;
}

// ---------------------------------------------------------------------------
// Approach: scroll advance, sector banners, boss appearance
// ---------------------------------------------------------------------------

class BossApproach {
  constructor(game, link, run) {
    this.kind = 'approach';
    this.link = link;
    this.cameraMode = 'scroll';
    this.sector = clamp(Number(run?.sector) || 0, 0, APPROACH_STAGES.length - 1);
    // Only the boss-appearance line ever shows text: the run itself has no
    // on-screen "sector" wording (user request), just the progress pips.
    this.banner = { text: '', t: 0 };
    // World x of the trailing edge of the forced advance: the left edge of the
    // view and the losing condition (see advance()).
    this.trail = null;
    // Last observed x of the white boss cat. The advance consumes the delta,
    // so a respawn / retry must re-arm it (see resetTrail / onRetry).
    this.catX = null;
    this.viewW = 960;
    this.cinematic = null;
    this.bossActor = null;
    this.revealed = false;
    this.shake = 0;
    this.handoff = false;
    this.gate = null;
    this.resume = run?.stage === 'approach' && (run.x != null || run.sector > 0) ? run : null;
  }

  /**
   * View width in world units for the current canvas size. Scroll levels fit the
   * whole map HEIGHT (see Game.updateCamera), so the horizontal extent is wider
   * than the native 960 px viewport whenever the screen is shorter than 2:3 -
   * the advance has to reason about the view it actually has, not the native one.
   */
  viewWidth(game) {
    return game.cssW / Math.max(1e-4, this.scaleFor(game));
  }

  /** Camera scale used by scroll levels: the full map height always fits. */
  scaleFor(game) {
    const world = game.level?.world;
    const pad = 8;
    const fitH = world ? (game.cssH - pad * 2) / world.h : 1;
    return Math.max(1e-4, Math.min(game.cssW / 960, fitH));
  }

  /**
   * The authored scroll driver: the one white boss cat (prop 53 / type 3,
   * `routeMode: "stop"`, `routeSource: "mbn-graph-walk"`) whose linesB route
   * walks the whole entrance map. Every entrance map authors exactly one.
   */
  scrollCat(game) {
    const cats = game.level?.cats || [];
    return cats.find((cat) => cat.type === 3) || null;
  }

  /** Put the trailing edge just behind the hero (fresh start or resume). */
  resetTrail(game, viewW = this.viewWidth(game)) {
    this.viewW = viewW;
    this.advanceDone = false;
    // Re-arm the cat delta here as well: resetLevel() repositions the cat at
    // its first waypoint, and consuming that jump as "camera motion" would
    // teleport the view on the first frame after a retry.
    this.catX = this.scrollCat(game)?.x ?? null;
    // updateCamera can run before the level's hero exists (loadLevel order), so
    // never assume a mouse here.
    const hero = game.mouse;
    this.trail = hero ? Math.max(0, hero.x - viewW * APPROACH.heroStart) : 0;
    return this.trail;
  }

  /** Called once the level is live: restore the saved checkpoint. */
  attach(game) {
    const run = this.resume;
    const world = game.level.world;
    if (run?.x != null && run.y != null) {
      const open = world.closestOpen(run.x, run.y, game.mouse.radius);
      game.mouse.x = open.x;
      game.mouse.y = open.y;
      game.mouse.clearPath();
    }
    this.resetTrail(game);
    if (this.sector >= APPROACH_STAGES.length - 1) {
      // Resume right before the gate: the boss appearance has already played.
      this.revealed = true;
      this.banner.t = 0;
    }
  }

  get inputLocked() {
    return !!this.cinematic;
  }

  step(game, dt) {
    this.update(dt, game);
  }

  /**
   * The advance owns the camera: its trailing edge is pinned to the left edge of
   * the view, so the only place the hero can be lost is off that edge.
   *
   * Vertically the camera is FIXED at the middle of the map: the scroll run is
   * horizontal, the whole floor height is on screen, and the hero moving between
   * lanes must not drag the view up and down.
   */
  cameraFocus(game, scale) {
    const viewW = game.cssW / Math.max(1e-4, scale);
    this.viewW = viewW;
    const midY = game.level.world.h / 2;
    if (this.cinematic) return { x: this.cinematic.focusX, y: midY };
    if (this.trail == null) this.resetTrail(game, viewW);
    return { x: this.trail + viewW / 2, y: midY };
  }

  shakeOffset() {
    if (this.shake <= 0) return null;
    const amp = Math.min(10, this.shake * 26);
    return { x: Math.sin(this.shake * 90) * amp, y: Math.cos(this.shake * 71) * amp * 0.6 };
  }

  /**
   * Move the trailing edge forward. Returns false once the hero has been left
   * behind it (the run is lost: the entrance is a chase, not a checkpoint walk).
   *
   * CAMERA / CAT COUPLING (user requirement): the edge is driven by the white
   * boss cat's horizontal displacement, not by elapsed time. A vertical leg of
   * its patrol route produces dx = 0, so the scroll stops until the cat turns
   * horizontal again; a chase/turn-back produces dx < 0 and the ratchet holds
   * the edge. That is what makes the camera read as "following the cat" instead
   * of a constant-speed conveyor.
   *
   * The edge is still a ratchet (no backtracking), and it drags the hero along
   * when they sprint, so running can never take the camera off them. The leash
   * is also the safety net for maps whose authored cat route stops short of the
   * gate (7-Boss, map816): the hero can pull the view the rest of the way.
   */
  advance(dt, game) {
    const world = game.level.world;
    const m = game.mouse;
    if (this.advanceDone) return true;
    const lead = m.x - this.viewW * APPROACH.heroLead;
    const speed = APPROACH.trailSpeedCells * world.cell;
    const cat = this.scrollCat(game);
    let step;
    if (cat) {
      const x = cat.x;
      if (this.catX == null) this.catX = x;
      const dx = x - this.catX;
      this.catX = x;
      // Only forward horizontal motion pushes the camera. Clamp one frame so a
      // reposition/teleport can never fling the view forward.
      step = clamp(dx, 0, speed * dt * APPROACH.catStepSlack);
    } else {
      // A level with no white cat (or a test that removed it) keeps the old
      // constant pace so the run can never dead-lock. No shipped entrance map
      // takes this branch.
      this.catX = null;
      step = speed * dt;
    }
    this.trail = Math.max(this.trail + step, lead, 0);
    // Halt short of the gate: the last stretch belongs to the boss reveal, and an
    // advance that has arrived no longer chases anyone.
    const gate = ((game.level.exit?.x ?? world.w) - this.viewW * APPROACH.gateHold);
    if (this.trail >= gate) {
      this.trail = Math.max(0, gate);
      this.advanceDone = true;
      return true;
    }
    // A hidden hero (inside a hole) cannot be seen by the advance; it catches
    // them when they come back out instead of killing them underground.
    if (!m.hidden && m.x < this.trail) {
      game.caught(null, 'scroll');
      return false;
    }
    return true;
  }

  update(dt, game) {
    this.shake = Math.max(0, this.shake - dt);
    if (this.banner.t > 0) this.banner.t = Math.max(0, this.banner.t - dt);
    if (this.cinematic) return this.updateCinematic(dt, game);
    if (this.handoff) return;
    if (this.trail == null) this.resetTrail(game);
    if (!this.advance(dt, game)) return;

    const world = game.level.world;
    // Sectors follow the advance, not the hero: they are the checkpoint anchors
    // and the boss-appearance trigger. They are NOT announced on screen any more
    // (user request) - the pips at the bottom already show the progress.
    const progress = clamp(this.trail / Math.max(1, world.w), 0, 1);
    let next = this.sector;
    while (next + 1 < APPROACH_STAGES.length && progress >= APPROACH_STAGES[next + 1].at) next++;
    if (next !== this.sector) {
      this.sector = next;
      this.saveCheckpoint(game);
      if (next === APPROACH_STAGES.length - 1) this.startReveal(game);
    }
  }

  startReveal(game) {
    const world = game.level.world;
    const gate = game.level.exit || { x: world.w - 120, y: game.mouse.y };
    const startX = Math.max(gate.x + APPROACH.revealDistance, world.w - 80);
    this.cinematic = {
      phase: 'runIn',
      t: 0,
      duration: 1.5,
      bossX: startX,
      bossY: gate.y,
      gateX: gate.x,
      gateY: gate.y,
      // Pan from where the camera already is, so the reveal never snaps: the
      // cinematic offsets the advance-centred camera instead of replacing it.
      focusX: this.cameraCentre(game),
      focusRate: 0.12,
    };
    this.bossActor = { x: startX, y: gate.y, phase: 'runIn', t: 0, dir: -1 };
    this.shake = 0.35;
    audio.playSound(SOUND.agro, { priority: 7 });
    audio.playSound(SOUND.run, { loop: true, priority: 4 });
  }

  /** Camera x the advance would use right now (its own centre). */
  cameraCentre(game) {
    const base = this.trail != null ? this.trail : (game.mouse?.x ?? 0);
    return base + this.viewW / 2;
  }

  updateCinematic(dt, game) {
    const c = this.cinematic;
    c.t += dt;
    const boss = this.bossActor;
    if (boss) boss.t += dt;
    // Pan towards the incoming boss by offsetting the advance-centred camera, so
    // the first and last cinematic frame are continuous with the scroll camera.
    const centre = this.cameraCentre(game);
    const pan = (amount) => { c.focusX = centre + (c.gateX - centre) * amount; };
    if (c.phase === 'runIn') {
      const p = clamp(c.t / c.duration, 0, 1);
      if (boss) {
        const stopX = c.gateX - APPROACH.revealDistance * 0.42;
        boss.x = c.bossX + (stopX - c.bossX) * p * p; // ease-in charge
        boss.y = c.bossY;
      }
      pan(Math.min(0.55, p * 0.6));
      this.shake = Math.max(this.shake, 0.22 * (1 - p * 0.4));
      if (p >= 1) {
        c.phase = 'roar';
        c.t = 0;
        c.duration = 0.85;
        if (boss) boss.phase = 'roar';
        this.shake = 0.55;
        audio.playSound(SOUND.agro, { priority: 7 });
        this.banner = { text: sectorLabel(APPROACH_STAGES.length - 1, game.language), t: 1.6 };
      }
    } else if (c.phase === 'roar') {
      if (boss) boss.x = c.gateX - APPROACH.revealDistance * 0.42 + Math.sin(c.t * 34) * 3;
      pan(0.55);
      if (c.t >= c.duration) {
        c.phase = 'exit';
        c.t = 0;
        c.duration = 0.55;
        if (boss) boss.phase = 'exit';
      }
    } else if (c.phase === 'exit') {
      const p = clamp(c.t / c.duration, 0, 1);
      if (boss) {
        boss.x -= p * 180;
        boss.y -= p * p * 90;
      }
      pan(0.55 * (1 - p));
      if (p >= 1) {
        audio.stopSound(SOUND.run);
        this.bossActor = null;
        this.cinematic = null;
        this.revealed = true;
        this.banner = { text: sectorLabel(APPROACH_STAGES.length - 1, game.language), t: 1.4 };
        this.saveCheckpoint(game);
      }
    }
  }

  /**
   * A failed run (or a manual restart) must re-arm the level: the trailing edge
   * kept the world position it died at, so a retry used to start with the hero
   * already behind it and lose again on the first frame. Reset every piece of
   * run state here - the advance, the reveal, the hand-off and the camera edge -
   * and let attach() restore the last checkpoint position.
   */
  onRetry(game) {
    this.cinematic = null;
    this.bossActor = null;
    this.gate = null;
    this.shake = 0;
    this.handoff = false;
    this.revealed = this.sector >= APPROACH_STAGES.length - 1;
    this.banner = { text: '', t: 0 };
    this.trail = null;
    game.mouse.clearPath();
    game.mouse.moving = false;
    this.attach(game);
  }

  saveCheckpoint(game) {
    game.saveBossRun?.({
      stage: 'approach',
      sector: this.sector,
      x: Math.round(game.mouse.x),
      y: Math.round(game.mouse.y),
      hits: 0,
    });
  }

  /** Reaching the gate hands the run to the arena map (native autostart). */
  interceptExit(game) {
    if (this.handoff) return true;
    // Never cut the boss appearance short: the gate only opens after the
    // reveal cinematic has finished.
    if (this.cinematic) return false;
    if (!game.level.mechanisms?.exitDoorReady && !this.atGate(game)) return false;
    this.handoff = true;
    audio.stopSound(SOUND.run);
    game.startBossTransition(this.link.arena, { reason: 'arena', delay: 0.35 });
    return true;
  }

  /**
   * The exit prop sits in the wall, so the hero can never stand on the exit
   * point itself - the walkable cell in front of the gate is the real "I am at
   * the door" position (same `closestOpen` snap the hero uses everywhere else).
   */
  gatePoint(game) {
    if (this.gate) return this.gate;
    const exit = game.level?.exit;
    if (!exit) return null;
    this.gate = game.level.world.closestOpen(exit.x, exit.y, game.mouse.radius);
    return this.gate;
  }

  atGate(game) {
    const exit = game.level.exit;
    if (!exit) return false;
    const cell = game.level.world.cell;
    if (dist(game.mouse.x, game.mouse.y, exit.x, exit.y) < cell * 0.9) return true;
    const gate = this.gatePoint(game);
    return !!gate && dist(game.mouse.x, game.mouse.y, gate.x, gate.y) < cell * 1.2;
  }

  draw(ctx, game) {
    const boss = this.bossActor;
    if (!boss) return;
    const u = game.level.world.cell;
    const r = u * 2.6;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.85, r * 1.15, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body: port placeholder for the undecoded boss art (same convention as
    // Game.drawBosses, scaled up for the approach reveal).
    const bob = Math.sin((boss.t || 0) * 12) * (boss.phase === 'runIn' ? u * 0.25 : u * 0.08);
    ctx.fillStyle = '#2a1b38';
    ctx.strokeStyle = '#b98cff';
    ctx.lineWidth = u * 0.14;
    ctx.beginPath();
    ctx.arc(0, -bob, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Eye glow
    const glow = 0.6 + 0.4 * Math.sin(game.time * 9);
    ctx.fillStyle = `rgba(255,72,72,${glow})`;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * r * 0.34, -bob - r * 0.18, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    // Legs
    ctx.strokeStyle = '#2a1b38';
    ctx.lineWidth = u * 0.3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.35, r * 0.75 - bob);
      ctx.lineTo(s * r * 0.35, r * 1.25 - bob);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBanner(ctx, game) {
    if (this.banner.t <= 0) return;
    const alpha = Math.min(1, this.banner.t / 0.5) * Math.min(1, (APPROACH.bannerSeconds - this.banner.t) / 0.25);
    drawBannerText(ctx, game, this.banner.text, alpha, this.sector >= APPROACH_STAGES.length - 1 ? '#ff9a5a' : '#ffe7a6');
  }

  drawHud(ctx, game) {
    // No danger band and no "keep up" label (user request): the advance is read
    // from the camera edge itself, and the run is lost by crossing it, not by a
    // HUD warning. Only the sector pips stay.
    // Sector progress: pips, filled as the advance moves.
    const u = Math.max(7, Math.round(game.cssH * 0.013));
    const total = APPROACH_STAGES.length;
    const x0 = game.cssW / 2 - (total * u * 1.8) / 2;
    const y0 = game.cssH - u * 3.2;
    ctx.save();
    for (let i = 0; i < total; i++) {
      const on = i <= this.sector;
      const px = x0 + i * u * 1.8;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(px, y0, u * 1.2, u * 0.7, u * 0.35);
      else ctx.rect(px, y0, u * 1.2, u * 0.7);
      ctx.fillStyle = on ? 'rgba(255,231,166,0.92)' : 'rgba(255,255,255,0.22)';
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Arena: intro, fight, win
// ---------------------------------------------------------------------------

class BossEncounter {
  constructor(boss, options = {}) {
    this.boss = boss;
    this.home = { x: boss.x, y: boss.y };
    this.required = Math.max(1, Number(options.required) || 6);
    this.hits = Math.max(0, Math.min(this.required, Number(options.hits) || 0));
    this.state = 'idle';
    this.t = 0;
    this.target = null;
    this.crashAt = null;
    this.hitApplied = false;
    this.dead = false;
    this.lastHitAt = -Infinity;
    boss.encounter = this;
    this.syncFields();
  }

  get progress() {
    return this.required ? this.hits / this.required : 0;
  }

  /**
   * Drive the native counter the level's win trigger reads, so the HUD and the
   * native fields agree. The value is capped BELOW the win threshold: the death
   * presentation and the explicit bossDefeated() seam own the actual win, which
   * keeps a single win path instead of two racing ones.
   */
  syncFields() {
    const boss = this.boss;
    const trigger = boss.trigger;
    if (!trigger) return;
    const below = Math.max(0, this.required - 1);
    if (trigger.kind === 'levelPhase') boss.levelPhase = Math.min(this.hits, trigger.phase - 1, below);
    else if (trigger.kind === 'fieldEquals') boss[trigger.field] = Math.min(this.hits, trigger.value - 1, below);
    // Boss.update() plays boss_robot_hit when the counter changes; the crash
    // already plays it, so absorb the duplicate by syncing its previous value.
    if ('_prevHitCounter' in boss) boss._prevHitCounter = boss.hitCounter;
  }

  update(dt, env) {
    if (this.dead) return false;
    const game = env.game;
    const boss = this.boss;
    const world = game?.level?.world;
    if (!world) return false;
    const u = world.cell;
    const mouse = env.mouse;
    this.t += dt;

    // Contact with a live boss is lethal in every phase (native 0x80b8c); the
    // arena keeps that rule so a bad charge always ends the attempt.
    if (this.state === 'idle' || this.state === 'telegraph' || this.state === 'charge') {
      if (boss.radius != null && mouse && !mouse.hidden) {
        const r = boss.radius + (Number.isFinite(mouse.radius) ? mouse.radius : 0);
        if ((mouse.x - boss.x) ** 2 + (mouse.y - boss.y) ** 2 < r * r && typeof env.caught === 'function') {
          env.caught(boss);
          return false;
        }
      }
    }

    if (this.state === 'idle') {
      if (this.t >= FIGHT.idleSeconds) {
        this.state = 'telegraph';
        this.t = 0;
        audio.playSound(boss.prop === 341 ? SOUND.ghostAgro : SOUND.agro, { priority: 5 });
      }
      return false;
    }

    if (this.state === 'telegraph') {
      if (this.t >= FIGHT.telegraphSeconds) {
        this.state = 'charge';
        this.t = 0;
        const target = mouse && !mouse.hidden ? mouse : this.home;
        this.target = { x: target.x, y: target.y };
        const d = dist(boss.x, boss.y, this.target.x, this.target.y);
        if (d < u * 2) this.target = { x: this.target.x + u * 4, y: this.target.y };
        audio.playSound(SOUND.run, { loop: true, priority: 4 });
      }
      return false;
    }

    if (this.state === 'charge') {
      const dx = this.target.x - boss.x;
      const dy = this.target.y - boss.y;
      const d = Math.hypot(dx, dy);
      const step = FIGHT.chargeSpeed * u * dt;
      if (d <= step + 1) {
        boss.x = this.target.x;
        boss.y = this.target.y;
        this.finishCharge(world, false);
        return false;
      }
      const nx = boss.x + (dx / d) * step;
      const ny = boss.y + (dy / d) * step;
      // The boss is much wider than the hero; probe with a slightly smaller
      // radius so it can enter doorways but still slams into walls.
      if (world.circleHitsWall(nx, ny, (boss.radius || u * 2.4) * 0.7)) {
        this.finishCharge(world, true);
        return false;
      }
      boss.x = nx;
      boss.y = ny;
      if (dist(boss.x, boss.y, this.home.x, this.home.y) > FIGHT.chargeMinDistance * 2.2) {
        this.finishCharge(world, false);
      }
      return false;
    }

    if (this.state === 'crash') {
      if (this.t >= FIGHT.crashSeconds) {
        this.state = 'recover';
        this.t = 0;
        if (this.hits >= this.required) this.startDeath();
      }
      return false;
    }

    if (this.state === 'recover') {
      const dx = this.home.x - boss.x;
      const dy = this.home.y - boss.y;
      const d = Math.hypot(dx, dy);
      const step = FIGHT.recoverSpeed * u * dt;
      if (d <= step + 1) {
        boss.x = this.home.x;
        boss.y = this.home.y;
        this.state = 'idle';
        this.t = 0;
      } else {
        boss.x += (dx / d) * step;
        boss.y += (dy / d) * step;
      }
      return false;
    }

    return false;
  }

  finishCharge(world, crashed) {
    audio.stopSound(SOUND.run);
    if (crashed) {
      this.state = 'crash';
      this.t = 0;
      this.hits = Math.min(this.required, this.hits + 1);
      this.syncFields();
      audio.playSound(SOUND.hit, { priority: 7 });
      audio.playSound(SOUND.crash, { priority: 4, volume: 0.6 });
      this.lastHitAt = 0;
      this.onHit?.(this);
    } else {
      this.state = 'recover';
      this.t = 0;
    }
  }

  startDeath() {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.t = 0;
    audio.stopSound(SOUND.run);
    audio.playSound(this.boss.prop === 304 ? SOUND.waterDie : SOUND.die, { priority: 8 });
  }
}

class BossArena {
  constructor(game, link, run) {
    this.kind = 'arena';
    this.link = link;
    this.cameraMode = 'follow';
    this.phase = 'intro';
    this.t = 0;
    this.shake = 0;
    this.encounters = [];
    this.run = run || null;
    this.attempt = Math.max(1, Number(run?.attempts) || 1);
    this.resumeHits = Math.max(0, Number(run?.hits) || 0);
    this.quickIntro = false;
    this.handoff = false;
    this.ensureBoss(game);
    // A saved run means the fight was already under way (a quit during the
    // intro, mid-fight or inside the win presentation): pick it back up instead
    // of replaying the entrance. 'win' resumes one hit short of the kill.
    this.begin(game, { resume: ['intro', 'fight', 'win'].includes(run?.stage) });
  }

  get inputLocked() {
    return this.phase === 'intro' || this.phase === 'win';
  }

  get boss() {
    return this.encounters[0]?.boss || null;
  }

  /** 4-Boss authors no boss body (prop 282/283 puzzle); give it one so the
   *  arena has a target. The native controller for 282/283 is undecoded. */
  ensureBoss(game) {
    if (game.level.bosses.length) return;
    const parts = game.level.bossParts || [];
    const anchor = parts.find((p) => p.prop === 283) || parts.find((p) => p.prop === 282) || null;
    const world = game.level.world;
    const body = new Boss({
      id: anchor?.id ?? null,
      prop: anchor?.prop ?? null,
      tag: anchor?.tag ?? 0,
      x: anchor?.x ?? world.w / 2,
      y: anchor?.y ?? world.h / 2,
      cell: world.cell,
      radius: world.cell * 2.2,
      map: String(game.level.id).replace(/^map/, ''),
      parts,
    });
    game.level.bosses.push(body);
  }

  begin(game, { resume = false } = {}) {
    const required = this.link.hits;
    this.encounters = game.level.bosses.map((boss, index) => new BossEncounter(boss, {
      required,
      // A resumed run keeps its hit count; a fresh attempt starts at zero.
      hits: resume && index === 0 ? Math.min(required - 1, this.resumeHits) : 0,
    }));
    for (const enc of this.encounters) enc.onHit = () => this.saveProgress(game);
    this.phase = resume || this.quickIntro ? 'fight' : 'intro';
    this.t = 0;
    this.introStep = 0;
    game.inputLocked = this.phase === 'intro';
  }

  /** Called once the arena level is live (Game.loadLevel). */
  attach(game) {
    game.inputLocked = this.phase === 'intro';
    // Persist only now: during the constructor Game.bossFlow is not assigned
    // yet, so a save there would carry the previous level's link.
    this.saveProgress(game, { force: true });
  }

  step(game, dt) {
    this.update(dt, game);
  }

  get totalHits() {
    return this.encounters.reduce((sum, enc) => sum + enc.hits, 0);
  }

  get required() {
    return (this.encounters[0]?.required || this.link.hits) * Math.max(1, this.encounters.length);
  }

  update(dt, game) {
    this.shake = Math.max(0, this.shake - dt);
    if (this.phase === 'intro') {
      this.t += dt;
      const p = this.t;
      if (this.introStep === 0) {
        this.introStep = 1;
        audio.playSound(SOUND.slam, { priority: 7 });
        this.shake = 0.5;
      }
      if (p > 0.75 && this.introStep === 1) {
        this.introStep = 2;
        audio.playSound(this.link.num === '6-Boss' ? SOUND.ghostAgro : SOUND.agro, { priority: 7 });
        this.shake = 0.4;
      }
      if (p >= FIGHT.introSeconds) {
        this.phase = 'fight';
        this.t = 0;
        game.inputLocked = false;
        this.saveProgress(game);
        for (const enc of this.encounters) {
          enc.state = 'idle';
          enc.t = 0;
        }
      }
      return;
    }
    if (this.phase !== 'fight') {
      this.t += dt;
      if (this.phase === 'win' && this.t >= FIGHT.deathSeconds) {
        this.phase = 'cleared';
        const boss = this.boss;
        if (boss && typeof game.bossDefeated === 'function') game.bossDefeated(boss);
      }
      return;
    }
    for (const enc of this.encounters) {
      if (enc.state === 'dead') continue;
      enc.update(dt, { mouse: game.mouse, game, caught: (b) => game.caught(b) });
      if (game.state !== 'playing') return;
    }
    if (this.encounters.every((enc) => enc.dead || enc.hits >= enc.required)) {
      this.startWin(game);
    }
  }

  startWin(game) {
    if (this.phase === 'win' || this.phase === 'cleared') return;
    for (const enc of this.encounters) if (!enc.dead) enc.startDeath();
    this.phase = 'win';
    this.t = 0;
    this.shake = 0.8;
    game.inputLocked = true;
    game.cancelStroke?.();
    game.mouse.clearPath();
    game.mouse.moving = false;
    this.saveProgress(game, { stage: 'win' });
  }

  /** Save the run so pausing, quitting or reloading never loses the fight. */
  saveProgress(game, patch = {}) {
    if (!game.saveBossRun) return;
    const { force, ...rest } = patch;
    if (game.state === 'caught' && !force) return;
    game.saveBossRun({
      stage: this.phase === 'intro' ? 'intro' : this.phase === 'fight' ? 'fight'
        : this.phase === 'win' || this.phase === 'cleared' ? 'win' : 'fight',
      hits: this.totalHits,
      attempts: this.attempt,
      arena: this.link.arena,
      entrance: this.link.entrance,
      ...rest,
    });
  }

  onCaught(game) {
    // Death ends the attempt: the next load starts a fresh fight, but the
    // attempt counter survives so the pause/HUD feedback stays truthful.
    this.attempt += 1;
    game.saveBossRun?.({ stage: 'lose', hits: 0, attempts: this.attempt, force: true });
  }

  onRetry(game) {
    this.quickIntro = this.attempt > 1;
    this.resumeHits = 0;
    // resetLevel() restores flags but not the transformed body position.
    for (const enc of this.encounters) {
      if (enc.boss && enc.home) {
        enc.boss.x = enc.home.x;
        enc.boss.y = enc.home.y;
        enc.boss.dead = false;
        enc.boss.defeated = false;
      }
    }
    this.begin(game, { resume: false });
  }

  draw(ctx, game) {
    for (const enc of this.encounters) {
      const boss = enc.boss;
      if (enc.state === 'dead') continue;
      const u = game.level.world.cell;
      const r = boss.radius || u * 2.4;
      const charging = enc.state === 'charge';
      const telegraph = enc.state === 'telegraph';
      const crashed = enc.state === 'crash';
      ctx.save();
      ctx.translate(boss.x, boss.y);
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.9, r * 1.1, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      // Telegraph/charge tell: a red halo the player can read.
      if (telegraph || charging) {
        const pulse = 0.45 + 0.35 * Math.sin(game.time * 18);
        ctx.strokeStyle = crashed ? '#ffd166' : `rgba(255,72,72,${pulse})`;
        ctx.lineWidth = u * (telegraph ? 0.3 : 0.18);
        ctx.beginPath();
        ctx.arc(0, 0, r * (1.12 + (telegraph ? 0.12 * Math.sin(game.time * 12) : 0)), 0, Math.PI * 2);
        ctx.stroke();
      }
      const body = crashed ? '#4a2a2a' : enc.state === 'recover' ? '#33253f' : '#3a2a4a';
      ctx.fillStyle = body;
      ctx.strokeStyle = crashed ? '#ffb86b' : '#b98cff';
      ctx.lineWidth = u * 0.14;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Eyes
      const eye = crashed ? '#ffd166' : `rgba(255,90,90,${0.55 + 0.45 * Math.sin(game.time * 8)})`;
      ctx.fillStyle = eye;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.3, -r * 0.16, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawHud(ctx, game) {
    if (this.phase === 'intro' && this.t < 0.4) return;
    const enc = this.encounters[0];
    if (!enc) return;
    const lang = game.language === 'en' ? 'en' : 'zh';
    const barW = Math.min(360, game.cssW * 0.52);
    const barH = Math.max(10, Math.round(game.cssH * 0.016));
    const x = (game.cssW - barW) / 2;
    const y = Math.max(18, game.cssH * 0.045);
    const ratio = clamp(1 - enc.progress, 0, 1);
    ctx.save();
    // Name
    ctx.font = `${Math.round(barH * 1.25)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(bossLabel(this.link, lang), game.cssW / 2, y - barH * 0.55);
    // Track
    ctx.fillStyle = 'rgba(10,14,20,0.72)';
    ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x, y, barW, barH);
    // Fill
    const grad = ctx.createLinearGradient?.(x, y, x + barW, y);
    if (grad && typeof grad.addColorStop === 'function') {
      grad.addColorStop(0, '#ff5a5a');
      grad.addColorStop(1, '#ffb347');
      ctx.fillStyle = grad;
    } else ctx.fillStyle = '#ff6a5a';
    ctx.fillRect(x, y, barW * ratio, barH);
    // Hit pips
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < enc.required; i++) {
      const px = x + (barW / enc.required) * i;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + barH);
      ctx.stroke();
    }
    // Attempts
    if (this.attempt > 1) {
      ctx.font = `${Math.round(barH * 0.95)}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.fillText(
        lang === 'en' ? `Attempt ${this.attempt}` : `第 ${this.attempt} 次挑战`,
        game.cssW / 2,
        y + barH * 2.1,
      );
    }
    ctx.restore();
  }

  drawBanner(ctx, game) {
    if (this.phase !== 'intro') return;
    const lang = game.language === 'en' ? 'en' : 'zh';
    const text = lang === 'en' ? 'BOSS FIGHT' : 'Boss 战';
    const alpha = clamp(this.t / 0.3, 0, 1) * clamp((FIGHT.introSeconds - this.t) / 0.4, 0, 1);
    drawBannerText(ctx, game, text, alpha, '#ff9a5a');
  }
}

// ---------------------------------------------------------------------------
// Shared helpers + factory
// ---------------------------------------------------------------------------

function drawBannerText(ctx, game, text, alpha, colour = '#ffe7a6') {
  if (!(alpha > 0.01) || !text) return;
  const h = Math.max(14, Math.round(game.cssH * 0.038));
  ctx.save();
  ctx.globalAlpha = alpha;
  const y = game.cssH * 0.2;
  ctx.font = `bold ${h}px sans-serif`;
  const measured = typeof ctx.measureText === 'function' ? ctx.measureText(text).width : 0;
  const width = Math.min(game.cssW * 0.72, measured) + h * 2;
  ctx.fillStyle = 'rgba(8,11,16,0.55)';
  ctx.fillRect((game.cssW - width) / 2, y - h * 1.4, width, h * 2.2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(text, game.cssW / 2, y - h * 0.3);
  ctx.restore();
}

/**
 * Create the flow for a level, or null when the level is not part of a boss
 * run. `run` is the persisted BossRun (null for a fresh start).
 */
export function createBossFlow(game, def, run = null) {
  const arena = arenaLink(def.id);
  if (arena) return new BossArena(game, arena, run && run.arena === def.id ? run : null);
  const entrance = entranceLink(def.id);
  if (entrance) {
    const usable = run && run.entrance === def.id ? run : null;
    return new BossApproach(game, entrance, usable);
  }
  return null;
}

export { BossApproach, BossArena, BossEncounter };
export { bossLabel, sectorLabel };
