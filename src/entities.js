import { CFG } from "./config.js";
import {updateCatRest} from './cat-rest.js';
import { audio } from './audio.js';

// Native cat sound ids (analysis/rea/audio/sound-map.json):
//   18 cat_agro_brown, 19 cat_agro_black, 20 cat_agro_ghost, 21 cat_agro_fire,
//   22 cat_agro_ninja, 23 cat_agro_thief, 24 cat_agro_jungle,
//   25 cat_aim, 26 cat_charge, 27 cat_crash, 28 cat_eat, 29 cat_purr_loop,
//   30 cat_purr_end, 31 cat_steal, 32 cat_string, 33 cat_trance,
//   90 cat_dizzy, 91 cat_lost.
// Web cat.type indexes CAT_PREFIX in sprites.js:
//   0 brown, 1 orange, 2 black, 3 boss, 4 blind, 5 ghost_slow, 6 ghost_fast,
//   7 ninja, 8 lava, 9 jungle.  Types 1/3/4 have no native agro variant.
const CAT_AGRO_ID = Object.freeze({
  0: 18, // brown
  2: 19, // black
  5: 20, // ghost (slow)
  6: 20, // ghost (fast)
  7: 22, // ninja
  8: 21, // lava/fire
  9: 24, // jungle
});


// --- shared movement helpers ---------------------------------------------

// Follow an explicit polyline (used by the mouse). Stops at the first wall
// because the drawn route is expected to be wall-free.
export function followPath(ent, path, cursor, speed, dt, world, radius) {
  let remaining = speed * dt;
  let guard = 0;
  while (remaining > 1e-6 && cursor < path.length && guard++ < 128) {
    const tgt = path[cursor];
    const dx = tgt.x - ent.x;
    const dy = tgt.y - ent.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      cursor++;
      continue;
    }
    if (d <= remaining) {
      if (!world.lineClear(ent.x, ent.y, tgt.x, tgt.y)) return { cursor, blocked: true, angle: ent.angle };
      ent.x = tgt.x;
      ent.y = tgt.y;
      cursor++;
      remaining -= d;
      ent.angle = Math.atan2(dy, dx);
    } else {
      const nx = ent.x + (dx / d) * remaining;
      const ny = ent.y + (dy / d) * remaining;
      if (world.circleHitsWall(nx, ny, radius)) {
        const safe = lastClear(ent.x, ent.y, nx, ny, world, radius);
        ent.x = safe.x;
        ent.y = safe.y;
        ent.angle = Math.atan2(dy, dx);
        return { cursor, blocked: true, angle: ent.angle };
      }
      ent.x = nx;
      ent.y = ny;
      ent.angle = Math.atan2(dy, dx);
      remaining = 0;
    }
  }
  return { cursor, blocked: false, angle: ent.angle };
}

