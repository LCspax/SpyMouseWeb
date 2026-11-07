import { defineShot, el, css, inv, lerp, easeOut, easeOutBack, easeInOut } from '../lib.js';

defineShot('S13', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(60% 70% at 55% 40%, #241726 0%, #120B16 58%, #050206 100%)' });

  const panel = el('div', '', root);
  css(panel, { position: 'absolute', left: '620px', top: '0', width: '1160px', height: '1080px', background: 'rgba(11,11,16,.72)', borderLeft: '1px solid rgba(255,255,255,.06)', borderRight: '1px solid rgba(255,255,255,.06)', overflow: 'hidden' });

  const head = el('div', '', panel);
  css(head, { position: 'absolute', left: '0', right: '0', top: '0', height: '120px', display: 'flex', alignItems: 'center', padding: '0 40px', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#0D0D12', zIndex: 5 });
  css(el('div', '', head, '‹'), { fontSize: '44px', color: '#fff', marginRight: '20px' });
  const ht = css(el('div', '', head, '间谍鼠 交流群'), { fontSize: '30px', fontWeight: 700, color: '#fff' });
  css(el('div', '', head, '482 人'), { marginLeft: '14px', fontSize: '18px', color: 'rgba(255,255,255,.4)' });

  const list = el('div', '', panel);
  css(list, { position: 'absolute', left: '0', right: '0', top: '120px', bottom: '0' });

  const MSG = [
    { who: '阿七', text: '能移植《割绳子》吗？', me: false },
    { who: '木木', text: '这个也能网页玩吗，求个链接', me: false },
    { who: '老K', text: '楼主还更新吗？', me: false },
    { who: '小满', text: '想玩《植物大战僵尸》老版', me: false },
    { who: '我', text: '安排。', me: true },
  ];

  const rows = MSG.map((m, i) => {
    const row = el('div', '', list);
    css(row, { position: 'absolute', left: '40px', right: '40px', top: (40 + i * 132) + 'px', display: 'flex', gap: '16px', alignItems: 'flex-start', justifyContent: m.me ? 'flex-end' : 'flex-start' });
    const av = css(el('div', '', row, m.who.slice(0, 1)), { width: '58px', height: '58px', borderRadius: '50%', background: m.me ? '#3A2A12' : '#23232B', color: '#FFD98A', fontSize: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: '1px solid rgba(255,255,255,.08)' });
    const b = css(el('div', '', row), { maxWidth: '520px', padding: '18px 24px', borderRadius: '14px', background: m.me ? 'linear-gradient(160deg,#5A421C,#3A2A12)' : '#1B1B23', fontSize: '28px', lineHeight: '1.45', color: '#F0E9DC', border: m.me ? '1px solid rgba(255,198,58,.35)' : '1px solid rgba(255,255,255,.06)' });
    b.innerHTML = m.me ? m.text : `<div style="font-size:16px;color:rgba(255,255,255,.42);margin-bottom:4px">${m.who}</div>${m.text}`;
    if (m.me) { row.appendChild(av); row.insertBefore(av, b); }
    return { row, m, i };
  });

  const typing = el('div', '', list);
  css(typing, { position: 'absolute', left: '40px', bottom: '240px', display: 'flex', gap: '8px', padding: '16px 22px', borderRadius: '14px', background: '#1B1B23', opacity: 0 });
  [0, 1, 2].forEach(i => css(el('div', '', typing), { width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(255,255,255,.5)' }));

  const input = el('div', '', panel);
  css(input, { position: 'absolute', left: '40px', right: '40px', bottom: '150px', height: '74px', borderRadius: '16px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', padding: '0 26px', fontSize: '24px', color: 'rgba(255,255,255,.35)' });
  input.textContent = '说点什么…';
  const send = css(el('div', '', input, '发送'), { marginLeft: 'auto', padding: '8px 20px', borderRadius: '8px', background: 'rgba(255,198,58,.2)', color: '#FFC63A', fontSize: '20px' });

  const caption = el('div', '', root, '你一句话，<br>就是下一个坑。');
  css(caption, { position: 'absolute', left: '120px', top: '300px', fontSize: '52px', fontWeight: 900, lineHeight: '1.5', color: '#FFF1D6', letterSpacing: '2px', textShadow: '5px 6px 0 rgba(0,0,0,.45)', opacity: 0 });

  return (t) => {
    // scroll up as messages appear
    const scroll = easeInOut(inv(.4, 5.0, t));
    list.style.transform = `translateY(${lerp(110, -30, scroll)}px)`;

    rows.forEach(({ row, m }, i) => {
      const d = [.9, 2.1, 3.5, 4.7, 5.95][i];
      row.style.opacity = inv(d, d + .3, t);
      row.style.transform = `translateY(${lerp(26, 0, easeOut(inv(d, d + .4, t)))}px) scale(${lerp(.97, 1, easeOut(inv(d, d + .4, t)))})`;
    });

    const ty = inv(5.15, 5.4, t);
    typing.style.opacity = ty * (1 - inv(5.5, 5.7, t));
    if (ty > 0) { [...typing.children].forEach((d, i) => { d.style.transform = `translateY(${Math.sin(t * 8 + i) * 5}px)`; }); }

    // "安排。" lands at 3.0
    const sendK = inv(5.5, 5.85, t);
    send.style.transform = `scale(${lerp(1, 1.06, sendK)})`;
    send.style.background = sendK > .4 ? 'rgba(255,198,58,.4)' : 'rgba(255,198,58,.2)';

    caption.style.opacity = inv(.15, .75, t);
    caption.style.transform = `translateX(${lerp(-26, 0, easeOut(inv(.15, .85, t)))}px)`;
  };
});
