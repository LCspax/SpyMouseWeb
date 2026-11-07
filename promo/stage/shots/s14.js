import { defineShot, el, css, inv, lerp, easeOut, easeOutBack, easeInOut } from '../lib.js';

defineShot('S14', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(60% 65% at 50% 42%, #4A2A14 0%, #24130A 55%, #0A0503 100%)' });

  /* ---------------- phase 1: like + share */
  const p1 = el('div', '', root);
  css(p1, { position: 'absolute', inset: '0' });

  const ghost = el('img', '', p1);
  ghost.src = '../../assets/menu/logo.png';
  css(ghost, { position: 'absolute', left: '50%', top: '104px', width: '440px', transform: 'translateX(-50%)', opacity: .13, filter: 'grayscale(1) brightness(1.6)' });

  const kicker = el('div', '', p1, 'THANKS FOR WATCHING');
  css(kicker, { position: 'absolute', left: '50%', top: '382px', transform: 'translateX(-50%)', fontFamily: 'Consolas, monospace', fontSize: '20px', letterSpacing: '9px', color: 'rgba(255,214,150,.55)' });

  const like = el('div', '', p1);
  css(like, { position: 'absolute', left: '50%', top: '482px', transform: 'translate(-50%,-50%)', width: '420px', height: '150px', borderRadius: '999px', background: 'linear-gradient(160deg,#FFD25A,#F2A31B)', boxShadow: '0 24px 60px rgba(242,163,27,.35), inset 0 -8px 0 rgba(140,70,10,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '22px' });

  const heart = el('div', '', like);
  css(heart, { width: '74px', height: '74px', position: 'relative' });
  heart.innerHTML = '<svg viewBox="0 0 24 24" width="74" height="74"><path d="M12 21s-8.5-5.4-8.5-11.2A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.5 3.4C20.5 15.6 12 21 12 21z" fill="#7A2E12"/></svg>';

  css(el('div', '', like, '点赞'), { fontSize: '52px', fontWeight: 900, color: '#6B2A0E', letterSpacing: '6px' });

  const count = el('div', '', p1, '1.2w');
  css(count, { position: 'absolute', left: '50%', top: '596px', transform: 'translateX(-50%)', fontSize: '40px', fontWeight: 700, color: 'rgba(255,236,200,.75)', letterSpacing: '3px' });

  const particles = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + .3;
    const p = css(el('div', '', p1), { position: 'absolute', left: '960px', top: '482px', width: (8 + (i % 4) * 5) + 'px', height: (8 + (i % 4) * 5) + 'px', borderRadius: i % 3 === 0 ? '50%' : '3px', background: i % 4 === 0 ? '#FFF3C4' : (i % 4 === 1 ? '#FFC63A' : '#F26B2A'), opacity: 0 });
    particles.push({ p, a, d: .6 + (i % 5) * .08, r: 160 + (i % 6) * 55 });
  }

  const avatars = [0, 1, 2].map(i => {
    const a = css(el('div', '', p1), { position: 'absolute', left: (660 + i * 240) + 'px', top: '700px', width: '112px', height: '112px', borderRadius: '50%', background: ['#2E5AAC', '#8A4A1C', '#4A7A32'][i], border: '4px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '42px', color: '#fff', opacity: 0, boxShadow: '0 20px 40px rgba(0,0,0,.45)' });
    a.textContent = ['阿', '木', '七'][i];
    return a;
  });

  const avCap = el('div', '', p1, '阿 · 木 · 七 已经在玩');
  css(avCap, { position: 'absolute', left: '50%', top: '844px', transform: 'translateX(-50%)', fontSize: '24px', letterSpacing: '4px', color: 'rgba(255,236,200,.55)', opacity: 0 });

  const shareCard = el('div', '', p1);
  css(shareCard, { position: 'absolute', left: '1400px', top: '704px', width: '300px', height: '180px', borderRadius: '14px', background: 'linear-gradient(150deg,#FFF6E0,#EBD8AE)', boxShadow: '0 30px 60px rgba(0,0,0,.55)', opacity: 0, padding: '18px' });
  css(el('div', '', shareCard, 'SPY MOUSE'), { fontSize: '26px', fontWeight: 900, color: '#8A4A12', letterSpacing: '2px' });
  css(el('div', '', shareCard, '网页版 · 点开就玩'), { marginTop: '8px', fontSize: '20px', color: '#6B4A26' });
  css(el('div', '', shareCard, 'lcspax.space'), { marginTop: '16px', fontSize: '16px', color: '#9A7A4A', fontFamily: 'Consolas, monospace' });

  /* ---------------- phase 2: end card */
  const p2 = el('div', '', root);
  css(p2, { position: 'absolute', inset: '0', opacity: 0, background: 'radial-gradient(55% 60% at 50% 45%, #5A3418 0%, #2A160C 55%, #0A0503 100%)' });

  const logo = el('img', '', p2);
  logo.src = '../../assets/menu/logo.png';
  css(logo, { position: 'absolute', left: '50%', top: '176px', width: '500px', transform: 'translateX(-50%)', filter: 'drop-shadow(0 22px 34px rgba(0,0,0,.55))' });

  const cnWrap = el('div', '', p2);
  css(cnWrap, { position: 'absolute', left: '50%', top: '500px', transform: 'translateX(-50%)', opacity: 0 });
  css(el('div', 'cn-title-ol', cnWrap, '网页版'), { position: 'absolute', left: '0', top: '0', fontSize: '96px', letterSpacing: '10px' });
  css(el('div', 'cn-title', cnWrap, '网页版'), { fontSize: '96px', letterSpacing: '10px' });

  const line1 = el('div', '', p2, '抖音主页群 · 自取试玩链接');
  css(line1, { position: 'absolute', left: '50%', top: '648px', transform: 'translateX(-50%)', fontSize: '40px', fontWeight: 700, color: '#FFE3A8', letterSpacing: '4px' });

  const line2 = el('div', '', p2, '不用装包 · 手机 / 平板 / 电脑');
  css(line2, { position: 'absolute', left: '50%', top: '712px', transform: 'translateX(-50%)', fontSize: '26px', color: 'rgba(255,236,200,.55)', letterSpacing: '3px' });

  const bye = el('div', 'stamp gold', p2, '下期见');
  css(bye, { right: '150px', top: '700px', width: '190px', height: '190px', fontSize: '42px', color: '#FFC63A', borderColor: '#FFC63A', opacity: 0, transform: 'rotate(-8deg)' });

  const rule = el('div', '', p2);
  css(rule, { position: 'absolute', left: '50%', top: '624px', width: '0px', height: '3px', marginLeft: '-180px', background: 'rgba(255,198,58,.6)' });

  return (t) => {
    /* phase 1 */
    const p1o = 1 - inv(7.15, 7.6, t);
    p1.style.opacity = p1o;
    p1.style.transform = `scale(${lerp(1, 1.06, inv(0, 7.15, t))})`;

    const press = Math.max(0, Math.sin(clamp01((t - 2.55) / .45) * Math.PI));
    like.style.transform = `translate(-50%,-50%) scale(${1 - .10 * press})`;
    like.style.boxShadow = `0 24px 60px rgba(242,163,27,${.35 + .3 * press}), inset 0 -8px 0 rgba(140,70,10,.25)`;

    const pop = inv(2.85, 3.15, t);
    heart.style.transform = `scale(${lerp(1, 1.25, easeOutBack(pop))}) rotate(${lerp(0, -8, pop)}deg)`;

    particles.forEach(({ p, a, d, r }) => {
      const ph = inv(2.85, 2.85 + d, t);
      if (ph <= 0) { p.style.opacity = 0; return; }
      const dist = easeOut(ph) * r;
      p.style.opacity = (1 - ph) * .95;
      p.style.transform = `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist - 40 * ph}px) scale(${1 - ph * .4})`;
    });

    count.textContent = t > 3.05 ? '1.3w' : '1.2w';
    count.style.color = t > 3.05 ? '#FFC63A' : 'rgba(255,236,200,.75)';
    count.style.transform = `translateX(-50%) scale(${t > 3.05 && t < 3.55 ? 1 + .12 * Math.sin((t - 3.05) * 16) : 1})`;

    shareCard.style.opacity = inv(4.15, 4.45, t) * (1 - inv(7.35, 7.7, t));
    shareCard.style.transform = `translate(${lerp(0, 40, easeInOut(inv(4.3, 7.2, t)))}px, ${lerp(0, 96, easeInOut(inv(4.3, 7.2, t)))}px) rotate(${lerp(5, -6, easeInOut(inv(4.3, 7.2, t)))}deg) scale(${lerp(.86, .78, easeInOut(inv(4.3, 7.2, t)))})`;

    avatars.forEach((a, i) => {
      a.style.opacity = inv(5.1 + i * .12, 5.4 + i * .12, t);
      a.style.transform = `scale(${lerp(.6, 1, easeOutBack(inv(5.1 + i * .12, 5.5 + i * .12, t)))})`;
    });
    avCap.style.opacity = inv(5.7, 6.1, t);
    kicker.style.opacity = inv(.15, .6, t);
    ghost.style.opacity = lerp(.0, .13, inv(.1, .9, t));

    /* phase 2 */
    const p2k = inv(7.25, 8.1, t);
    p2.style.opacity = p2k;
    logo.style.transform = `translateX(-50%) translateY(${lerp(30, 0, easeOut(p2k))}px) scale(${lerp(.94, 1, easeOut(p2k))})`;
    cnWrap.style.opacity = inv(7.55, 8.05, t);
    cnWrap.style.transform = `translateX(-50%) translateY(${lerp(20, 0, easeOut(inv(7.55, 8.2, t)))}px)`;
    line1.style.opacity = inv(7.9, 8.4, t);
    line1.style.transform = `translateX(-50%) translateY(${lerp(16, 0, easeOut(inv(7.9, 8.5, t)))}px)`;
    line2.style.opacity = inv(8.1, 8.6, t);
    line2.style.transform = `translateX(-50%) translateY(${lerp(16, 0, easeOut(inv(8.1, 8.75, t)))}px)`;
    rule.style.width = `${lerp(0, 360, easeOut(inv(7.95, 8.7, t)))}px`;

    const b = inv(8.85, 9.2, t);
    bye.style.opacity = b * .92;
    bye.style.transform = `rotate(-8deg) scale(${lerp(1.9, 1, easeOutBack(b))})`;
  };
});

const clamp01 = v => Math.max(0, Math.min(1, v));