// Slide along walls instead of jamming: if the diagonal step is blocked, try
// moving on each axis independently.
export function slideAlong(ent, path, cursor, speed, dt, world, radius) {
  let remaining = speed * dt;
  let guard = 0;
  while (remaining > 1e-6 && cursor < path.length && guard++ < 128) {
    const tgt = path[cursor];
    const dx = tgt.x - ent.x;
    const dy = tgt.y - ent.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      cursor++;
      continue;
    }
    const desired = Math.atan2(dy, dx);
    if (ent.turnGain) {
      // Native turning (parallel-K1, brain 0x8a46c-0x8a57c): per-frame
      // proportional lerp facing += clamp((K/pi)*wrap(target-facing), +-|wrap|)
      // with K = cat_turn_speed (recovered default 1.0). Applied per 60 Hz
      // frame so variable-dt web frames keep the native cadence.
      const wrap = Math.atan2(Math.sin(desired - ent.angle), Math.cos(desired - ent.angle));
      const frames = dt * 60;
      const step = Math.max(
        -Math.abs(wrap),
        Math.min(Math.abs(wrap), (ent.turnGain / Math.PI) * wrap * frames)
      );
      ent.angle = Math.atan2(Math.sin(ent.angle + step), Math.cos(ent.angle + step));
    } else {
      ent.angle = desired;
    }
    if (d <= remaining) {
      if (world.circleHitsWall(tgt.x, tgt.y, radius)) {
        // Do not teleport into geometry: slide as far as possible instead.
        const nx = ent.x + (dx / d) * remaining;
        const ny = ent.y + (dy / d) * remaining;
        let moved = false;
        if (!world.circleHitsWall(nx, ent.y, radius)) { ent.x = nx; moved = true; }
        if (!world.circleHitsWall(ent.x, ny, radius)) { ent.y = ny; moved = true; }
        cursor++;
        remaining = 0;
        if (!moved) return { cursor, angle: ent.angle, stuck: true };
        continue;
      }
      ent.x = tgt.x;
      ent.y = tgt.y;
      cursor++;
      remaining -= d;
      continue;
    }
    const nx = ent.x + (dx / d) * remaining;
    const ny = ent.y + (dy / d) * remaining;
    if (!world.circleHitsWall(nx, ny, radius)) {
      ent.x = nx;
      ent.y = ny;
      remaining = 0;
      continue;
    }
    let moved = false;
    if (!world.circleHitsWall(nx, ent.y, radius)) {
      ent.x = nx;
      moved = true;
    }
    if (!world.circleHitsWall(ent.x, ny, radius)) {
      ent.y = ny;
      moved = true;
    }
    remaining = 0;
    if (!moved) return { cursor, angle: ent.angle, stuck: true };
  }
  return { cursor, angle: ent.angle };
}

function lastClear(x0, y0, x1, y1, world, radius) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const m = (lo + hi) / 2;
    if (world.circleHitsWall(x0 + (x1 - x0) * m, y0 + (y1 - y0) * m, radius)) hi = m;
    else lo = m;
  }
  return { x: x0 + (x1 - x0) * lo, y: y0 + (y1 - y0) * lo };
}

// --- mouse ----------------------------------------------------------------

export class Mouse {
  constructor(x, y, angle, world) {
    const c = world ? world.cell : 1;
    this.cell = c;
    this.x = x;
    this.y = y;
    this.angle = angle || 0;
    this.radius = CFG.mouse.radiusCells * c;
    this.speed = CFG.mouse.speedCells * c;
    this.path = [];
    this.cursor = 0;
    this.moving = false;
    this.anim = 0;
    this.stuckTimer = 0;
    this.hidden = false;
    this.hiddenTag = null;
  }

  setPath(points) {
    this.path = [{ x: this.x, y: this.y }, ...points];
    this.cursor = 1;
    this.moving = true;
  }

  clearPath() {
    this.path = [];
    this.cursor = 0;
    this.moving = false;
  }

  update(dt, world) {
    if (this.cursor >= this.path.length) {
      this.moving = false;
      this.anim += dt * 0.4;
      return;
    }
    const bx = this.x, by = this.y;
    const r = slideAlong(this, this.path, this.cursor, this.speed, dt, world, this.radius);
    this.cursor = r.cursor;
    const moved = Math.hypot(this.x - bx, this.y - by);
    this.anim += moved > 1e-4 ? dt * 10 : dt * 2;
    this.moving = moved > 1e-4;
    if (this.moving) {
      this.angle = Math.atan2(this.y - by, this.x - bx);
      this.stuckTimer = 0;
    } else {
      this.stuckTimer += dt;
      // Drop a waypoint that cannot be reached instead of freezing forever.
      if (this.stuckTimer > 0.2 && this.cursor < this.path.length) {
        this.cursor++;
        this.stuckTimer = 0;
      }
    }
  }
}

// --- cat ------------------------------------------------------------------

