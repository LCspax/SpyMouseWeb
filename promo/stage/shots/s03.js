import { defineShot, el, css, inv, lerp, easeOut, easeInOut } from '../lib.js';

defineShot('S03', (root) => {
  const wrap = el('div', '', root);
  css(wrap, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#120A06' });

  const v = el('video', '', wrap);
  v.src = '../media/ref/iphone4.mp4'; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.dataset.start = 8.9; v.dataset.rate = 1;
  // push the top 40px of the source out of frame → hides the platform watermark
  css(v, { position: 'absolute', left: '0', top: '-110px', width: '100%', height: '1200px', objectFit: 'cover', filter: 'saturate(1.02) contrast(1.06) brightness(.98)' });

  const warm = el('div', '', root);
  css(warm, { position: 'absolute', inset: '0', background: 'radial-gradient(70% 65% at 50% 45%, rgba(255,190,110,.10), rgba(120,50,20,.18) 70%, rgba(0,0,0,.55) 100%)', mixBlendMode: 'multiply' });

  const glow = el('div', '', root);
  css(glow, { position: 'absolute', inset: '0', background: 'linear-gradient(105deg, rgba(255,220,160,.10), rgba(255,220,160,0) 45%)' });

  // corner brackets — archival framing
  const bracket = (x, y, sx, sy) => {
    const b = el('div', '', root);
    css(b, { position: 'absolute', left: x + 'px', top: y + 'px', width: '54px', height: '54px', borderTop: '3px solid rgba(255,198,58,.55)', borderLeft: '3px solid rgba(255,198,58,.55)', transform: `scale(${sx},${sy})`, transformOrigin: 'top left' });
    return b;
  };
  bracket(70, 70, 1, 1); bracket(1850, 70, -1, 1); bracket(70, 1010, 1, -1); bracket(1850, 1010, -1, -1);

  const tag = el('div', '', root);
  css(tag, { position: 'absolute', left: '96px', bottom: '92px', display: 'flex', alignItems: 'center', gap: '16px' });
  const dot = css(el('div', '', tag), { width: '12px', height: '12px', borderRadius: '50%', background: '#FFC63A', boxShadow: '0 0 18px #FFC63A' });
  const txt = css(el('div', '', tag, '2011 · iPhone 4 · 手指画线'), { fontSize: '30px', fontWeight: 700, letterSpacing: '3px', color: 'rgba(255,244,220,.92)', textShadow: '3px 3px 0 rgba(0,0,0,.55)' });

  if (txt) txt.style.opacity = 1;

  return (t) => {
    const p = easeInOut(inv(0, 6.1, t));
    v.style.transform = `scale(${lerp(1.0, 1.07, p)})`;
    dot.style.opacity = .5 + .5 * Math.sin(t * 6);
    tag.style.opacity = inv(.25, .8, t);
    tag.style.transform = `translateY(${lerp(14, 0, easeOut(inv(.25, .9, t)))}px)`;
  };
});
