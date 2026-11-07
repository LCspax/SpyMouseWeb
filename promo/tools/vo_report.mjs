import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Users/14451/Desktop/SpyMouseWeb/promo';
const segs = JSON.parse(fs.readFileSync(`${ROOT}/tts/segments.json`, 'utf8'));
const rows = [];
for (const s of segs) {
  const f = `${ROOT}/audio/vo/${s.id}.wav`;
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
  const chars = s.text.replace(/[，。！？、；：—…《》""'']/g, '').length;
  rows.push({ id: s.id, dur: +d.toFixed(3), chars, cps: +(chars / d).toFixed(2), text: s.text });
}
let total = 0;
for (const r of rows) { r.start = +total.toFixed(3); total += r.dur + 0.42; }
console.log(rows.map(r => `${r.id}  ${r.dur.toFixed(2)}s  ${r.chars}字  ${r.cps}字/s  @${r.start.toFixed(2)}  ${r.text}`).join('\n'));
console.log('speech total with gaps:', (total - 0.42).toFixed(2));
fs.writeFileSync(`${ROOT}/tts/vo_timing.json`, JSON.stringify(rows, null, 2));