export class Cat {
  constructor(x, y, route, angle, world, type = 0, routeMode = "pingpong") {
    const c = world ? world.cell : 1;
    this.cell = c;
    this.x = x;
    this.y = y;
    this.type = type | 0;
    this.angle = angle || 0;
    this.homeAngle = this.angle;
    this.radius = CFG.cat.radiusCells * c;
    this.range = CFG.cat.rangeCells * c;
    this.catchDist = this.radius;
    const chaseMult = CFG.cat.typeChaseSpeed[this.type] ?? 1;
    const patrolMult = CFG.cat.typePatrolSpeed[this.type] ?? chaseMult;
    this.patrolSpeed = CFG.cat.patrolCells * c * patrolMult;
    this.chaseSpeed = CFG.cat.chaseCells * c * chaseMult;
    this.route = route && route.length ? route : [{ x, y }];
    this.routeIndex = this.route.length > 1 ? 1 : 0;
    this.routeDir = 1;
    this.routeMode = routeMode;
    this.state = "patrol";
    // Audio state (native ids: 0x25 cat_aim, 0x1B cat_crash, 0x1D cat_purr_loop,
    // 0x1E cat_purr_end, 0x5A cat_dizzy, 0x5B cat_lost). cat_eat(0x1C),
    // cat_steal(0x1F), cat_string(0x20) and cat_trance(0x21) have no web
    // behaviour yet, so they are intentionally not cued.
    this._audioKey = "cat" + (Cat._audioSeq = (Cat._audioSeq || 0) + 1);
    this._stunCue = false;
    this._wasResting = false;
    this.seeTimer = 0;
    this.loseTimer = 0;
    this.lastSeen = null;
    this.searchTimer = 0;
    this.returnIndex = null;
    this.anim = 0;
    this.ghost = this.type === 5;
    this.rest = null;
    this.blind = this.type === 4;
    this.intercept = true;
    this.endpointTimer = 0;
    this.waypointTimer = 0;
    this.stopped = false;
    // Native turning (parallel-K1): per-frame proportional lerp with
    // K = stateReturn * cat_turn_speed = patrol_speed(0.5) * AI(1.0) * 1.0.
    // A runtime settings.cfg could override the factors - unverified.
    this.turnGain = CFG.cat.turnGain;

    // navigation
    this.navPath = null;
    this.cursor = 0;
    this.navGoal = null;
    this.repathTimer = 0;
    this.navInvalidated = false;
    this.stuckTimer = 0;

    this.pounceTimer = 0;
    this.pounceCooldown = 0;
    this.pounceTarget = null;
    this.stunTimer = 0;
    this.ranged = this.type === 6 || this.type === 7 || this.type === 9 || this.type === 10;
    this.attackCooldown = 0;
    this.attackTimer = 0;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.attackTarget = null;
    this.projectileSpeed =
      (this.type === 10 ? 187 : this.type === 7 ? 96 : 150) * 0.125 * c;
    this.burstCount = this.type === 6 ? 3 : 1;
    this.burstInterval = 0.25;
    this.attackCooldownTime = this.type === 7 ? 1.3 : 0.6;
  }

