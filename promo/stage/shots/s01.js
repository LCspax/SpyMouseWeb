import { defineShot, el, css, inv, lerp, easeOut, easeInOut, easeOutBack } from '../lib.js';

defineShot('S01', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(58% 62% at 68% 44%, #7A4220 0%, #3C1F10 46%, #180B05 100%)' });

  const beam = el('div', '', root);
  css(beam, { position: 'absolute', left: '-12%', top: '-35%', width: '78%', height: '170%', background: 'linear-gradient(105deg, rgba(255,214,140,.18), rgba(255,214,140,0) 58%)', filter: 'blur(12px)', transform: 'rotate(-6deg)' });

  const cam = el('div', '', root);
  css(cam, { position: 'absolute', inset: '0' });

  const paper = el('div', 'paper', cam);
  css(paper, { left: '792px', top: '128px', width: '996px', height: '806px', transform: 'rotate(2.2deg)', borderRadius: '6px' });

  css(el('div', 'tape', paper), { left: '368px', top: '-26px', transform: 'rotate(-4deg)' });
  css(el('div', 'tape', paper), { left: '-38px', top: '330px', transform: 'rotate(86deg)' });

  css(el('div', '', paper, 'CASE FILE <b>001</b>'), { position: 'absolute', left: '44px', top: '40px', fontSize: '28px', letterSpacing: '5px', color: '#7A5A33', fontWeight: 700 });
  css(el('div', '', paper, 'SPY MOUSE / 2011 / iOS · ANDROID'), { position: 'absolute', left: '44px', top: '80px', fontSize: '19px', letterSpacing: '3px', color: '#A08356', fontWeight: 500 });

  const photo = el('div', '', paper);
  css(photo, { position: 'absolute', left: '52px', top: '126px', width: '700px', height: '452px', background: '#fff', padding: '16px', transform: 'rotate(-2.6deg)', boxShadow: '0 22px 40px rgba(60,35,10,.35)' });
  const pv = el('div', 'crt', photo);
  css(pv, { position: 'absolute', left: '16px', top: '16px', width: '668px', height: '376px', background: '#000' });
  const v = el('video', '', pv);
  v.src = '../media/ref/trailer-21.mp4'; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.dataset.start = 8.2; v.dataset.rate = 1;
  css(v, { width: '100%', height: '100%', objectFit: 'cover' });
  el('div', 'scan', pv);
  css(el('div', '', photo, '2011 · 原版实机'), { position: 'absolute', left: '18px', bottom: '16px', fontSize: '22px', color: '#6B4A26', fontWeight: 700, letterSpacing: '2px' });

  const note = el('div', '', paper);
  css(note, { position: 'absolute', left: '786px', top: '140px', width: '176px', borderLeft: '3px solid #C9A468', paddingLeft: '18px' });
  el('div', '', note, '平台<br>iOS / ANDROID').style.cssText = 'font-size:21px;line-height:1.5;color:#6B4A26;font-weight:700;';
  el('div', '', note, '开发商<br>FIREMINT').style.cssText = 'font-size:21px;line-height:1.5;color:#6B4A26;font-weight:700;margin-top:20px;';
  el('div', '', note, '发行<br>ELECTRONIC ARTS').style.cssText = 'font-size:21px;line-height:1.5;color:#6B4A26;font-weight:700;margin-top:20px;';

  css(el('div', '', paper), { position: 'absolute', left: '52px', top: '592px', width: '870px', height: '2px', background: 'repeating-linear-gradient(90deg,#B79A6B 0 10px,transparent 10px 20px)', opacity: .7 });
  css(el('div', '', paper, '“画一条线，老鼠就会沿着走。”<br><span style="font-size:22px;color:#8A6A44">—— 当年最上头的触屏操作</span>'), { position: 'absolute', left: '52px', top: '620px', width: '880px', fontSize: '27px', lineHeight: '1.6', color: '#5C4227', fontWeight: 500 });

  const stamp = el('div', 'stamp', paper, '益智<br>解谜');
  css(stamp, { right: '34px', bottom: '26px', fontSize: '42px' });

  const logo = el('img', 'logo-img', cam);
  logo.src = '../../assets/menu/logo.png';
  css(logo, { position: 'absolute', left: '118px', top: '182px', width: '470px' });

  const cnWrap = el('div', '', cam);
  css(cnWrap, { position: 'absolute', left: '126px', top: '462px' });
  css(el('div', 'cn-title-ol', cnWrap, '间谍鼠'), { position: 'absolute', left: '0', top: '0' });
  css(el('div', 'cn-title', cnWrap, '间谍鼠'), { position: 'absolute', left: '0', top: '0' });

  css(el('div', '', cam, '2011 · EA · 益智小游戏'), { position: 'absolute', left: '132px', top: '636px', fontSize: '30px', letterSpacing: '8px', color: 'rgba(255,226,170,.72)', fontWeight: 700 });

  const rule = el('div', '', cam);
  css(rule, { position: 'absolute', left: '132px', top: '602px', width: '0px', height: '4px', background: 'var(--cheese)', boxShadow: '0 0 18px rgba(255,198,58,.6)' });

  return (t) => {
    const p = easeInOut(inv(0, 5.5, t));
    cam.style.transform = `scale(${lerp(1.0, 1.05, p)})`;
    paper.style.transform = `rotate(${lerp(3.6, 2.2, easeOut(inv(0, 1.3, t)))}deg) translateY(${lerp(28, 0, easeOut(inv(0, 1.0, t)))}px)`;
    paper.style.opacity = inv(0, .4, t);

    const tp = easeOutBack(inv(.1, .85, t));
    logo.style.opacity = inv(.05, .45, t);
    logo.style.transform = `translateY(${lerp(26, 0, tp)}px)`;
    cnWrap.style.opacity = inv(.3, .75, t);
    cnWrap.style.transform = `translateY(${lerp(30, 0, easeOut(inv(.3, .95, t)))}px) scale(${lerp(1.06, 1, easeOut(inv(.3, .95, t)))})`;
    rule.style.width = `${lerp(0, 470, easeOut(inv(.75, 1.4, t)))}px`;

    const st = inv(3.1, 3.28, t);
    stamp.style.opacity = st > 0 ? .95 * inv(3.1, 3.2, t) : 0;
    stamp.style.transform = `rotate(-14deg) scale(${lerp(2.3, 1, easeOutBack(st))})`;
    stamp.style.filter = st < 1 ? `blur(${(1 - st) * 5}px)` : 'none';

    if (st > 0 && st < 1) {
      const k = (1 - st) * 7;
      paper.style.marginLeft = `${Math.sin(t * 95) * k}px`;
      paper.style.marginTop = `${Math.cos(t * 81) * k}px`;
    } else { paper.style.marginLeft = '0px'; paper.style.marginTop = '0px'; }
  };
});
