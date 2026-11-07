import { defineShot, el, css, inv, lerp, easeOut } from '../lib.js';

defineShot('S09', (root, { dur }) => {
  const CUTS = [
    { at: 15.2, name: '闸门与开关', tag: '门 · 机关' },
    { at: 25.0, name: '猫在巡逻', tag: '视野 · 躲避' },
    { at: 39.8, name: '电视机', tag: '传送 · 换位' },
    { at: 45.0, name: '被抓住了', tag: '失败 · 重来' },
    { at: 64.6, name: '管道滑行', tag: '连通 · 捷径' },
  ];
  const SEG = (dur || 5.9) / CUTS.length;

  const wrap = el('div', '', root);
  css(wrap, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#000' });

  const v = el('video', '', wrap);
  v.src = '../media/web/clean_crop.mp4'; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.dataset.start = CUTS[0].at; v.dataset.rate = 1;
  css(v, { position: 'absolute', left: '-2%', top: '-1%', width: '104%', height: '102%', objectFit: 'cover', filter: 'saturate(1.05) contrast(1.05)' });

  const grade = el('div', '', root);
  css(grade, { position: 'absolute', inset: '0', background: 'radial-gradient(85% 80% at 50% 48%, rgba(0,0,0,0), rgba(0,0,0,.45) 100%)' });

  const scrim = el('div', '', root);
  css(scrim, { position: 'absolute', left: '0', bottom: '0', width: '1040px', height: '440px', background: 'linear-gradient(28deg, rgba(6,4,2,.82), rgba(6,4,2,.45) 42%, rgba(6,4,2,0) 78%)' });


  const labelBox = el('div', '', root);
  css(labelBox, { position: 'absolute', left: '84px', bottom: '86px', display: 'flex', alignItems: 'flex-end', gap: '18px' });

  const num = el('div', '', labelBox);
  css(num, { fontSize: '88px', fontWeight: 900, lineHeight: '.9', color: '#FFC63A', letterSpacing: '-1px', textShadow: '5px 6px 0 rgba(0,0,0,.6)', fontVariantNumeric: 'tabular-nums' });

  const meta = el('div', '', labelBox);
  css(meta, { paddingBottom: '8px' });
  const nm = css(el('div', '', meta), { fontSize: '46px', fontWeight: 900, color: '#FFF6E4', lineHeight: '1', textShadow: '4px 4px 0 rgba(0,0,0,.6)' });
  const tg = css(el('div', '', meta), { marginTop: '10px', fontSize: '24px', letterSpacing: '3px', color: 'rgba(255,222,160,.78)', fontWeight: 500 });

  const flash = el('div', '', root);
  css(flash, { position: 'absolute', inset: '0', background: '#FFF3D6', opacity: 0, mixBlendMode: 'screen' });

  const sec = el('div', '', root);
  css(sec, { position: 'absolute', right: '80px', top: '66px', fontFamily: 'Consolas, monospace', fontSize: '18px', letterSpacing: '3px', color: 'rgba(255,240,215,.6)' });

  let shown = -1;
  return (t) => {
    /* cuts are driven by the real (unscaled) shot time so the video seek,
       the label and the flash all land on the same frame */
    const raw = Number(root.dataset.local || 0);
    const i = Math.min(CUTS.length - 1, Math.floor(raw / SEG));
    const local = raw - i * SEG;
    const c = CUTS[i];
    if (i !== shown) {
      shown = i;
      num.textContent = String(i + 1).padStart(2, '0');
      nm.textContent = c.name;
      tg.textContent = c.tag;
    }
    // compensate the engine's `start + shotLocal` seek math so each cut starts exactly at c.at
    v.dataset.start = c.at - raw;
    v.style.transform = `scale(${lerp(1.0, 1.09, easeOut(local / SEG))}) translateX(${lerp(0, -10, local / SEG)}px)`;

    const kin = inv(0, .22, local);
    labelBox.style.opacity = kin;
    labelBox.style.transform = `translateX(${lerp(-40, 0, easeOut(kin))}px)`;

    flash.style.opacity = Math.max(0, .18 * (1 - local / .16));
    sec.textContent = `${String(i + 1).padStart(2, '0')} / ${String(CUTS.length).padStart(2, '0')}`;
  };
});