  canSeeMouse(mouse, world) {
    if (!mouse || mouse.hidden || mouse.disguised || this.distraction) return false;
    const dx = mouse.x - this.x;
    const dy = mouse.y - this.y;
    const d = Math.hypot(dx, dy);
    if (this.blind) {
      const speed = Math.hypot(mouse.vx || 0, mouse.vy || 0);
      return d <= this.cell * 8 && speed > this.cell * 1.5;
    }
    if (d > this.range) return false;
    if (!this.ghost && !world.lineClear(this.x, this.y, mouse.x, mouse.y)) return false;
    const a = Math.atan2(dy, dx);
    const diff = Math.abs(((a - this.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    return diff <= CFG.cat.fov / 2;
  }

  finishPounce(hitWall = false) {
    this.state = hitWall ? "stunned" : this.lastSeen ? "chase" : "return";
    if (hitWall) {
      audio.playSound(27); // cat_crash - native 0x85534 (cat hits a wall while pouncing)
      this._stunCue = true;
    }
    this.stunTimer = hitWall ? CFG.cat.pounceStun : 0;
    this.stopped = false;
    this.pounceTimer = 0;
    this.pounceCooldown = CFG.cat.pounceCooldown;
    this.pounceTarget = null;
    this.navPath = null;
    this.navGoal = null;
    this.cursor = 0;
    this.repathTimer = 0;
    this.navInvalidated = true;
  }

  update(dt, world, mouse, projectiles = null) {
    const x = this.x, y = this.y;
    if(this.distraction){
      const target=this.distraction;target.left-=dt;this.anim+=dt;
      const near=Math.hypot(this.x-target.x,this.y-target.y)<=this.cell*1.2;
      if(target.kind==='tv'&&near){
        // Hypnotised: sit still and watch the screen until the effect ends.
        if(this.state!=='hypnotized')audio.playSound(33); // cat_trance (native 0x83934)
        this.state='hypnotized';this.navPath=null;this.navGoal=null;this.path=null;
      }else{
        this.state='distracted';
        if(!near)this.navigate(dt,world,target,this.patrolSpeed,.4);
      }
      if(target.left<=0){this.distraction=null;this.state='return';this.navPath=null;this.navGoal=null;this.repathTimer=0;}
    }else this.updateAI(dt, world, mouse, projectiles);
    const dx = this.x - x, dy = this.y - y;
    this.moving = Math.hypot(dx, dy) > 1e-5;
    // Wall sliding may move on a different axis than the requested target.
    // Use actual displacement for both facing art and next-frame vision.
    if (this.moving) this.angle = Math.atan2(dy, dx);
    updateCatRest(this,dt);
    // Sleeping patrol pause: native cat_purr_loop (0x1D) while resting, then
    // cat_purr_end (0x1E) on wake (native loop setter 0xA76E0 analogue).
    const resting = !!(this.rest && this.rest.phase === "sleep");
    if (resting && !this._wasResting) {
      audio.setObjectLoop(this._audioKey, 29);
    } else if (!resting && this._wasResting) {
      audio.setObjectLoop(this._audioKey, null);
      audio.playSound(30);
    }
    this._wasResting = resting;
  }

  updateAI(dt, world, mouse, projectiles = null) {
    // Seconds, passed unchanged to Sprites.catFrame (native 200 ms frames).
    // Do not multiply this clock by a state speed and then multiply by FPS.
    this.anim += dt;
    // Direct callers may pass a hidden mouse; treat it like no target.
    if (mouse?.hidden) mouse = null;
    if (this.state === "stunned") {
      if (!this._stunCue) {
        audio.playSound(90); // cat_dizzy - stun that did not come from a wall crash
        this._stunCue = true;
      }
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) {
        this.stopped = false;
        this.state = "return";
        this._stunCue = false;
        this.spotTimer = 0;
        this.seeTimer = 0;
        this.loseTimer = 0;
        this.navPath = null;
        this.navGoal = null;
        this.repathTimer = 0;
        this.navInvalidated = true;
      }
      return;
    }

    this.pounceCooldown = Math.max(0, this.pounceCooldown - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (this.state === "attackWindup") {
      this.attackTimer -= dt;
      if (mouse && this.canSeeMouse(mouse, world)) this.attackTarget = { x: mouse.x, y: mouse.y };
      if (this.attackTarget) this.angle = Math.atan2(this.attackTarget.y - this.y, this.attackTarget.x - this.x);
      if (this.attackTimer <= 0) {
        this.state = "attackThrow";
        audio.playSound(26); // cat_charge - native 0x8520C
        this.burstLeft = this.burstCount;
        this.burstTimer = 0;
      }
      return;
    }

    if (this.state === "attackThrow") {
      this.burstTimer -= dt;
      if (this.burstLeft > 0 && this.burstTimer <= 0) {
        if (projectiles && this.attackTarget) {
          const target = this.attackTarget;
          projectiles.push({
            x: this.x,
            y: this.y,
            tx: target.x,
            ty: target.y,
            angle: Math.atan2(target.y - this.y, target.x - this.x),
            speed: this.projectileSpeed,
            life: 2.4,
            radius: this.cell * 0.35,
            type: this.type,
          });
        }
        this.burstLeft--;
        this.burstTimer = this.burstInterval;
      }
      if (this.burstLeft <= 0 && this.burstTimer <= 0) {
        this.attackCooldown = this.attackCooldownTime;
        this.stopped = false;
        this.state = "chase";
      }
      return;
    }

    if (this.state === "pounceWait") {
      this.pounceTimer -= dt;
      if (this.pounceTarget) {
        this.angle = Math.atan2(this.pounceTarget.y - this.y, this.pounceTarget.x - this.x);
      }
      if (this.pounceTimer <= 0) {
        this.state = "pounceRun";
        this.pounceTimer = CFG.cat.pounceRun;
        if (mouse && this.canSeeMouse(mouse, world)) this.pounceTarget = { x: mouse.x, y: mouse.y };
      }
      return;
    }

    if (this.state === "pounceRun") {
      this.pounceTimer -= dt;
      const tgt = this.pounceTarget;
      if (!tgt) {
        this.finishPounce();
        return;
      }
      const dx = tgt.x - this.x;
      const dy = tgt.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < this.cell * 0.25 || this.pounceTimer <= 0) {
        this.finishPounce();
        return;
      }
      const step = Math.min(d, this.chaseSpeed * CFG.cat.pounceMultiplier * dt);
      const nx = this.x + (dx / d) * step;
      const ny = this.y + (dy / d) * step;
      if (
        !this.ghost &&
        (world.circleHitsWall(nx, ny, this.radius) || !world.lineClear(this.x, this.y, nx, ny))
      ) {
        this.finishPounce(true);
        return;
      }
      this.x = nx;
      this.y = ny;
      this.angle = Math.atan2(dy, dx);
      return;
    }

    const sees = this.canSeeMouse(mouse, world);
    if (sees) {
      this.seeTimer += dt;
      this.loseTimer = 0;
      this.lastSeen = { x: mouse.x, y: mouse.y };
    } else {
      this.seeTimer = 0;
      if (this.state === "chase") this.loseTimer += dt;
    }

    if (this.state === "spot") {
      if (mouse) this.angle = Math.atan2(mouse.y - this.y, mouse.x - this.x);
      if (sees && this.seeTimer >= CFG.cat.alertGrace) {
        this.stopped = false;
        this.state = "chase";
        this.repathTimer = 0;
        this.navPath = null;
        this.navGoal = null;
        this.navInvalidated = true;
      } else if (!sees) {
        this.stopped = false;
        this.state = "return";
        this.navPath = null;
        this.navGoal = null;
        this.navInvalidated = true;
      }
      return;
    }

    if (sees && (this.state === "patrol" || this.state === "return")) {
      this.stopped = false;
      this.state = "spot";
      const agroId = CAT_AGRO_ID[this.type];
      if (agroId) audio.playSound(agroId, { priority: 8 }); // cat_agro_<type> (18..24)
      this.seeTimer = 0;
      this.angle = Math.atan2(mouse.y - this.y, mouse.x - this.x);
      this.navPath = null;
      this.navGoal = null;
      this.cursor = 0;
      this.navInvalidated = true;
      this.waypointTimer = 0;
      this.endpointTimer = 0;
      this.returnIndex = null;
      return;
    }

    if (sees && this.seeTimer >= CFG.cat.alertGrace) {
      if (this.state !== "chase") this.repathTimer = 0;
      this.stopped = false;
      this.state = "chase";
    }

    this.repathTimer -= dt;

    if (this.state === "chase") {
      const d = mouse ? Math.hypot(mouse.x - this.x, mouse.y - this.y) : Infinity;
      if (
        this.ranged &&
        sees &&
        this.attackCooldown <= 0 &&
        d > this.cell * 3 &&
        d <= this.cell * 10 &&
        world.lineClear(this.x, this.y, mouse.x, mouse.y)
      ) {
        this.state = "attackWindup";
        this.attackTimer = 0.3;
        audio.playSound(25); // cat_aim - native 0x85424
        this.attackTarget = { x: mouse.x, y: mouse.y };
        this.navPath = null;
        this.navGoal = null;
        this.cursor = 0;
        this.navInvalidated = true;
        return;
      }
      if (
        sees &&
        this.pounceCooldown <= 0 &&
        d <= CFG.cat.pounceDistCells * this.cell &&
        world.lineClear(this.x, this.y, mouse.x, mouse.y)
      ) {
        this.state = "pounceWait";
        this.pounceTimer = CFG.cat.pounceWait;
        this.pounceTarget = { x: mouse.x, y: mouse.y };
        this.navPath = null;
        this.navGoal = null;
        this.cursor = 0;
        this.navInvalidated = true;
        return;
      }
      let target = this.lastSeen;
      if (sees && this.intercept && (mouse.vx || mouse.vy)) {
        const lead = Math.min(0.6, d / Math.max(1, this.chaseSpeed));
        const px = mouse.x + (mouse.vx || 0) * lead * 0.5;
        const py = mouse.y + (mouse.vy || 0) * lead * 0.5;
        if (world.lineClear(this.x, this.y, px, py)) target = { x: px, y: py };
      }
      if (target) this.navigate(dt, world, target, this.chaseSpeed, 0.25);
      // Pursue the last observed position before searching. A short loss of
      // sight is not permission to read the player's position through walls.
      if (!sees && (!target || Math.hypot(target.x - this.x, target.y - this.y) <= this.cell * 0.6 ||
          (this.loseTimer > CFG.cat.alertLoseTime && !this.navPath))) {
        this.state = "search";
        this.searchTimer = CFG.cat.angryWait;
        audio.playSound(91); // cat_lost - native 0x899CC / 0x7FEA4
        this.navPath = null;
        this.navGoal = null;
        this.navInvalidated = true;
      }
    } else if (this.state === "search") {
      if (sees) {
        this.state = "chase";
        this.repathTimer = 0;
        this.navInvalidated = true;
      } else {
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) {
          this.state = "return";
          this.returnIndex = this.nearestWaypointIndex();
          this.navInvalidated = true;
        }
      }
    } else if (this.state === "return") {
      const idx = this.returnIndex ?? (this.returnIndex = this.nearestWaypointIndex());
      const wp = this.route[idx];
      this.navigate(dt, world, wp, this.patrolSpeed, 0.5);
      if (Math.hypot(wp.x - this.x, wp.y - this.y) < this.cell * 1.1) {
        this.routeIndex = idx;
        this.returnIndex = null;
        this.lastSeen = null;
        this.state = "patrol";
        this.navPath = null;
        this.navGoal = null;
        this.navInvalidated = true;
      }
    } else if (this.routeMode === "stationary" || this.route.length < 2) {
      // Degenerate native stubs: a stationary cat keeps facing its home angle.
      this.angle = this.homeAngle;
    } else if (this.stopped) {
      // Native mode 0 (no 0x66/0x67/0x83 marker): the chain ends here.
    } else if (this.waypointTimer > 0) {
      // Native per-waypoint pause: wait is MovingPlatformPauseTime seconds.
      this.waypointTimer -= dt;
      return;
    } else if (this.endpointTimer > 0) {
      this.endpointTimer -= dt;
      return;
    } else {
      const wp = this.route[this.routeIndex];
      this.navigate(dt, world, wp, this.patrolSpeed, 0.7);
      // H2 FIX B: a waypoint whose own cell is wall/out-of-world can only be
      // approached at cell resolution; reaching its nearest open cell counts.
      let inNearestCell = false;
      if (world.isWall(Math.floor(wp.x / this.cell), Math.floor(wp.y / this.cell))) {
        const no = world.nearestOpen(wp.x, wp.y);
        inNearestCell =
          Math.floor(this.x / this.cell) === no.tx && Math.floor(this.y / this.cell) === no.ty;
      }
      // Native follower arrival threshold (0x9fda0-0x9fdb4): dist^2 <
      // (radius * 0.4)^2. The previous cell*0.9 (14.4px) threshold turned
      // corners ~14px early and shortened the measured period by ~6%.
      // Bounded accommodation: when the waypoint itself is blocked for the
      // cat radius (authored points near walls) and the cat is already in the
      // waypoint's cell, it counts as reached instead of stalling.
      const wpBlocked = world.circleHitsWall(wp.x, wp.y, this.radius);
      const sameCell =
        Math.floor(this.x / this.cell) === Math.floor(wp.x / this.cell) &&
        Math.floor(this.y / this.cell) === Math.floor(wp.y / this.cell);
      if (
        Math.hypot(wp.x - this.x, wp.y - this.y) < this.radius * 0.4 ||
        inNearestCell ||
        (wpBlocked && sameCell)
      ) {
        const wait = wp.wait || 0;
        let next = this.routeIndex + this.routeDir;
        let endpoint = false;
        if (this.routeMode === "loop" || this.routeMode === "regenerate") {
          next = ((next % this.route.length) + this.route.length) % this.route.length;
        } else if (next < 0 || next >= this.route.length) {
          if (this.routeMode === "stop") {
            // Native mode 0 clamps the cursor at the end and keeps facing the
            // last segment; the last waypoint's wait still pauses first.
            if (wait > 0) this.waypointTimer = wait;
            if (this.route.length >= 2) {
              const prev = this.route[this.route.length - 2];
              this.angle = Math.atan2(wp.y - prev.y, wp.x - prev.x);
            }
            this.stopped = true;
            this.navPath = null;
            this.navGoal = null;
            this.navInvalidated = true;
            return;
          }
          this.routeDir = -this.routeDir;
          next = this.routeIndex + this.routeDir;
          // Native endpoint pause (follower 0x9fe70-0x9fe7c / 0xa01a4): the
          // pause is the last waypoint's wait for modes 0-2; there is no
          // default 0.4s pause.
          this.endpointTimer = wait;
          endpoint = true;
        }
        if (next >= 0 && next < this.route.length) this.routeIndex = next;
        if (wait > 0 && !endpoint) this.waypointTimer = wait;
        this.navPath = null;
        this.navGoal = null;
        this.navInvalidated = true;
      }
    }

  }

  nearestWaypointIndex() {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.route.length; i++) {
      const p = this.route[i];
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  nearestWaypoint() {
    return this.route[this.nearestWaypointIndex()];
  }

  // Grid path to `goal`, followed with wall sliding. Replans on a timer or when
  // the goal moves, so the cat never wedges itself against geometry.
  navigate(dt, world, goal, speed, repathInterval) {
    if (this.ghost) {
      const dx = goal.x - this.x;
      const dy = goal.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        const step = Math.min(d, speed * dt);
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
        this.angle = Math.atan2(dy, dx);
      }
      return;
    }
    // Intentional invalidation (waypoint reached, target lost, pounce/attack
    // started) must trigger a rebuild on the next update. A failed BFS is NOT
    // an invalidation: it keeps the retry backoff so an unreachable goal is
    // not re-pathed every frame.
    if (this.navInvalidated) {
      this.repathTimer = 0;
      this.navInvalidated = false;
    }
    const goalMoved = !this.navGoal || Math.hypot(goal.x - this.navGoal.x, goal.y - this.navGoal.y) > this.cell * 0.6;
    // A brand-new target after a failed path is a new opportunity: try now.
    // While a valid path exists the repath interval still throttles replanning.
    if (goalMoved && !this.navPath) this.repathTimer = 0;
    const needPath = !this.navPath || this.cursor >= this.navPath.length || goalMoved;

    if (needPath && this.repathTimer <= 0) {
      // Native follower movement (0x9fcf8) is a straight line toward the
      // current path point; only fall back to a grid path when the straight
      // line is blocked (post-chase recovery, tight geometry).
      const p = world.lineClear(this.x, this.y, goal.x, goal.y)
        ? [{ x: goal.x, y: goal.y }]
        : world.bfsToWorld(this.x, this.y, goal.x, goal.y);
      // Remember the attempted goal even when no path exists; otherwise the
      // next frame looks like a brand-new goal and defeats the backoff.
      this.navGoal = { x: goal.x, y: goal.y };
      if (p) {
        // H2 FIX A: an empty BFS means start and goal share one open cell;
        // the grid path cannot get closer, so steer straight at the goal.
        this.navPath = p.length ? p : [{ x: goal.x, y: goal.y }];
        this.cursor = 0;
      } else {
        this.navPath = null;
        this.cursor = 0;
      }
      this.repathTimer = repathInterval;
    }

    if (this.navPath && this.cursor < this.navPath.length) {
      const bx = this.x, by = this.y;
      const r = slideAlong(this, this.navPath, this.cursor, speed, dt, world, this.radius);
      this.cursor = r.cursor;
      const moved = Math.hypot(this.x - bx, this.y - by);
      if (moved < 0.01 || r.stuck) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 0.3) {
          this.stuckTimer = 0;
          this.navPath = null;
          this.cursor = 0;
          this.repathTimer = 0;
          this.navInvalidated = true;
        }
      } else {
        this.stuckTimer = 0;
      }
    }
  }
}
