import { defineShot, el, css, inv, lerp, easeOut, easeInOut, easeOutBack } from '../lib.js';

defineShot('S12', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(60% 65% at 42% 46%, #2A1A2E 0%, #140C18 55%, #060307 100%)' });

  const phone = el('div', '', root);
  css(phone, { position: 'absolute', left: '286px', top: '96px', width: '486px', height: '830px', borderRadius: '46px', background: '#08080B', padding: '12px', boxShadow: '0 50px 120px rgba(0,0,0,.8), inset 0 0 0 2px rgba(255,255,255,.10)', overflow: 'hidden' });

  const screen = el('div', '', phone);
  css(screen, { position: 'absolute', inset: '12px', borderRadius: '36px', overflow: 'hidden', background: '#0B0B0F' });

  // ---------- profile screen
  const prof = el('div', '', screen);
  css(prof, { position: 'absolute', inset: '0' });

  const status = el('div', '', prof, '9:41');
  css(status, { position: 'absolute', left: '28px', top: '16px', fontSize: '17px', fontWeight: 700, color: '#fff' });
  css(el('div', '', prof, '▮▮▮  ⌁'), { position: 'absolute', right: '26px', top: '16px', fontSize: '14px', color: '#fff', letterSpacing: '2px' });

  css(el('div', '', prof, '我'), { position: 'absolute', left: '26px', top: '56px', fontSize: '26px', fontWeight: 700, color: '#fff' });
  css(el('div', '', prof, '⚙'), { position: 'absolute', right: '28px', top: '56px', fontSize: '24px', color: 'rgba(255,255,255,.8)' });

  const av = el('div', '', prof);
  css(av, { position: 'absolute', left: '28px', top: '110px', width: '104px', height: '104px', borderRadius: '50%', overflow: 'hidden', border: '2px solid rgba(255,255,255,.85)', background: '#2A1608' });
  const avImg = el('img', '', av);
  avImg.src = '../../assets/menu/mm_mouse.png';
  css(avImg, { width: '100%', height: '100%', objectFit: 'contain', transform: 'scale(1.08) translateY(4%)' });

  css(el('div', '', prof, 'LCspax'), { position: 'absolute', left: '150px', top: '124px', fontSize: '30px', fontWeight: 700, color: '#fff' });
  css(el('div', '', prof, '抖音号：spymouse_web'), { position: 'absolute', left: '150px', top: '166px', fontSize: '15px', color: 'rgba(255,255,255,.5)' });
  css(el('div', '', prof, '把 2011 年的《间谍鼠》搬进浏览器。<br>不装包，点开就玩。'), { position: 'absolute', left: '28px', top: '232px', width: '420px', fontSize: '17px', lineHeight: '1.6', color: 'rgba(255,255,255,.78)' });

  const stats = el('div', '', prof, '<b>12</b> 关注&nbsp;&nbsp;&nbsp;<b>1.2w</b> 粉丝&nbsp;&nbsp;&nbsp;<b>8.6w</b> 获赞');
  css(stats, { position: 'absolute', left: '28px', top: '300px', fontSize: '17px', color: 'rgba(255,255,255,.6)' });
  stats.querySelectorAll('b').forEach(b => { b.style.color = '#fff'; b.style.fontSize = '22px'; b.style.marginRight = '2px'; });

  const btnRow = el('div', '', prof);
  css(btnRow, { position: 'absolute', left: '28px', top: '348px', display: 'flex', gap: '12px' });
  const edit = css(el('div', '', btnRow, '编辑资料'), { padding: '9px 22px', borderRadius: '8px', background: 'rgba(255,255,255,.12)', fontSize: '16px', color: '#fff' });
  const grpBtn = css(el('div', '', btnRow, '群聊'), { padding: '9px 26px', borderRadius: '8px', background: 'rgba(255,255,255,.12)', fontSize: '16px', color: '#fff', position: 'relative' });
  const grpGlow = css(el('div', '', grpBtn), { position: 'absolute', inset: '-4px', borderRadius: '12px', border: '2px solid rgba(255,198,58,.9)', opacity: 0, boxShadow: '0 0 26px rgba(255,198,58,.45)' });

  const tabs = el('div', '', prof);
  css(tabs, { position: 'absolute', left: '0', right: '0', top: '414px', display: 'flex', borderBottom: '1px solid rgba(255,255,255,.08)' });
  ['作品 128', '私密', '喜欢'].forEach((s, i) => {
    const t = css(el('div', '', tabs, s), { flex: '1', textAlign: 'center', padding: '14px 0', fontSize: '17px', color: i === 0 ? '#fff' : 'rgba(255,255,255,.5)', fontWeight: i === 0 ? 700 : 400, position: 'relative' });
    if (i === 0) css(el('div', '', t), { position: 'absolute', left: '50%', bottom: '0', width: '34px', height: '3px', marginLeft: '-17px', background: '#fff', borderRadius: '2px' });
  });

  const grid = el('div', '', prof);
  css(grid, { position: 'absolute', left: '0', top: '466px', right: '0', bottom: '0', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '2px' });
  ['../../assets/menu/world-1.jpg', '../../assets/menu/world-3.jpg', '../media/web/menu.png', '../../assets/menu/world-5.jpg', '../../assets/menu/world-2.jpg', '../../assets/menu/world-6.jpg'].forEach((src, i) => {
    const c = css(el('div', '', grid), { background: '#15151A', overflow: 'hidden', position: 'relative' });
    const im = el('img', '', c);
    im.src = src; css(im, { width: '100%', height: '100%', objectFit: 'cover', opacity: .9 });
    css(el('div', '', c, String(1200 + i * 130)), { position: 'absolute', left: '8px', bottom: '6px', fontSize: '14px', color: '#fff', textShadow: '0 1px 4px #000' });
  });

  // ---------- group screen
  const grp = el('div', '', screen);
  css(grp, { position: 'absolute', inset: '0', background: '#0B0B0F', transform: 'translateY(100%)' });

  const gh = el('div', '', grp);
  css(gh, { position: 'absolute', left: '0', right: '0', top: '0', height: '88px', display: 'flex', alignItems: 'center', padding: '0 22px', borderBottom: '1px solid rgba(255,255,255,.07)' });
  css(el('div', '', gh, '‹'), { fontSize: '34px', color: '#fff', marginRight: '14px' });
  css(el('div', '', gh, '间谍鼠 交流群 <span style="color:rgba(255,255,255,.45);font-size:15px">(482)</span>'), { fontSize: '19px', fontWeight: 700, color: '#fff' });

  const pinCard = el('div', '', grp);
  css(pinCard, { position: 'absolute', left: '18px', right: '18px', top: '102px', padding: '18px', borderRadius: '12px', background: 'linear-gradient(150deg, rgba(255,198,58,.16), rgba(255,198,58,.04))', border: '1px solid rgba(255,198,58,.35)' });
  css(el('div', '', pinCard, '📌 群公告 · 试玩链接'), { fontSize: '14px', color: 'rgba(255,210,140,.8)', letterSpacing: '1px' });
  const link = css(el('div', '', pinCard, 'lcspax.space/games/spymouse-web/'), { marginTop: '8px', fontSize: '17px', color: '#FFD98A', fontFamily: 'Consolas, monospace' });
  const copyBtn = css(el('div', '', pinCard, '复制链接'), { marginTop: '12px', display: 'inline-block', padding: '7px 18px', borderRadius: '6px', background: '#FFC63A', color: '#221204', fontSize: '15px', fontWeight: 700 });

  const msgs = [
    { who: '阿七', text: '终于能玩了，泪目', me: false, t: 0 },
    { who: '木木', text: '手机上也能直接开？', me: false, t: 1 },
    { who: '我', text: '可以，浏览器打开就行', me: true, t: 2 },
  ].map(m => {
    const row = el('div', '', grp);
    css(row, { position: 'absolute', left: '18px', right: '18px', top: '300px', display: 'flex', gap: '10px', alignItems: 'flex-start' });
    const a = css(el('div', '', row, m.who.slice(0, 1)), { width: '34px', height: '34px', borderRadius: '50%', background: m.me ? '#3A2A12' : '#23232B', color: '#FFD98A', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' });
    const b = css(el('div', '', row), { maxWidth: '300px', padding: '10px 14px', borderRadius: '10px', background: m.me ? '#3A2A12' : '#1C1C24', fontSize: '16px', lineHeight: '1.45', color: '#EDE7DC' });
    b.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:3px">${m.who}</div>${m.text}`;
    return { row, m };
  });

  const toast = el('div', '', grp, '✓ 已复制');
  css(toast, { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%) scale(.8)', padding: '14px 30px', borderRadius: '10px', background: 'rgba(20,20,26,.96)', border: '1px solid rgba(255,255,255,.14)', fontSize: '20px', color: '#8BE28B', opacity: 0, fontWeight: 700 });

  // ---------- right callouts
  const callout = (text, x, y, d) => {
    const c = el('div', '', root);
    css(c, { position: 'absolute', left: x + 'px', top: y + 'px', display: 'flex', alignItems: 'center', gap: '18px', opacity: 0 });
    const line = css(el('div', '', c), { width: '0px', height: '2px', background: 'rgba(255,198,58,.7)' });
    const tx = css(el('div', '', c, text), { fontSize: '42px', fontWeight: 900, color: '#FFC63A', letterSpacing: '3px', textShadow: '4px 5px 0 rgba(0,0,0,.5)', whiteSpace: 'nowrap' });
    return { c, line, tx, d };
  };
  const c1 = callout('主页群', 900, 404, .55);
  const c2 = callout('试玩链接', 900, 600, 2.2);

  const hint = el('div', '', root, '不折腾，<br>点开就是游戏。');
  css(hint, { position: 'absolute', left: '960px', top: '700px', fontSize: '40px', lineHeight: '1.5', color: 'rgba(255,240,215,.65)', fontWeight: 700, letterSpacing: '2px', opacity: 0 });

  return (t) => {
    const pin = inv(0, .6, t);
    phone.style.opacity = inv(0, .4, t);
    phone.style.transform = `translateY(${lerp(50, 0, easeOut(pin))}px)`;

    // group button pulse
    grpGlow.style.opacity = inv(.85, 1.25, t) * (.55 + .45 * Math.sin(t * 5));
    grpGlow.style.transform = `scale(${1 + .04 * Math.sin(t * 5)})`;

    // open group at 2.6
    const open = easeInOut(inv(1.15, 1.8, t));
    grp.style.transform = `translateY(${lerp(100, 0, open)}%)`;

    msgs.forEach(({ row, m }, i) => {
      row.style.top = `${300 + i * 86}px`;
      row.style.opacity = inv(1.9 + i * .3, 2.3 + i * .3, t);
      row.style.transform = `translateY(${lerp(18, 0, easeOut(inv(1.9 + i * .3, 2.4 + i * .3, t)))}px)`;
    });

    // copy at 5.2
    const cp = inv(2.7, 2.9, t);
    copyBtn.style.transform = `scale(${1 - .08 * Math.sin(clamp01((t - 2.7) * 8) * Math.PI)})`;
    copyBtn.style.background = cp > .5 ? '#8BE28B' : '#FFC63A';
    copyBtn.textContent = cp > .5 ? '已复制 ✓' : '复制链接';
    toast.style.opacity = inv(2.9, 3.1, t) * (1 - inv(3.45, 3.7, t));
    toast.style.transform = `translate(-50%,-50%) scale(${lerp(.8, 1, easeOutBack(inv(2.9, 3.2, t)))})`;

    [c1, c2].forEach((c, i) => {
      const k = inv(c.d, c.d + .45, t);
      c.c.style.opacity = inv(c.d, c.d + .2, t);
      c.line.style.width = `${lerp(0, 54, easeOut(k))}px`;
      c.tx.style.opacity = k;
      c.tx.style.transform = `translateX(${lerp(-14, 0, easeOut(k))}px)`;
    });

    hint.style.opacity = inv(2.0, 2.5, t);
  };
});

const clamp01 = v => Math.max(0, Math.min(1, v));
