import { defineShot, el, css, inv, lerp, easeOut, easeInOut, easeOutBack } from '../lib.js';

defineShot('S04', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(60% 60% at 45% 42%, #22303A 0%, #141C22 52%, #080C0F 100%)' });

  const grid = el('div', '', root);
  css(grid, { position: 'absolute', inset: '0', backgroundImage: 'linear-gradient(rgba(160,200,220,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(160,200,220,.05) 1px,transparent 1px)', backgroundSize: '80px 80px', opacity: .8 });

  const group = el('div', '', root);
  css(group, { position: 'absolute', inset: '0', transformOrigin: '30% 50%' });

  // ---- evidence monitor
  const card = el('div', '', group);
  css(card, { position: 'absolute', left: '176px', top: '96px', width: '548px', height: '884px', border: '2px solid rgba(190,215,225,.28)', borderRadius: '6px', overflow: 'hidden', background: '#05080A', boxShadow: '0 40px 90px rgba(0,0,0,.65), inset 0 0 80px rgba(0,0,0,.7)' });

  const v = el('video', '', card);
  v.src = '../media/ref/ipad2.mp4'; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.dataset.start = 150.0; v.dataset.rate = 1;
  css(v, { position: 'absolute', left: '4px', top: '-46px', width: '540px', height: '960px', objectFit: 'cover', filter: 'saturate(.72) contrast(1.08) brightness(.95)' });

  el('div', 'scan', card);
  const bandT = el('div', '', card);
  css(bandT, { position: 'absolute', left: '0', right: '0', top: '0', height: '76px', background: 'linear-gradient(rgba(0,0,0,.92), rgba(0,0,0,0))' });
  const bandB = el('div', '', card);
  css(bandB, { position: 'absolute', left: '0', right: '0', bottom: '0', height: '130px', background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.96))' });

  const rec = el('div', '', card, '● REC');
  css(rec, { position: 'absolute', left: '18px', top: '16px', fontSize: '20px', fontWeight: 700, letterSpacing: '3px', color: '#FF5A4A' });
  const meta = el('div', '', card, 'CAM 02 · 2012-06-11 · 18:42');
  css(meta, { position: 'absolute', right: '18px', top: '18px', fontSize: '15px', letterSpacing: '2px', color: 'rgba(190,220,230,.55)', fontFamily: 'Consolas, monospace' });
  const metaB = el('div', '', card, 'iPad 2 · iOS 6 · 已越狱');
  css(metaB, { position: 'absolute', left: '18px', bottom: '16px', fontSize: '17px', letterSpacing: '2px', color: 'rgba(190,220,230,.6)', fontFamily: 'Consolas, monospace' });

  // ---- right column text
  const col = el('div', '', group);
  css(col, { position: 'absolute', left: '810px', top: '150px', width: '700px' });

  const eyebrow = el('div', '', col, '要玩原版 · 只剩这些办法');
  css(eyebrow, { fontSize: '26px', letterSpacing: '7px', color: 'rgba(255,198,58,.78)', fontWeight: 700 });

  const big = el('div', '', col, 'iPad 2');
  css(big, { fontSize: '150px', lineHeight: '1.02', fontWeight: 900, letterSpacing: '2px', marginTop: '18px', color: '#F4F1EA', textShadow: '5px 6px 0 rgba(0,0,0,.55)' });

  const big2 = el('div', '', col, 'iOS 6');
  css(big2, { fontSize: '96px', lineHeight: '1.1', fontWeight: 900, color: '#FFC63A', textShadow: '4px 5px 0 rgba(0,0,0,.55)' });

  const jb = el('div', '', col, '已 越 狱');
  css(jb, { display: 'inline-block', marginTop: '26px', padding: '10px 22px', border: '4px solid #E03A2F', color: '#FF6A5E', fontSize: '38px', fontWeight: 900, letterSpacing: '6px', transform: 'rotate(-3deg)', opacity: 0 });

  const sub = el('div', '', col, '系统停在 2012 年，App Store 里早就搜不到了。');
  css(sub, { marginTop: '44px', fontSize: '30px', lineHeight: '1.65', color: 'rgba(235,240,242,.72)', fontWeight: 500, opacity: 0 });

  // ---- android card
  const aCard = el('div', '', group);
  css(aCard, { position: 'absolute', left: '1060px', top: '190px', width: '700px', height: '640px', background: 'linear-gradient(160deg, rgba(40,52,58,.96), rgba(18,24,28,.98))', border: '1px solid rgba(190,215,225,.18)', borderRadius: '10px', padding: '46px', boxShadow: '0 40px 80px rgba(0,0,0,.6)', opacity: 0 });

  const robot = el('div', '', aCard);
  css(robot, { width: '120px', height: '120px', position: 'relative', opacity: .8 });
  const head = el('div', '', robot);
  css(head, { position: 'absolute', left: '10px', top: '30px', width: '100px', height: '76px', borderRadius: '50% 50% 42% 42%', background: '#6FA83E' });
  [[24, 52], [62, 52]].forEach(([x, y]) => css(el('div', '', robot), { position: 'absolute', left: (10 + x) + 'px', top: (30 + y) + 'px', width: '12px', height: '12px', borderRadius: '50%', background: '#16200F' }));
  css(el('div', '', robot), { position: 'absolute', left: '26px', top: '6px', width: '4px', height: '26px', background: '#6FA83E', transform: 'rotate(-20deg)' });
  css(el('div', '', robot), { position: 'absolute', left: '92px', top: '6px', width: '4px', height: '26px', background: '#6FA83E', transform: 'rotate(20deg)' });

  const aTitle = el('div', '', aCard, 'Android ≤ 6.0');
  css(aTitle, { fontSize: '64px', fontWeight: 900, marginTop: '18px', color: '#E8EDF0', letterSpacing: '1px' });
  const aSub = el('div', '', aCard, '系统版本卡死 · 新机装不上 · 老机不好找');
  css(aSub, { fontSize: '26px', lineHeight: '1.7', marginTop: '16px', color: 'rgba(230,238,242,.6)' });

  const dead = el('div', '', aCard, '已停止支持');
  css(dead, { position: 'absolute', right: '40px', bottom: '38px', padding: '8px 18px', border: '3px solid #E03A2F', color: '#FF6A5E', fontSize: '28px', fontWeight: 900, letterSpacing: '4px', transform: 'rotate(-4deg)', opacity: 0 });

  const avail = el('div', '', aCard);
  css(avail, { position: 'absolute', left: '46px', bottom: '44px', display: 'flex', alignItems: 'center', gap: '14px', fontSize: '22px', color: 'rgba(230,238,242,.55)' });
  el('span', '', avail, '可玩性');
  const bar = css(el('div', '', avail), { width: '220px', height: '8px', background: 'rgba(255,255,255,.12)', borderRadius: '4px', overflow: 'hidden' });
  const barFill = css(el('div', '', bar), { width: '100%', height: '100%', background: 'linear-gradient(90deg,#6FA83E,#A8D46A)' });

  const fade = el('div', '', root);
  css(fade, { position: 'absolute', inset: '0', background: '#000', opacity: 0 });

  return (t) => {
    // phase A — iPad 2 / iOS 6 (the line about a jailbroken old iOS device)
    const rise = easeOut(inv(0, .5, t));
    card.style.transform = `translateY(${lerp(60, 0, rise)}px)`;
    card.style.opacity = inv(0, .35, t);

    eyebrow.style.opacity = inv(.1, .5, t);

    const b = easeOutBack(inv(.3, .95, t));
    big.style.opacity = inv(.3, .6, t);
    big.style.transform = `translateY(${lerp(30, 0, b)}px)`;
    big2.style.opacity = inv(.7, 1.05, t);
    big2.style.transform = `translateY(${lerp(24, 0, easeOut(inv(.7, 1.15, t)))}px)`;

    // the badge lands on the word for jailbreak
    jb.style.opacity = inv(4.05, 4.4, t) * .95;
    jb.style.transform = `rotate(-3deg) scale(${lerp(1.7, 1, easeOutBack(inv(4.05, 4.45, t)))})`;

    sub.style.opacity = inv(5.05, 5.65, t);
    sub.style.transform = `translateY(${lerp(18, 0, easeOut(inv(5.05, 5.65, t)))}px)`;

    // the iOS route dies during the pause after the sentence
    const gsA = inv(6.2, 7.3, t);
    v.style.filter = `saturate(${lerp(.72, .1, gsA)}) contrast(1.08) brightness(${lerp(.95, .62, gsA)})`;
    jb.style.opacity = inv(4.05, 4.4, t) * .95 * (1 - .5 * gsA);

    // phase B — the "Android 6.0 or below" card arrives with the next line
    const ph = easeInOut(inv(8.0, 8.85, t));
    group.style.transform = `translateX(${lerp(0, -120, ph)}px) scale(${lerp(1, .86, ph)})`;
    col.style.opacity = 1 - inv(7.85, 8.3, t);

    const ac = easeOutBack(inv(8.15, 8.95, t));
    aCard.style.opacity = inv(8.15, 8.5, t);
    aCard.style.transform = `translateX(${lerp(140, 0, ac)}px) rotate(${lerp(3, 1.2, ac)}deg)`;

    // grayscale + availability
    const gs = inv(9.5, 10.6, t);
    aCard.style.filter = `grayscale(${gs}) brightness(${lerp(1, .72, gs)})`;
    dead.style.opacity = inv(10.0, 10.4, t);
    dead.style.transform = `rotate(-4deg) scale(${lerp(1.6, 1, easeOutBack(inv(10.0, 10.4, t)))})`;
    barFill.style.width = `${lerp(100, 0, easeInOut(inv(9.7, 10.9, t)))}%`;
    barFill.style.background = '#E03A2F';

    // shake
    const sh = inv(9.9, 11.5, t);
    root.style.transform = `translate(${Math.sin(t * 47) * sh * 2.2}px, ${Math.cos(t * 39) * sh * 1.5}px)`;
  };
});
