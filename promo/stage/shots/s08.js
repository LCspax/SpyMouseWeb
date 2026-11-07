import { defineShot, el, css, inv, lerp, easeInOut, easeOut } from '../lib.js';

defineShot('S08', (root) => {
  const wrap = el('div', '', root);
  css(wrap, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#0A0704' });

  const v = el('video', '', wrap);
  v.src = '../media/web/clean_crop.mp4'; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.dataset.start = 17.8; v.dataset.rate = 1;
  css(v, { position: 'absolute', left: '-2%', top: '-1%', width: '104%', height: '102%', objectFit: 'cover', filter: 'saturate(1.06) contrast(1.05)' });

  const grade = el('div', '', root);
  css(grade, { position: 'absolute', inset: '0', background: 'radial-gradient(80% 75% at 50% 50%, rgba(255,190,110,.05), rgba(30,10,4,.32) 100%)', mixBlendMode: 'multiply' });

  // HUD
  const hud = el('div', '', root);
  css(hud, { position: 'absolute', left: '72px', top: '64px', display: 'flex', alignItems: 'center', gap: '14px', fontSize: '20px', letterSpacing: '3px', color: 'rgba(255,240,215,.75)', fontFamily: 'Consolas, monospace' });
  const rec = css(el('div', '', hud), { width: '12px', height: '12px', borderRadius: '50%', background: '#FF4B3A', boxShadow: '0 0 14px #FF4B3A' });
  el('div', '', hud, 'WEB BUILD · LIVE');

  const corner = (x, y, sx, sy) => css(el('div', '', root), { position: 'absolute', left: x + 'px', top: y + 'px', width: '46px', height: '46px', borderTop: '2px solid rgba(255,255,255,.35)', borderLeft: '2px solid rgba(255,255,255,.35)', transform: `scale(${sx},${sy})`, transformOrigin: 'top left' });
  corner(56, 108, 1, 1); corner(1864, 108, -1, 1); corner(56, 972, 1, -1); corner(1864, 972, -1, -1);

  const tag = el('div', '', root);
  css(tag, { position: 'absolute', left: '72px', bottom: '70px', display: 'flex', alignItems: 'center', gap: '14px' });
  css(el('div', '', tag, '画一条线，它就出发'), { fontSize: '30px', fontWeight: 700, color: 'rgba(255,246,228,.94)', letterSpacing: '2px', textShadow: '4px 4px 0 rgba(0,0,0,.6)' });
  css(el('div', '', tag, '1080p · 60fps'), { fontSize: '18px', letterSpacing: '2px', color: 'rgba(255,240,210,.5)', fontFamily: 'Consolas, monospace' });

  return (t) => {
    const p = easeInOut(inv(0, 4.6, t));
    v.style.transform = `scale(${lerp(1.02, 1.10, p)}) translateY(${lerp(0, -14, p)}px)`;
    rec.style.opacity = .45 + .55 * (Math.sin(t * 5) > 0 ? 1 : 0);
    tag.style.opacity = inv(.2, .7, t);
    tag.style.transform = `translateY(${lerp(14, 0, easeOut(inv(.2, .8, t)))}px)`;
  };
});
