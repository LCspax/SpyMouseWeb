import { defineShot, el, css, inv, lerp, clamp, easeOut, easeOutBack, easeInOut } from '../lib.js';

defineShot('S00', (root) => {
  const wrap = el('div', '', root);
  css(wrap, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#04060A' });

  /* three-shot montage of the 2011 original: house level → ninja cats → boss */
  const CLIPS = [
    { at: 9.95, dur: 1.30, rate: 1.00, z: [1.03, 1.08] },   // 1-2 house level
    { at: 39.12, dur: 1.75, rate: 1.00, z: [1.02, 1.07] },  // ninja cats throwing shurikens
    { at: 48.70, dur: 1.95, rate: 0.65, z: [1.04, 1.04] },  // boss: the giant cat
  ];
  const edges = CLIPS.map((c, i) => CLIPS.slice(0, i).reduce((n, x) => n + x.dur, 0));

  const vids = CLIPS.map((c, i) => {
    const v = el('video', '', wrap);
    v.src = '../media/ref/trailer-21.mp4'; v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.dataset.start = c.at - edges[i] * c.rate;
    v.dataset.rate = c.rate;
    css(v, { position: 'absolute', left: '-3%', top: '-2%', width: '106%', height: '104%', objectFit: 'cover', filter: 'saturate(1.06) contrast(1.07) brightness(.86)', opacity: 0 });
    return v;
  });

  el('div', 'scan', wrap);

  const glow = el('div', '', wrap);
  css(glow, { position: 'absolute', right: '-40px', bottom: '-60px', width: '820px', height: '820px', background: 'radial-gradient(50% 50% at 50% 50%, rgba(255,198,58,.22), rgba(255,198,58,0) 70%)' });

  /* small soft plate under the text column only (no edge vignette) */
  const scrim = el('div', '', wrap);
  css(scrim, { position: 'absolute', left: '40px', bottom: '10px', width: '760px', height: '440px', background: 'radial-gradient(48% 48% at 38% 62%, rgba(6,9,14,.60), rgba(6,9,14,0) 74%)' });

  const shadow = el('div', '', wrap);
  css(shadow, { position: 'absolute', right: '136px', bottom: '106px', width: '460px', height: '56px', borderRadius: '50%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.62), rgba(0,0,0,0) 72%)' });

  /* protagonist art: body + eye layer (the menu art ships without eyes) */
  const hero = el('div', '', wrap);
  css(hero, { position: 'absolute', right: '96px', bottom: '118px', width: '520px', filter: 'drop-shadow(0 26px 44px rgba(0,0,0,.55))' });
  const imgOpen = el('img', '', hero);
  imgOpen.src = '../media/art/mouse-hero.png';
  css(imgOpen, { display: 'block', width: '100%' });
  const imgShut = el('img', '', hero);
  imgShut.src = '../media/art/mouse-hero-closed.png';
  css(imgShut, { position: 'absolute', left: '0', top: '0', width: '100%', opacity: 0 });

  /* 2011 odometer */
  const kicker = el('div', '', wrap, 'SPY MOUSE · 2011');
  css(kicker, { position: 'absolute', left: '154px', top: '640px', fontFamily: 'Consolas, monospace', fontSize: '22px', letterSpacing: '7px', color: 'rgba(255,226,180,.92)', fontWeight: 700, opacity: 0, textShadow: '0 3px 0 rgba(0,0,0,.65)' });

  const rule = el('div', '', wrap);
  css(rule, { position: 'absolute', left: '152px', top: '680px', width: '0px', height: '3px', background: '#FFC63A', boxShadow: '0 0 18px rgba(255,198,58,.7)' });

  const counter = el('div', 'counter', wrap);
  css(counter, { left: '150px', top: '704px' });
  const digits = [0, 1, 2, 3].map(() => el('div', 'digit', counter, '0'));
  digits.forEach(d => css(d, { width: '104px', height: '140px', fontSize: '106px' }));

  const cap = el('div', '', wrap, '原版实机画面');
  css(cap, { position: 'absolute', left: '154px', top: '868px', fontSize: '30px', letterSpacing: '8px', color: 'rgba(255,236,200,.92)', fontWeight: 700, opacity: 0, textShadow: '0 4px 0 rgba(0,0,0,.6)' });

  /* index of the current cut, bottom right of the montage */
  const idx = el('div', '', wrap, '01 / 03');
  css(idx, { position: 'absolute', right: '86px', top: '86px', fontFamily: 'Consolas, monospace', fontSize: '20px', letterSpacing: '4px', color: 'rgba(255,232,190,.72)', fontWeight: 700, opacity: 0, textShadow: '0 3px 0 rgba(0,0,0,.6)' });

  const flash = el('div', '', wrap);
  css(flash, { position: 'absolute', inset: '0', background: '#FFF3D6', opacity: 0, mixBlendMode: 'screen' });

  let lastClip = -1;
  let lastVal = -1;
  return (t) => {
    const open = easeOut(inv(0, .42, t));
    wrap.style.opacity = t < .02 ? 0 : 1;
    flash.style.opacity = Math.max(0, .28 * (1 - t / .18));

    /* pick the active clip, punch-zoom each one */
    let k = CLIPS.length - 1;
    for (let i = 0; i < CLIPS.length; i++) if (t < edges[i] + CLIPS[i].dur) { k = i; break; }
    vids.forEach((v, i) => {
      v.style.opacity = i === k ? 1 : 0;
      if (i !== k) return;
      const local = t - edges[i];
      const p = clamp(local / CLIPS[i].dur);
      v.style.transform = `scale(${lerp(CLIPS[i].z[0], CLIPS[i].z[1], easeInOut(p))}) translateX(${lerp(0, -8, p)}px)`;
    });
    if (k !== lastClip) {
      lastClip = k;
      idx.textContent = `${String(k + 1).padStart(2, '0')} / ${String(CLIPS.length).padStart(2, '0')}`;
    }
    const cutLocal = t - edges[k];
    flash.style.opacity = Math.max(flash.style.opacity, k > 0 ? Math.max(0, .12 * (1 - cutLocal / .12)) : 0);
    idx.style.opacity = inv(1.1, 1.5, t) * .9;

    const hin = easeOutBack(inv(.18, 1.05, t));
    hero.style.opacity = inv(.15, .5, t);
    hero.style.transform = `translateX(${lerp(150, 0, hin)}px) translateY(${Math.sin(t * 2.0) * 5}px) rotate(${lerp(6, 0, hin)}deg)`;

    const blink = (a) => (t > a && t < a + .14 ? 1 : 0);
    imgShut.style.opacity = Math.max(blink(3.55), blink(3.88));

    shadow.style.opacity = inv(.2, .6, t) * .9;
    shadow.style.transform = `scaleX(${lerp(.7, 1, hin)})`;

    const roll = inv(1.05, 2.15, t);
    const val = Math.round(lerp(1987, 2011, easeInOut(roll)));
    const s = String(val).padStart(4, '0');
    if (val !== lastVal) { lastVal = val; digits.forEach((d, i) => { d.textContent = s[i]; }); }
    const pop = t > 2.15 ? 1 + Math.sin(clamp((t - 2.15) * 10) * Math.PI) * .04 : 1;
    counter.style.transform = `scale(${pop})`;
    counter.style.opacity = inv(.95, 1.15, t);
    counter.style.filter = t < 2.15 ? `blur(${(1 - roll) * 3}px)` : 'none';

    rule.style.width = `${lerp(0, 300, easeOut(inv(1.15, 1.75, t)))}px`;
    kicker.style.opacity = inv(1.05, 1.45, t);
    cap.style.opacity = inv(2.0, 2.45, t);
    cap.style.transform = `translateY(${lerp(14, 0, easeOut(inv(2.0, 2.55, t)))}px)`;
    glow.style.opacity = lerp(.0, 1, inv(.25, 1.2, t)) * open;
    scrim.style.opacity = inv(.4, 1.1, t);
  };
});
