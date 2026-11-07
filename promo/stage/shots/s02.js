import { defineShot, el, css, inv, lerp, easeOut, easeInOut, easeOutBack } from '../lib.js';

defineShot('S02', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(55% 60% at 50% 45%, #4A2A17 0%, #24130A 55%, #0C0603 100%)' });

  const dust = el('div', '', root);
  css(dust, { position: 'absolute', inset: '0', background: 'radial-gradient(2px 2px at 20% 30%, rgba(255,220,160,.5), transparent 60%), radial-gradient(2px 2px at 70% 20%, rgba(255,220,160,.35), transparent 60%), radial-gradient(2px 2px at 82% 70%, rgba(255,220,160,.4), transparent 60%)', opacity: .5 });

  const scene = el('div', '', root);
  css(scene, { position: 'absolute', inset: '0', perspective: '1700px', perspectiveOrigin: '50% 50%' });

  // browser
  const win = el('div', '', scene);
  css(win, {
    position: 'absolute', left: '206px', top: '86px', width: '1508px', height: '908px', borderRadius: '16px',
    background: '#1C1B22', boxShadow: '0 60px 120px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.08)',
    overflow: 'hidden', transformOrigin: 'left center', opacity: 0
  });

  const bar = el('div', '', win);
  css(bar, { position: 'absolute', left: '0', top: '0', right: '0', height: '54px', background: 'linear-gradient(#2E2D37,#24232C)', display: 'flex', alignItems: 'center', gap: '10px', padding: '0 18px' });
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach(c => css(el('div', '', bar), { width: '14px', height: '14px', borderRadius: '50%', background: c, opacity: .9 }));

  const addr = el('div', '', bar);
  css(addr, { marginLeft: '18px', flex: '1', height: '34px', borderRadius: '8px', background: '#17161D', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: '19px', color: '#CFCAD6', letterSpacing: '.5px', fontFamily: 'Consolas, monospace' });
  const lock = el('span', '', addr, '🔒 ');
  css(lock, { fontSize: '14px', opacity: .5 });
  const url = el('span', '', addr);

  const body = el('div', '', win);
  css(body, { position: 'absolute', left: '0', top: '54px', right: '0', bottom: '0', background: '#0E0B09', overflow: 'hidden' });

  const loader = el('div', '', body);
  css(loader, { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '26px' });

  const cheese = el('div', '', loader);
  css(cheese, {
    width: '96px', height: '96px', borderRadius: '18px 18px 18px 4px',
    background: 'conic-gradient(from 20deg, #FFD25A, #F2A31B 70%, #FFD25A)',
    boxShadow: '0 0 60px rgba(255,198,58,.35)', position: 'relative'
  });
  [[26, 30, 14], [58, 52, 18], [30, 66, 10], [66, 22, 8]].forEach(([x, y, r]) => css(el('div', '', cheese), { position: 'absolute', left: x + 'px', top: y + 'px', width: r + 'px', height: r + 'px', borderRadius: '50%', background: '#24130A', opacity: .55 }));

  const pbar = el('div', '', loader);
  css(pbar, { width: '460px', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,.12)', overflow: 'hidden' });
  const pfill = el('div', '', pbar);
  css(pfill, { width: '0%', height: '100%', background: 'linear-gradient(90deg,#F2A31B,#FFD25A)' });

  const page = el('img', '', body);
  page.src = '../media/web/menu2.png';
  css(page, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', opacity: 0, transform: 'scale(1.06)' });

  const stamp = el('div', '', root, 'WEB&nbsp;PORT');
  css(stamp, {
    position: 'absolute', right: '122px', top: '122px', padding: '12px 22px', border: '5px solid #FFC63A', color: '#FFC63A',
    fontSize: '44px', fontWeight: 900, letterSpacing: '6px', transform: 'rotate(-9deg)', opacity: 0,
    textShadow: '0 0 24px rgba(255,198,58,.3)', mixBlendMode: 'screen'
  });

  const URL = 'lcspax.space/games/spymouse-web/';

  return (t) => {
    // window unfolds in
    const w = easeOut(inv(0, .6, t));
    win.style.opacity = 1;
    win.style.transform = `rotateY(${lerp(92, 0, w)}deg)`;

    // address typing
    const typed = Math.floor(inv(.75, 1.75, t) * URL.length);
    url.textContent = URL.slice(0, typed);
    const caret = (t > .7 && t < 1.85) ? (Math.floor(t * 6) % 2 ? '_' : ' ') : '';
    url.textContent += caret;

    // loading 1.75 -> 2.25
    const lp = inv(1.78, 2.3, t);
    pfill.style.width = `${easeOut(lp) * 100}%`;
    cheese.style.transform = `rotate(${lp * 300}deg) scale(${lerp(1, .8, lp)})`;
    cheese.style.opacity = 1 - inv(2.1, 2.3, t);
    loader.style.opacity = 1 - inv(2.1, 2.3, t);

    // page reveal
    const pr = easeOut(inv(2.12, 2.75, t));
    page.style.opacity = pr;
    page.style.transform = `scale(${lerp(1.06, 1, pr)})`;

    // stamp
    const sp = inv(2.55, 2.8, t);
    stamp.style.opacity = sp * .95;
    stamp.style.transform = `rotate(-9deg) scale(${lerp(1.8, 1, easeOutBack(sp))})`;

    // slow push
    const push = easeInOut(inv(2.2, 3.8, t));
    scene.style.transform = `scale(${lerp(1, 1.035, push)})`;
  };
});
