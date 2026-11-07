import { defineShot, el, css, inv, lerp, easeOut, easeInOut } from '../lib.js';

defineShot('S05', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(70% 70% at 50% 40%, #13202E 0%, #0A1118 60%, #04070A 100%)' });

  const desk = el('div', '', root);
  css(desk, { position: 'absolute', inset: '0', backgroundImage: 'linear-gradient(rgba(120,170,200,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(120,170,200,.045) 1px,transparent 1px)', backgroundSize: '64px 64px' });

  const win = el('div', '', root);
  css(win, { position: 'absolute', left: '238px', top: '92px', width: '1444px', height: '896px', borderRadius: '8px', overflow: 'hidden', background: '#0B1218', boxShadow: '0 50px 120px rgba(0,0,0,.8), 0 0 0 1px rgba(160,200,220,.16)' });

  // titlebar
  const tb = el('div', '', win);
  css(tb, { position: 'absolute', left: '0', right: '0', top: '0', height: '48px', background: 'linear-gradient(#2C3D4E,#1D2A37)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '14px' });
  const tIcon = css(el('div', '', tb), { width: '20px', height: '20px', borderRadius: '4px', background: 'linear-gradient(#8CC63F,#5C8A2A)' });
  const tTxt = css(el('div', '', tb, 'Android Emulator 2.3.6 — SpyMouse.apk'), { fontSize: '19px', color: '#C8D6E2', fontWeight: 500 });
  const btns = css(el('div', '', tb), { marginLeft: 'auto', display: 'flex', gap: '22px', color: '#9FB2C2', fontSize: '20px' });
  ['—', '▢', '✕'].forEach((s, i) => css(el('div', '', btns, s), { color: i === 2 ? '#E06A5E' : '#9FB2C2' }));

  // inner screen
  const screen = el('div', '', win);
  css(screen, { position: 'absolute', left: '46px', top: '86px', width: '620px', height: '760px', borderRadius: '14px', background: '#05080B', border: '10px solid #1E2A35', overflow: 'hidden' });

  const scrImg = el('img', '', screen);
  scrImg.src = '../media/ref/game-1-1.png';
  css(scrImg, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(.55) brightness(.5) blur(1.2px)' });

  const boot = el('div', '', screen);
  css(boot, { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: '120px', gap: '18px', background: 'linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.72))' });
  const dots = css(el('div', '', boot, '正在启动…'), { fontSize: '24px', color: 'rgba(230,238,245,.7)', letterSpacing: '3px' });
  const dots2 = css(el('div', '', boot, 'API 10 · 兼容模式'), { fontSize: '15px', color: 'rgba(200,215,225,.4)', letterSpacing: '2px', fontFamily: 'Consolas, monospace' });
  if (dots2) dots2.style.opacity = 1;


  // sidebar stats
  const side = el('div', '', win);
  css(side, { position: 'absolute', left: '716px', top: '86px', width: '660px', height: '760px', padding: '40px 44px' });

  const kicker = el('div', '', side, '正在运行');
  css(kicker, { fontSize: '18px', letterSpacing: '6px', color: 'rgba(160,200,220,.5)', fontFamily: 'Consolas, monospace' });

  const rows = [
    ['CPU', '100%', 'cpu'],
    ['内存', '1.9 / 2.0 GB', 'mem'],
    ['温度', '89°C', 'temp'],
    ['已等待', '02:47:33', 'wait'],
  ];
  const vals = {};
  rows.forEach(([k, v, key]) => {
    const row = el('div', '', side);
    css(row, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '22px 0', borderBottom: '1px solid rgba(160,200,220,.10)' });
    css(el('div', '', row, k), { fontSize: '22px', color: 'rgba(200,215,225,.55)', letterSpacing: '2px' });
    vals[key] = css(el('div', '', row, v), { fontSize: '34px', fontWeight: 700, fontFamily: 'Consolas, monospace', color: '#CFE3F0' });
  });

  const warn = el('div', '', side, '⚠ 设备温度过高，正在降频');
  css(warn, { marginTop: '26px', fontSize: '22px', color: '#FF8A5E', letterSpacing: '1px', opacity: 0 });

  const hint = el('div', '', side, '等待时间越长，越不想玩了。');
  css(hint, { position: 'absolute', left: '44px', bottom: '40px', fontSize: '26px', color: 'rgba(200,215,225,.45)', fontWeight: 500 });

  // progress bar
  const pbox = el('div', '', win);
  css(pbox, { position: 'absolute', left: '46px', bottom: '14px', width: '1330px' });
  const plabel = css(el('div', '', pbox, '正在安装资源包… 87%'), { fontSize: '18px', color: 'rgba(190,210,225,.65)', marginBottom: '10px', fontFamily: 'Consolas, monospace', letterSpacing: '1px' });
  const pOuter = css(el('div', '', pbox), { width: '100%', height: '16px', background: 'rgba(255,255,255,.08)', borderRadius: '3px', overflow: 'hidden' });
  const pFill = css(el('div', '', pOuter), { width: '87%', height: '100%', backgroundImage: 'repeating-linear-gradient(115deg, #3E7FB0 0 22px, #2E5F86 22px 44px)', backgroundSize: '62px 100%' });

  // cursor
  const cur = el('div', '', root);
  css(cur, { position: 'absolute', left: '1500px', top: '760px', width: '34px', height: '44px', zIndex: 20, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.6))' });
  cur.innerHTML = `<svg viewBox="0 0 24 30" width="34" height="44"><path d="M2 2 L2 24 L8.5 18.5 L12.5 27 L17 25 L13 16.5 L21 16.2 Z" fill="#fff" stroke="#111" stroke-width="1.6"/></svg>`;

  const rings = [0, 1, 2, 3].map(() => {
    const r = css(el('div', '', root), { position: 'absolute', width: '54px', height: '54px', borderRadius: '50%', border: '2px solid rgba(255,255,255,.55)', opacity: 0, zIndex: 19 });
    return r;
  });

  // dialog
  const dlg = el('div', '', root);
  css(dlg, { position: 'absolute', left: '620px', top: '410px', width: '680px', height: '300px', borderRadius: '10px', background: 'linear-gradient(#28343F,#1B242C)', border: '1px solid rgba(180,210,230,.25)', boxShadow: '0 40px 100px rgba(0,0,0,.8)', opacity: 0, zIndex: 30, overflow: 'hidden' });
  css(el('div', '', dlg, 'Android Emulator 无响应'), { padding: '26px 32px 0', fontSize: '26px', fontWeight: 700, color: '#DCE8F0' });
  css(el('div', '', dlg, '程序没有响应。如果继续等待，程序可能会恢复响应。<br>如果你关闭此程序，会丢失当前数据。'), { padding: '20px 32px', fontSize: '21px', lineHeight: '1.7', color: 'rgba(210,225,235,.7)' });
  const dbtns = css(el('div', '', dlg), { position: 'absolute', right: '26px', bottom: '24px', display: 'flex', gap: '14px' });
  ['关闭程序', '等待'].forEach((s, i) => css(el('div', '', dbtns, s), { padding: '10px 26px', fontSize: '20px', borderRadius: '4px', border: '1px solid rgba(190,215,235,.35)', background: i === 1 ? '#3D6F9E' : 'rgba(255,255,255,.06)', color: '#DCE8F0' }));

  const black = el('div', '', root);
  css(black, { position: 'absolute', inset: '0', background: '#000', opacity: 0, zIndex: 40 });

  return (t) => {
    win.style.opacity = inv(0, .12, t);
    win.style.transform = `scale(${lerp(.985, 1, easeOut(inv(0, .6, t)))})`;

    // stripes crawl faster over time
    pFill.style.backgroundPosition = `${t * (120 + t * 40)}px 0`;

    // cursor path + clicks
    const cx = 1500 + Math.sin(t * 2.1) * 180 + Math.sin(t * 5.3) * 40;
    const cy = 760 + Math.cos(t * 1.7) * 120 + Math.cos(t * 4.1) * 26;
    cur.style.left = cx + 'px';
    cur.style.top = cy + 'px';
    const clickPhase = (t * 1.9) % 1;
    cur.style.transform = `scale(${1 - .12 * Math.max(0, 1 - clickPhase * 6)})`;
    rings.forEach((r, i) => {
      const ph = (t * 1.9 + i * .25) % 1;
      r.style.left = (cx + 10) + 'px';
      r.style.top = (cy + 14) + 'px';
      r.style.opacity = (1 - ph) * .5;
      r.style.transform = `translate(-50%,-50%) scale(${lerp(.3, 2.2, ph)})`;
    });

    // stats escalate
    const heat = inv(1.0, 4.4, t);
    vals.cpu.textContent = `${Math.round(lerp(72, 100, heat))}%`;
    vals.cpu.style.color = heat > .6 ? '#FF8A5E' : '#CFE3F0';
    vals.temp.textContent = `${Math.round(lerp(64, 89, heat))}°C`;
    vals.temp.style.color = heat > .5 ? '#FF6A4E' : '#CFE3F0';
    const secs = 10053 + Math.floor(t * 1);
    const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
    const mm = String(Math.floor(secs % 3600 / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    vals.wait.textContent = `${hh}:${mm}:${ss}`;
    vals.wait.style.color = 'rgba(255,200,150,.85)';
    vals.mem.textContent = `${lerp(1.6, 1.99, heat).toFixed(1)} / 2.0 GB`;

    warn.style.opacity = inv(4.9, 5.7, t) * (.6 + .4 * Math.sin(t * 7));
    hint.style.opacity = inv(6.3, 7.4, t);

    plabel.textContent = `正在安装资源包… 87%`;

    // unresponsive
    const un = inv(6.9, 7.3, t);
    tTxt.textContent = un > .5 ? 'Android Emulator 2.3.6 — SpyMouse.apk（未响应）' : 'Android Emulator 2.3.6 — SpyMouse.apk';
    tb.style.background = un > .5 ? 'linear-gradient(#4A2F2B,#2E1D1A)' : 'linear-gradient(#2C3D4E,#1D2A37)';

    const dn = inv(7.5, 7.9, t);
    dlg.style.opacity = dn;
    dlg.style.transform = `scale(${lerp(.92, 1, easeOut(dn))})`;

    // shaking grows
    const sh = inv(5.0, 8.8, t);
    root.style.transform = `translate(${Math.sin(t * 61) * sh * 2.2}px, ${Math.cos(t * 53) * sh * 1.6}px)`;

    black.style.opacity = 0;
  };
});
