import { defineShot, el, css, inv, lerp, easeOut, easeOutBack, easeInOut } from '../lib.js';

defineShot('S11', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(70% 70% at 50% 40%, #6B4423 0%, #3A2312 55%, #150C06 100%)' });

  const cork = el('div', '', root);
  css(cork, {
    position: 'absolute', inset: '0', opacity: .5,
    backgroundImage: 'radial-gradient(2px 2px at 20% 30%, rgba(0,0,0,.35), transparent 60%),radial-gradient(2px 2px at 70% 60%, rgba(0,0,0,.3), transparent 60%),radial-gradient(1px 1px at 40% 80%, rgba(255,220,170,.25), transparent 60%),radial-gradient(1px 1px at 85% 20%, rgba(255,220,170,.2), transparent 60%)',
    backgroundSize: '120px 90px, 160px 130px, 90px 70px, 70px 110px'
  });

  const head = el('div', '', root, '有 Bug？直接说。');
  css(head, { position: 'absolute', left: '120px', top: '96px', fontSize: '64px', fontWeight: 900, color: '#FFF3D8', letterSpacing: '2px', textShadow: '5px 6px 0 rgba(0,0,0,.45)' });

  const sub = el('div', '', root, '后续关卡有问题，欢迎反馈');
  css(sub, { position: 'absolute', left: '124px', top: '186px', fontSize: '26px', letterSpacing: '4px', color: 'rgba(255,226,180,.62)' });

  const notes = [
    { text: '3-2 关卡<br>走不到终点', x: 200, y: 410, rot: -4, d: .2 },
    { text: '某个道具<br>图标不显示', x: 700, y: 380, rot: 3.5, d: .55 },
    { text: 'BOSS 关<br>卡住了', x: 1220, y: 426, rot: -2.5, d: .9 },
  ].map(o => {
    const card = el('div', '', root);
    css(card, { position: 'absolute', left: o.x + 'px', top: o.y + 'px', width: '420px', height: '250px', background: 'linear-gradient(160deg,#FFF8E6,#EFE0BF)', borderRadius: '4px', boxShadow: '0 26px 50px rgba(0,0,0,.45)', transform: `rotate(${o.rot}deg)`, opacity: 0, padding: '46px 34px' });
    css(el('div', '', card, o.text), { fontSize: '36px', lineHeight: '1.45', fontWeight: 700, color: '#3A2614' });
    const pin = css(el('div', '', card), { position: 'absolute', left: '50%', top: '-14px', marginLeft: '-14px', width: '28px', height: '28px', borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #FF7A6A, #B3261E 70%)', boxShadow: '0 8px 12px rgba(0,0,0,.45)' });
    const tick = css(el('div', '', card), { position: 'absolute', right: '24px', bottom: '18px', fontSize: '40px', color: '#2E8B57', opacity: 0, transform: 'scale(.4)' });
    tick.textContent = '✓';
    return { ...o, card, pin, tick };
  });

  const foot = el('div', '', root);
  css(foot, { position: 'absolute', right: '120px', bottom: '110px', display: 'flex', alignItems: 'center', gap: '18px', opacity: 0 });
  css(el('div', '', foot, '欢迎反馈'), { fontSize: '54px', fontWeight: 900, color: '#FFD34F', letterSpacing: '4px', textShadow: '4px 5px 0 rgba(0,0,0,.55)' });
  css(el('div', '', foot, '→'), { fontSize: '54px', color: '#FFC63A' });

  return (t) => {
    notes.forEach((n, i) => {
      n.d = [.4, 2.5, 4.3][i];
      const k = inv(n.d, n.d + .55, t);
      n.card.style.opacity = inv(n.d, n.d + .2, t);
      n.card.style.transform = `rotate(${n.rot}deg) translateY(${lerp(-90, 0, easeOutBack(k))}px) scale(${lerp(1.06, 1, easeOut(k))})`;
      n.pin.style.transform = `scale(${lerp(1.8, 1, easeOutBack(k))})`;
      const tk = inv(n.d + 1.1, n.d + 1.45, t);
      n.tick.style.opacity = tk;
      n.tick.style.transform = `scale(${lerp(.4, 1, easeOutBack(tk))}) rotate(-8deg)`;
    });

    foot.style.opacity = inv(5.2, 5.7, t);
    foot.style.transform = `translateX(${lerp(26, 0, easeOut(inv(5.2, 5.8, t)))}px)`;

    head.style.opacity = inv(0, .35, t);
    sub.style.opacity = inv(.15, .5, t);
  };
});
