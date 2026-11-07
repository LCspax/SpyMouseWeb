import { defineShot, el, css, inv, lerp, easeOut, easeInOut } from '../lib.js';

defineShot('S10', (root) => {
  const wrap = el('div', '', root);
  css(wrap, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#0A0704' });

  const v = el('video', '', wrap);
  v.src = '../media/web/clean_crop.mp4'; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.dataset.start = 6.4; v.dataset.rate = 0.85;
  css(v, { position: 'absolute', left: '-2%', top: '-1%', width: '104%', height: '102%', objectFit: 'cover', filter: 'saturate(.95) brightness(.78) contrast(1.05)' });

  const wash = el('div', '', root);
  css(wash, { position: 'absolute', inset: '0', background: 'linear-gradient(180deg, rgba(10,6,3,.55), rgba(10,6,3,.10) 40%, rgba(10,6,3,.70))' });

  const scan = el('div', '', root);
  css(scan, { position: 'absolute', left: '0', right: '0', height: '260px', background: 'linear-gradient(rgba(255,198,58,0), rgba(255,198,58,.10), rgba(255,198,58,0))', mixBlendMode: 'screen' });

  const kicker = el('div', '', root, 'WORLD MAP / 关卡进度');
  css(kicker, { position: 'absolute', left: '112px', top: '88px', padding: '10px 18px', background: 'rgba(10,6,3,.62)', borderLeft: '3px solid rgba(255,198,58,.7)', fontSize: '22px', letterSpacing: '7px', color: 'rgba(255,214,150,.85)', fontWeight: 700, fontFamily: 'Consolas, monospace' });

  const panel = el('div', '', root);
  css(panel, { position: 'absolute', left: '110px', bottom: '176px', width: '780px', padding: '30px 36px 26px', background: 'rgba(14,8,4,.82)', border: '1px solid rgba(255,198,58,.28)', borderRadius: '10px', boxShadow: '0 30px 60px rgba(0,0,0,.45)' });

  css(el('div', '', panel, '关卡完成度'), { fontSize: '24px', letterSpacing: '6px', color: 'rgba(255,222,170,.72)', fontWeight: 700 });
  const bigRow = css(el('div', '', panel), { display: 'flex', alignItems: 'flex-end', gap: '14px', marginTop: '4px' });
  const pct = css(el('div', '', bigRow, '0'), { fontSize: '104px', fontWeight: 900, lineHeight: '1', color: '#FFC63A', textShadow: '5px 6px 0 rgba(0,0,0,.5)', fontVariantNumeric: 'tabular-nums' });
  css(el('div', '', bigRow, '%'), { fontSize: '40px', fontWeight: 900, color: 'rgba(255,198,58,.75)', paddingBottom: '12px' });

  const barWrap = css(el('div', '', panel), { marginTop: '10px', height: '12px', borderRadius: '6px', background: 'rgba(255,255,255,.12)', overflow: 'hidden' });
  const bar = css(el('div', '', barWrap), { width: '0%', height: '100%', background: 'linear-gradient(90deg,#F2A31B,#FFD25A)', boxShadow: '0 0 22px rgba(255,198,58,.5)' });

  css(el('div', '', panel, '门 · 桥 · 管道 · 大炮 · 电视 · 移动平台 · BOSS'), { marginTop: '14px', fontSize: '20px', letterSpacing: '2px', color: 'rgba(255,240,215,.58)' });

  return (t) => {
    const pan = easeInOut(inv(0, 4.0, t));
    v.style.transform = `scale(${lerp(1.04, 1.13, pan)}) translate(${lerp(0, -20, pan)}px, ${lerp(0, 12, pan)}px)`;
    scan.style.top = `${lerp(-20, 100, (t * .42) % 1)}%`;

    const p = easeInOut(inv(.4, 3.4, t));
    pct.textContent = String(Math.round(p * 92));
    bar.style.width = `${p * 92}%`;

    panel.style.opacity = inv(.15, .65, t);
    panel.style.transform = `translateY(${lerp(26, 0, easeOut(inv(.15, .8, t)))}px)`;
    kicker.style.opacity = inv(.1, .6, t);
  };
});
