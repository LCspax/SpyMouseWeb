/**
 * bonus.js - in-level reward room entrance for the web port.
 *
 * Evidence boundary (analysis/parallel/N1/notes.md):
 *   The shipped data authors 14 `secret="true"` levels and a world-map reveal
 *   (property 121/125 hidden roads) but NO in-level entrance prop ("Do not
 *   invent a wall-gap door"). The port therefore treats the in-level reward
 *   entrance as an explicit WEB-COMPATIBLE addition: one golden portal that
 *   only appears once the parent level has nothing left to collect, lets the
 *   player visit the chapter's secret ("S") level, and pays the native
 *   `exit_bonus_multiplier` (2.0 @0x2765f0, unreachable branch natively) when
 *   the reward room is cleared.
 *
 * State rules that matter for correctness:
 *   - the portal is CLAIMED only after the reward room is cleared; entering and
 *     then dying/abandoning leaves it claimable again (no lost or duplicated
 *     reward),
 *   - the reward and its record are written once per parent level and are
 *     keyed by level id, so replaying the level cannot pay twice,
 *   - the parent level state is stashed by Game.beginBonus() and restored by
 *     Game.finishBonus(); the portal itself only owns its presentation state,
 *   - the portal is a compact solid medallion, NOT a second light source: the
 *     native open mousehole already glows, and an extra beam/ground glow plus
 *     a dashed ring next to it reads as a broken door-open effect.
 */

import { clamp, dist } from './math.js';
import { audio } from './audio.js';

/** Native `exit_bonus_multiplier` (@0x2765f0). Web use: reward-room payout. */
export const EXIT_BONUS_MULTIPLIER = 2.0;

export const BONUS_APPEAR_SECONDS = 0.8;
export const BONUS_ENTER_SECONDS = 0.42;
const TAP_RADIUS_CELLS = 2.6;
const REACH_CELLS = 1.15;

/** World number of a level ("1-Boss" -> 1, "LEVEL_8_1" -> 8). */
function worldOf(def) {
  const match = /^(\d+)/.exec(String(def?.num || ''));
  return match ? Number(match[1]) : 0;
}

/**
 * The chapter's secret "S" level, used as the reward room. `level_data.xml`
 * marks these `secret="true"` with `by1=-1` (not reachable from the map nodes),
 * which is exactly the gap this entrance fills.
 */
export function bonusTargetFor(def, catalog = []) {
  if (!def || def.secret) return null;
  if (def.mode === 'boss' || def.mode === 'infinite') return null;
  const world = worldOf(def);
  if (!world) return null;
  const target = catalog.find((level) => level
    && level.id !== def.id
    && level.secret === true
    && new RegExp(`^${world}-S\\d*$`).test(String(level.num || '')));
  if (!target) return null;
  return { level: target, index: catalog.indexOf(target) };
}

/**
 * Reachable spot for the portal next to the exit. Tried offsets keep it off the
 * exit's own interaction point so a tap can never be ambiguous.
 */
function portalSpot(game) {
  const level = game.level;
  const world = level.world;
  const exit = level.exit;
  if (!exit) return null;
  const u = world.cell;
  const offsets = [
    [2.6, 0.4], [-2.6, 0.4], [0.4, -2.6], [0.4, 2.6],
    [3.4, -1.2], [-3.4, -1.2], [3.4, 1.6], [-3.4, 1.6],
  ];
  for (const [dx, dy] of offsets) {
    const x = exit.x + dx * u;
    const y = exit.y + dy * u;
    if (world.circleHitsWall(x, y, game.mouse?.radius || u * 0.5)) continue;
    if (dist(x, y, exit.x, exit.y) < u * 1.4) continue;
    const route = world.bfsToWorld(x, y, exit.x, exit.y);
    if (!route) continue;
    return { x, y };
  }
  return null;
}

export class BonusPortal {
  /**
   * @param {object} game
   * @param {object|null} target  result of bonusTargetFor()
   * @param {{claimed?:boolean}} state  persisted claim flag
   */
  constructor(game, target, { claimed = false } = {}) {
    this.target = target;
    this.targetId = target?.level?.id ?? null;
    this.targetIndex = target?.index ?? -1;
    this.state = claimed ? 'used' : 'hidden';
    this.t = 0;
    this.pending = false;
    this.claimed = claimed;
    const spot = target ? portalSpot(game) : null;
    if (!spot) {
      this.state = 'used';
      this.x = null;
      this.y = null;
    } else {
      this.x = spot.x;
      this.y = spot.y;
    }
  }

  get usable() {
    return this.state === 'ready' || this.state === 'appearing';
  }

  get onScreen() {
    return this.state === 'hidden' ? false : true;
  }

  /** Reset presentation after a retry without losing the claim flag. */
  reset(game) {
    this.t = 0;
    this.pending = false;
    if (this.claimed) {
      this.state = 'used';
      return;
    }
    this.state = 'hidden';
    if (this.x == null) {
      const spot = portalSpot(game);
      if (spot) {
        this.x = spot.x;
        this.y = spot.y;
      }
    }
    // A retry can open the level with nothing left to collect (e.g. a bonus
    // run returning into a fully cleared parent): appear immediately.
    if (this.available(game)) this.appear(game, false);
  }

