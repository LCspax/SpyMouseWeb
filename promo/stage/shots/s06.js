import { defineShot, el, css, inv, lerp, easeOut, easeInOut, easeOutBack } from '../lib.js';

defineShot('S06', (root) => {
  const bg = el('div', '', root);
  css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(55% 60% at 50% 50%, #1A1008 0%, #0A0503 60%, #000 100%)' });

  const grid = el('div', '', root);
  css(grid, { position: 'absolute', inset: '0', backgroundImage: 'linear-gradient(rgba(255,198,58,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,198,58,.045) 1px,transparent 1px)', backgroundSize: '90px 90px', maskImage: 'radial-gradient(60% 60% at 50% 50%, #000 30%, transparent 78%)', WebkitMaskImage: 'radial-gradient(60% 60% at 50% 50%, #000 30%, transparent 78%)' });

  const kicker = el('div', '', root, 'PORTING PIPELINE / 移植路径');
  css(kicker, { position: 'absolute', left: '120px', top: '104px', fontSize: '22px', letterSpacing: '7px', color: 'rgba(255,198,58,.55)', fontWeight: 700, fontFamily: 'Consolas, monospace' });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1920 1080');
  css(svg, { position: 'absolute', inset: '0', width: '1920px', height: '1080px', overflow: 'visible' });
  root.appendChild(svg);

  const d = 'M 110 610 C 190 610 300 610 380 610 S 700 470 820 470 S 1120 610 1250 610 S 1540 450 1650 450';
  const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  glowPath.setAttribute('d', d); glowPath.setAttribute('fill', 'none');
  glowPath.setAttribute('stroke', 'rgba(255,198,58,.18)'); glowPath.setAttribute('stroke-width', '34');
  glowPath.setAttribute('stroke-linecap', 'round'); glowPath.setAttribute('filter', 'blur(18px)');
  svg.appendChild(glowPath);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d); path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#FFC63A'); path.setAttribute('stroke-width', '7');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-dasharray', '16 14');
  svg.appendChild(path);

  const pen = el('div', '', root);
  css(pen, { position: 'absolute', width: '26px', height: '26px', marginLeft: '-13px', marginTop: '-13px', borderRadius: '50%', background: '#FFF3C4', boxShadow: '0 0 30px 10px rgba(255,198,58,.55)', opacity: 0 });

  const L = path.getTotalLength();
  const NODES = [
    { f: .17, title: 'APK 解包', sub: '拆资源 / 拆配置', icon: '📦' },
    { f: .40, title: '资源重建', sub: '图集 · 音频 · 关卡', icon: '🧩' },
    { f: .64, title: 'Canvas 2D', sub: '原生 ES Modules', icon: '⚙' },
    { f: .88, title: '浏览器', sub: '打开就能玩', icon: '🌐' },
  ];

  const nodes = NODES.map((n, i) => {
    const pt = path.getPointAtLength(L * n.f);
    const g = el('div', '', root);
    css(g, { position: 'absolute', left: pt.x + 'px', top: pt.y + 'px', transform: 'translate(-50%,-50%)', width: '120px', height: '120px' });
    const ring = css(el('div', '', g), { position: 'absolute', inset: '0', borderRadius: '50%', border: '2px solid rgba(255,198,58,.7)', opacity: 0 });
    const dot = css(el('div', '', g), { position: 'absolute', left: '50%', top: '50%', width: '96px', height: '96px', margin: '-48px 0 0 -48px', borderRadius: '50%', background: 'linear-gradient(160deg,#3A2410,#1A0F06)', border: '3px solid rgba(255,198,58,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', boxShadow: '0 0 40px rgba(255,198,58,.18)' });
    dot.textContent = n.icon;
    const label = el('div', '', root);
    css(label, { position: 'absolute', left: pt.x + 'px', top: (pt.y + 84) + 'px', transform: 'translateX(-50%)', textAlign: 'center', width: '300px', opacity: 0 });
    css(el('div', '', label, n.title), { fontSize: '32px', fontWeight: 900, color: '#FFF1CE', letterSpacing: '1px' });
    css(el('div', '', label, n.sub), { fontSize: '19px', color: 'rgba(255,220,160,.5)', marginTop: '4px', letterSpacing: '1px' });
    return { n, g, ring, dot, label, pt };
  });

  const out = el('div', '', root, '手机 · 平板 · 电脑');
  css(out, { position: 'absolute', left: '1650px', top: '330px', transform: 'translateX(-50%)', fontSize: '30px', fontWeight: 700, color: 'rgba(255,198,58,.9)', letterSpacing: '4px', opacity: 0 });

  return (t) => {
    const p = easeInOut(inv(0, 2.6, t));
    const drawn = L * p;
    path.setAttribute('stroke-dasharray', `${Math.max(0, drawn)} ${L + 10}`);
    path.setAttribute('stroke-dashoffset', '0');

    if (p > 0 && p < 1) {
      const pt = path.getPointAtLength(drawn);
      pen.style.left = pt.x + 'px'; pen.style.top = pt.y + 'px';
      pen.style.opacity = 1;
      pen.style.transform = `scale(${1 + Math.sin(t * 22) * .12})`;
    } else pen.style.opacity = p >= 1 ? 0 : 0;

    nodes.forEach((nd, i) => {
      const at = (nd.n.f) / .88 * 2.55; // node lights when pen passes
      const k = inv(at, at + .28, t);
      nd.dot.style.transform = `scale(${lerp(.55, 1, easeOutBack(k))})`;
      nd.dot.style.opacity = inv(at - .05, at + .1, t);
      nd.dot.style.borderColor = k > .5 ? '#FFC63A' : 'rgba(255,198,58,.55)';
      nd.dot.style.boxShadow = k > .5 ? '0 0 60px rgba(255,198,58,.45)' : '0 0 40px rgba(255,198,58,.18)';
      nd.label.style.opacity = inv(at + .1, at + .5, t);
      nd.label.style.transform = `translateX(-50%) translateY(${lerp(14, 0, easeOut(inv(at + .1, at + .5, t)))}px)`;
      const rp = (t - at) % 1.6;
      nd.ring.style.opacity = k > .5 ? Math.max(0, 1 - rp / 1.2) * .5 : 0;
      nd.ring.style.transform = `scale(${lerp(.6, 2.4, clamp01(rp / 1.2))})`;
    });

    out.style.opacity = inv(3.0, 3.5, t);
    out.style.transform = `translateX(-50%) translateY(${lerp(16, 0, easeOut(inv(3.0, 3.5, t)))}px)`;
  };
});

const clamp01 = v => Math.max(0, Math.min(1, v));
