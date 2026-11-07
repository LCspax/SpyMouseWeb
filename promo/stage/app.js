/* Spy Mouse promo — deterministic stage engine.
   Each shot module exports a build(root, {start,dur}) that returns update(local). */
import { registry, TL, el } from './lib.js';
import './shots/s00.js';
import './shots/s01.js';
import './shots/s02.js';
import './shots/s03.js';
import './shots/s04.js';
import './shots/s05.js';
import './shots/s06.js';
import './shots/s07.js';
import './shots/s08.js';
import './shots/s09.js';
import './shots/s10.js';
import './shots/s11.js';
import './shots/s12.js';
import './shots/s13.js';
import './shots/s14.js';

const tl = await TL();
const shotsRoot = document.getElementById('shots');
const shots = [];

/* Transition into each shot. Every shot is authored against its real duration,
   so the local time handed to update() is exact and the beats can be lined up
   with the voice-over. Nothing is pre-rolled: the incoming composition is
   covered by the transition instead of running ahead of the narration. */
const TRANS = {
  S01: { type: 'push', dur: 0.40 },
  S02: { type: 'dissolve', dur: 0.34 },
  S03: { type: 'push', dur: 0.44 },
  S04: { type: 'dissolve', dur: 0.34 },
  S05: { type: 'wipe', dur: 0.38 },
  S06: { type: 'dissolve', dur: 0.30 },
  S07: { type: 'push', dur: 0.40 },
  S08: { type: 'push', dur: 0.40 },
  S10: { type: 'push', dur: 0.40 },
  S11: { type: 'wipe', dur: 0.36 },
  S12: { type: 'push', dur: 0.42 },
  S13: { type: 'wipe', dur: 0.40 },
  S14: { type: 'wipe', dur: 0.42 },
};

/* shots are laid out from the timeline; anything not in the timeline is
   skipped (e.g. S09 is currently switched off) */
const active = registry.filter(r => tl.shots[r.id]);

for (let i = 0; i < active.length; i++) {
  const r = active[i];
  const [start, dur] = tl.shots[r.id];
  const scene = el('div', 'scene', shotsRoot);
  const root = el('div', 'shot', scene);
  root.dataset.id = r.id;

  const inT = TRANS[r.id] || { type: 'dissolve', dur: 0.3 };
  const next = active[i + 1];
  const outT = next ? (TRANS[next.id] || { type: 'dissolve', dur: 0.3 }) : null;

  const update = r.build(root, { start, dur });
  shots.push({
    id: r.id, start, dur, scene, root, update,
    inType: inT.type, inDur: inT.dur,
    outType: outT ? outT.type : null, outDur: outT ? outT.dur : 0,
  });
}

window.__timeline = { total: tl.total, shots: tl.shots };

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeIO = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

async function seek(t) {
  const pending = [];
  for (const s of shots) {
    const end = s.start + s.dur;
    /* the outgoing shot is kept alive for the length of the transition so the
       cut is a real dissolve/slide between two composed frames */
    const on = t >= s.start - 1e-6 && t < end + s.outDur - 1e-6;
    s.scene.style.visibility = on ? 'visible' : 'hidden';
    if (!on) { s.scene.style.opacity = 0; s.scene.style.transform = ''; continue; }

    let op = 1, tx = 0, wipe = '';
    if (s.start > 0 && t < s.start + s.inDur) {
      const p = clamp01((t - s.start) / s.inDur);
      if (s.inType === 'push') tx += (1 - easeIO(p)) * 1920;
      else if (s.inType === 'wipe') wipe = `inset(0 ${(1 - easeIO(p)) * 100}% 0 0)`;
      else op = Math.min(op, p);
    }
    if (t > end) {
      const p = clamp01((t - end) / s.outDur);
      if (s.outType === 'push') tx -= easeIO(p) * 1920;
      else if (s.outType === 'wipe') wipe = `inset(0 0 0 ${easeIO(p) * 100}%)`;
      else op = Math.min(op, 1 - p);
    }
    s.scene.style.opacity = op;
    s.scene.style.transform = tx ? `translate3d(${tx}px,0,0)` : '';
    s.scene.style.clipPath = wipe;

    const local = Math.min(t - s.start, s.dur);
    s.root.dataset.local = local;
    if (s.update) s.update(local);
    s.root.querySelectorAll('video').forEach(v => {
      const want = Math.max(0, Number(v.dataset.start || 0) + local * Number(v.dataset.rate || 1));
      if (Math.abs(v.currentTime - want) > 1 / 80) {
        pending.push(new Promise(res => {
          let done = false;
          const fin = () => { if (!done) { done = true; v.removeEventListener('seeked', fin); res(); } };
          v.addEventListener('seeked', fin);
          try { v.currentTime = want; } catch (e) { fin(); }
          setTimeout(fin, 500);
        }));
      }
    });
  }
  if (pending.length) await Promise.all(pending);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// caption preview
const capsEl = document.getElementById('caps');
let CAPS = [];
if (new URLSearchParams(location.search).get('caps') === '1') {
  fetch('../tts/captions.json').then(r => r.ok ? r.json() : []).then(j => { CAPS = j; }).catch(() => {});
}

window.seek = async (t) => {
  await seek(t);
  if (!CAPS.length) return;
  const c = CAPS.find(c => t >= c.start && t < c.end);
  capsEl.textContent = c ? c.text : '';
  capsEl.style.opacity = c ? 1 : 0;
};

if (!location.search.includes('render=1')) {
  window.seek(Number(new URLSearchParams(location.search).get('t') || 0));
}
