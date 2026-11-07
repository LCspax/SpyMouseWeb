import { defineShot, el, css, inv, lerp, easeOut, easeOutBack, easeInOut } from '../lib.js';

defineShot('S07', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(60% 65% at 50% 42%, #5A3218 0%, #2A160C 55%, #0C0603 100%)' });

  const light = el('div', '', root);
  css(light, { position: 'absolute', left: '10%', top: '-30%', width: '80%', height: '120%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(255,210,140,.16), rgba(255,210,140,0) 70%)' });

  const stage = el('div', '', root);
  css(stage, { position: 'absolute', inset: '0' });

  function device(x, y, w, h, radius, pad, src, start, z) {
    const frame = el('div', '', stage);
    css(frame, {
      position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
      borderRadius: radius + 'px', background: 'linear-gradient(160deg,#1A1A20,#07070A)', padding: pad + 'px',
      boxShadow: '0 40px 80px rgba(0,0,0,.62), inset 0 0 0 2px rgba(255,255,255,.10)',
      zIndex: z, overflow: 'hidden'
    });
    const scr = el('div', '', frame);
    css(scr, { position: 'relative', width: '100%', height: '100%', borderRadius: (radius - pad) + 'px', overflow: 'hidden', background: '#000' });
    const v = el('video', '', scr);
    v.src = src; v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.dataset.start = start; v.dataset.rate = 1;
    css(v, { position: 'absolute', left: '-2.5%', top: '-2%', width: '105%', height: '104%', objectFit: 'cover', filter: 'saturate(1.05) contrast(1.04)' });
    return { frame, scr, v };
  }

  // laptop
  const lap = device(112, 250, 880, 495, 16, 14, '../media/web/clean_crop.mp4', 0.6, 1);
  const lapBase = el('div', '', stage);
  css(lapBase, { position: 'absolute', left: '72px', top: '741px', width: '960px', height: '20px', background: 'linear-gradient(#3A3A42,#17171C)', borderRadius: '0 0 16px 16px', boxShadow: '0 22px 44px rgba(0,0,0,.6)', zIndex: 2 });
  css(el('div', '', stage), { position: 'absolute', left: '492px', top: '741px', width: '80px', height: '7px', background: '#0A0A0E', borderRadius: '0 0 8px 8px', zIndex: 3 });

  // tablet
  const tab = device(1252, 262, 470, 352, 22, 15, '../media/web/clean_crop.mp4', 20.0, 1);

  // phone (front)
  const phone = device(872, 522, 250, 452, 34, 11, '../media/web/clean_crop.mp4', 40.0, 5);
  css(el('div', '', phone.frame), { position: 'absolute', left: '89px', top: '12px', width: '72px', height: '18px', borderRadius: '10px', background: '#07070A', zIndex: 4 });

  // labels
  const lbls = [
    { text: '电脑', x: 552, y: 812, d: 1.0 },
    { text: '平板', x: 1487, y: 646, d: .8 },
    { text: '手机', x: 997, y: 1006, d: .6 },
  ].map(o => {
    const n = el('div', '', root, o.text);
    css(n, { position: 'absolute', left: o.x + 'px', top: o.y + 'px', transform: 'translate(-50%,-50%)', padding: '8px 22px', borderRadius: '999px', background: 'rgba(12,7,3,.78)', border: '1px solid rgba(255,198,58,.35)', color: '#FFE3A8', fontSize: '24px', fontWeight: 700, letterSpacing: '4px', opacity: 0, zIndex: 10 });
    return { ...o, n };
  });

  const banner = el('div', '', root);
  css(banner, { position: 'absolute', left: '50%', top: '104px', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '18px', padding: '14px 40px', border: '2px solid rgba(255,198,58,.5)', borderRadius: '6px', background: 'rgba(14,8,4,.6)', opacity: 0 });
  css(el('div', '', banner, '无需安装'), { fontSize: '30px', fontWeight: 900, color: '#FFC63A', letterSpacing: '4px' });
  css(el('div', '', banner, '·'), { fontSize: '28px', color: 'rgba(255,198,58,.5)' });
  css(el('div', '', banner, '打开就玩'), { fontSize: '30px', fontWeight: 900, color: '#FFF1CE', letterSpacing: '4px' });

  return (t) => {
    const push = easeInOut(inv(0, 4.4, t));
    stage.style.transform = `scale(${lerp(1.0, 1.025, push)})`;

    const pop = (node, delay) => {
      const k = inv(delay, delay + .55, t);
      node.style.opacity = inv(delay, delay + .2, t);
      node.style.transform = `translateY(${lerp(70, 0, easeOutBack(k))}px)`;
    };
    pop(lap.frame, 0); pop(lapBase, 0); pop(tab.frame, .10); pop(phone.frame, .20);

    lbls.forEach(l => {
      l.n.style.opacity = inv(l.d, l.d + .3, t);
      l.n.style.transform = `translate(-50%,-50%) translateY(${lerp(16, 0, easeOut(inv(l.d, l.d + .35, t)))}px)`;
    });

    const bk = inv(2.3, 3.1, t);
    banner.style.opacity = inv(2.3, 2.6, t);
    banner.style.transform = `translateX(-50%) translateY(${lerp(-20, 0, easeOut(bk))}px)`;
  };
});
