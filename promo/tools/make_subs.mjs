/* Build captions from the VO timeline -> promo/tts/captions.json + promo/out/subs.ass */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('promo');
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'stage/timeline.json'), 'utf8'));
const SEG = JSON.parse(fs.readFileSync(path.join(ROOT, 'tts/segments.json'), 'utf8'));

const vlen = s => [...s].reduce((n, c) => n + (/[\x00-\xff]/.test(c) ? .55 : 1), 0);

function wrap(text, max = 24) {
  if (vlen(text) <= max) return text;
  const chars = [...text];
  const mid = vlen(text) / 2;
  let best = -1, bestScore = 1e9, acc = 0;
  for (let i = 1; i < chars.length - 1; i++) {
    acc += vlen(chars[i - 1]);
    const c = chars[i - 1], n = chars[i];
    if (!/[，。、！？；：·,.]/.test(c)) continue;
    if (n === '—' || n === '《') continue;
    const score = Math.abs(acc - mid);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) {
    acc = 0;
    for (let i = 1; i < chars.length - 1; i++) {
      acc += vlen(chars[i - 1]);
      if (chars[i] === '—' || chars[i] === '《') continue;
      const score = Math.abs(acc - mid);
      if (score < bestScore) { bestScore = score; best = i; }
    }
  }
  return chars.slice(0, best).join('').trim() + '\n' + chars.slice(best).join('').trim();
}

const caps = [];
for (const s of SEG) {
  const start = TL.vo[s.id];
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
    path.join(ROOT, 'audio/vo', `${s.id}.wav`)]).toString().trim());
  caps.push({ id: s.id, start: +start.toFixed(2), end: +(start + dur + .18).toFixed(2), text: wrap(s.text) });
}
caps.sort((a, b) => a.start - b.start);

fs.writeFileSync(path.join(ROOT, 'tts/captions.json'), JSON.stringify(caps, null, 2));

const ts = t => {
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

const head = `[Script Info]
Title: Spy Mouse Promo
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,SpyCaption,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,1.5,0,1,0,4,2,120,120,54,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const events = caps.map((c, i) => {
  const text = c.text.replace(/\n/g, '\\N');
  return `Dialogue: 0,${ts(c.start)},${ts(c.end)},Cap,,0,0,0,,{\\shad4\\blur0\\bord0\\fsp1.5}${text}`;
}).join('\n');

fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out/subs.ass'), head + events + '\n');
console.log(caps.map(c => `${c.id} ${c.start.toFixed(2)}-${c.end.toFixed(2)}  ${c.text.replace('\n', ' / ')}`).join('\n'));