  available(game) {
    if (this.claimed || this.x == null) return false;
    return game.cheeseLeft === 0 && (game.pendingMachineCheese ?? 0) === 0;
  }

  appear(game, sound = true) {
    if (this.state !== 'hidden') return;
    this.state = 'appearing';
    this.t = 0;
    if (sound) audio.playSound(141, { priority: 6 }); // ui_findsecret
  }

  update(dt, game) {
    if (this.state === 'used' || this.state === 'hidden') {
      if (this.state === 'hidden' && this.available(game)) this.appear(game);
      else if (this.state === 'used') this.t = Math.min(1.2, this.t + dt);
      return;
    }
    this.t += dt;
    if (this.state === 'appearing' && this.t >= BONUS_APPEAR_SECONDS) {
      this.state = 'ready';
      this.t = 0;
    }
    if (this.state === 'ready' && this.pending) {
      if (dist(game.mouse.x, game.mouse.y, this.x, this.y) < game.level.world.cell * REACH_CELLS) {
        this.beginEnter(game);
      } else if (!game.mouse.moving) {
        // Route interrupted (wall, teleport, hide): drop the pending approach.
        this.pending = false;
      }
    }
    if (this.state === 'entering' && this.t >= BONUS_ENTER_SECONDS) {
      this.state = 'ready'; // Game.beginBonus() takes over from here
      this.pending = false;
      game.enterBonusFromPortal(this);
    }
  }

  /** Tap handler: returns true when the tap was consumed by the portal. */
  tryTap(game, point) {
    if (this.state !== 'ready' && this.state !== 'appearing') return false;
    if (this.x == null) return false;
    const u = game.level.world.cell;
    if (dist(point.x, point.y, this.x, this.y) > u * TAP_RADIUS_CELLS) return false;
    if (this.state === 'appearing') this.state = 'ready';
    if (game.mouse.hidden) return false;
    if (dist(game.mouse.x, game.mouse.y, this.x, this.y) < u * REACH_CELLS) {
      this.beginEnter(game);
      return true;
    }
    const route = game.level.world.bfsToWorld(game.mouse.x, game.mouse.y, this.x, this.y);
    if (!route) return true;
    game.pendingHide = null;
    game.mouse.setPath(route);
    this.pending = true;
    return true;
  }

  beginEnter(game) {
    if (this.state === 'entering') return;
    this.state = 'entering';
    this.t = 0;
    this.pending = false;
    game.cancelStroke();
    game.mouse.clearPath();
    game.mouse.moving = false;
    audio.playSound(175, { priority: 7 }); // ui_woosh_quick
  }

  /** The reward room ended without a clear: the portal stays claimable. */
  onReturn(game, success) {
    this.pending = false;
    this.t = 0;
    if (success) {
      this.claimed = true;
      this.state = 'used';
      return;
    }
    this.state = 'ready';
  }

  draw(ctx, game) {
    if (this.state === 'hidden' || this.x == null) return;
    const u = game.level.world.cell;
    const time = game.time;
    let scale = 1;
    let alpha = 1;
    if (this.state === 'appearing') {
      const p = clamp(this.t / BONUS_APPEAR_SECONDS, 0, 1);
      scale = 0.2 + 0.8 * (1 - Math.pow(1 - p, 3));
      alpha = p;
    } else if (this.state === 'entering') {
      const p = clamp(this.t / BONUS_ENTER_SECONDS, 0, 1);
      scale = Math.max(0.05, 1 - p * 0.95);
      alpha = 1 - p * 0.35;
    } else if (this.state === 'used') {
      // Fade the spent portal out; the parent level keeps its normal look.
      alpha = clamp(1 - this.t / 1.2, 0, 1) * 0.5;
      scale = 1 + this.t * 0.4;
      if (alpha <= 0.02) return;
    }
    const pulse = 0.9 + 0.1 * Math.sin(time * 5);
    // A compact, bounded medallion. The old presentation drew a ground glow,
    // a vertical light beam, a tinted flare and a rotating DASHED chevron
    // ring. Because the portal sits beside the exit, those read as the open
    // door's own glow split into two pieces plus a stray dashed circle. The
    // native home_mousehole_* open frame already carries its own glow, so the
    // bonus entrance must not emit a second light source.
    const radius = u * 1.15 * scale * pulse;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(206,150,28,0.92)';
    ctx.beginPath();
    if (typeof ctx.arc === 'function') ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = u * 0.1;
    ctx.beginPath();
    if (typeof ctx.arc === 'function') ctx.arc(this.x, this.y, radius - u * 0.05, 0, Math.PI * 2);
    ctx.stroke();
    // Cheese wedge in the middle (solid, no dash, no flare).
    const w = u * 1.0 * scale;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(this.x - w * 0.5, this.y + w * 0.45);
    ctx.lineTo(this.x + w * 0.55, this.y + w * 0.45);
    ctx.lineTo(this.x + w * 0.02, this.y - w * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c99a12';
    ctx.beginPath();
    ctx.arc(this.x - w * 0.1, this.y + w * 0.2, w * 0.09, 0, Math.PI * 2);
    ctx.arc(this.x + w * 0.18, this.y + w * 0.16, w * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
