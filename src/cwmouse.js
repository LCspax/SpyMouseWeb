// Prop-11 cwmouse runtime (parallel-L2 evidence, see
// analysis/parallel/L2/findings.json). Native flow:
//   idle      static frame 0 (pool update 0xa2d80 gated on entity+5 != 0)
//   pickup    touch -> 0x94fe8/0x95488 -> collectEntity 0xb3908 (sound 0x71,
//             carried in the player chain; no score, no goal)
//   vanish    the paired prop-60 point activates the hop 0xa2858 ->
//             0x93e74/0x468b70: eased A->B arc, then entity+4=0 (removed)
export const CWM = {
  TOUCH_RADIUS_U: 0.7,
  HOLE_RADIUS_U: 1.6,
  FOLLOW_GAP_U: 0.9,
  FOLLOW_SPEED_U: 6.0,
  FLEE_DURATION_FACTOR: 4.0,
  FLEE_DURATION_MIN: 0.35,
  FLEE_DURATION_MAX: 1.2,
  HOP_HEIGHT_FACTOR: 0.35,
  HOP_HEIGHT_MIN_U: 0.5,
  HOP_HEIGHT_MAX_U: 2.0,
  FRAME_HOLD: 0.2,
  FRAME_COUNT: 4,
  DRAW_SIZE_U: 2.6,
};

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (t) => t * t * (3 - 2 * t);

export function resetCwmice(level) {
  for (const m of level.cwmice || []) {
    m.picked = false;
    m.fleeing = false;
    m.gone = false;
    m.t = 0;
    m.yOff = 0;
  }
}

export function updateCwmice(level, mouse, dt, playSound) {
  const u = level.world.cell;
  for (const m of level.cwmice || []) {
    if (m.gone) continue;

    if (!m.picked && dist(m.x, m.y, mouse.x, mouse.y) < u * CWM.TOUCH_RADIUS_U) {
      m.picked = true;
      if (playSound) playSound(0x71);
      continue;
    }

    if (m.picked && !m.fleeing) {
      const d = dist(m.x, m.y, mouse.x, mouse.y);
      if (d > u * CWM.FOLLOW_GAP_U) {
        const step = Math.min(d - u * CWM.FOLLOW_GAP_U, CWM.FOLLOW_SPEED_U * u * dt);
        m.x += ((mouse.x - m.x) / d) * step;
        m.y += ((mouse.y - m.y) / d) * step;
      }
      if (m.hole && dist(mouse.x, mouse.y, m.hole.x, m.hole.y) < u * CWM.HOLE_RADIUS_U) {
        m.fleeing = true;
        m.t = 0;
        m.ax = m.x;
        m.ay = m.y;
        m.bx = m.hole.x;
        m.by = m.hole.y;
        m.dur = clamp(
          (dist(m.ax, m.ay, m.bx, m.by) / u) * 0.25,
          CWM.FLEE_DURATION_MIN,
          CWM.FLEE_DURATION_MAX
        );
        m.hop = clamp(
          dist(m.ax, m.ay, m.bx, m.by) * CWM.HOP_HEIGHT_FACTOR,
          CWM.HOP_HEIGHT_MIN_U * u,
          CWM.HOP_HEIGHT_MAX_U * u
        );
      }
      continue;
    }

    if (m.fleeing) {
      m.t += dt;
      const k = clamp(m.t / m.dur, 0, 1);
      const e = smooth(k);
      m.x = m.ax + (m.bx - m.ax) * e;
      m.y = m.ay + (m.by - m.ay) * e;
      m.yOff = -Math.sin(Math.PI * k) * m.hop;
      if (k >= 1) {
        m.fleeing = false;
        m.gone = true;
      }
    }
  }
}

export function drawCwmice(ctx, sprites, level, time, u, scale = 1) {
  if (scale <= 0.01) return;
  for (const m of level.cwmice || []) {
    if (m.gone) continue;
    const animating = m.picked || m.fleeing;
    const frame = animating ? Math.floor(time / CWM.FRAME_HOLD) % CWM.FRAME_COUNT : 0;
    const s = u * CWM.DRAW_SIZE_U * scale;
    sprites.frame(ctx, "cwmouse", frame, m.x, m.y + (m.yOff || 0) * scale, s, s);
  }
}
