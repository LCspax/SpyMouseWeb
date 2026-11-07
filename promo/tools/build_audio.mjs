/* Build the promo soundtrack from the game's own music.
   - bed  : CM_Homes      (world 1 level theme, the most recognisable in-game cue)
   - outro: CM_Homes_Win  (level-complete jingle under the end card)
   No voice-over and no synth bed: this is a clean music master so the user can
   drop their own dub on top.
   Output: promo/audio/mix.wav (48k / 16-bit / stereo) */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('promo');
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'stage/timeline.json'), 'utf8'));
const SR = 48000;
const DUR = TL.total;
const N = Math.round(SR * DUR);

const MUSIC = path.resolve('assets/audio/music');

function decode(file) {
  const p = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 29 });
  if (p.status !== 0) throw new Error(`decode failed: ${file}`);
  // interleaved L/R, copied so the buffer is 4-byte aligned
  return new Float32Array(new Float32Array(p.stdout.buffer, p.stdout.byteOffset, p.stdout.length / 4));
}

const bed = decode(path.join(MUSIC, 'CM_Homes.ogg'));
const win = decode(path.join(MUSIC, 'CM_Homes_Win.ogg'));

const OUTRO = DUR - 11.4;   // end card begins here
const XF = 1.4;             // bed -> outro crossfade

const L = new Float32Array(N);
const R = new Float32Array(N);

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let gb = 0, gw = 0;
  if (t < OUTRO) gb = 1;
  else if (t < OUTRO + XF) {
    const x = (t - OUTRO) / XF;
    gb = Math.cos(x * Math.PI / 2);
    gw = Math.sin(x * Math.PI / 2);
  } else gw = 1;

  if (gb > 0) {
    const k = i * 2;
    if (k + 1 < bed.length) { L[i] += bed[k] * gb; R[i] += bed[k + 1] * gb; }
  }
  if (gw > 0) {
    const k = Math.round((t - OUTRO) * SR) * 2;
    if (k >= 0 && k + 1 < win.length) { L[i] += win[k] * gw; R[i] += win[k + 1] * gw; }
  }
}

/* announce + tail fades */
const FI = Math.round(.6 * SR), FO = Math.round(2.2 * SR);
for (let i = 0; i < N; i++) {
  let g = 1;
  if (i < FI) g = i / FI;
  if (i > N - FO) g = Math.min(g, (N - i) / FO);
  L[i] *= g; R[i] *= g;
}

function writeWav(file, l, r, gain = 1) {
  const out = Buffer.alloc(44 + N * 4);
  out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(N * 4, 40);
  let o = 44, peak = 0;
  for (let i = 0; i < N; i++) {
    const a = Math.max(-1, Math.min(1, l[i] * gain));
    const b = Math.max(-1, Math.min(1, r[i] * gain));
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
    out.writeInt16LE(Math.round(a * 32767), o); o += 2;
    out.writeInt16LE(Math.round(b * 32767), o); o += 2;
  }
  fs.writeFileSync(file, out);
  return peak;
}

/* level the bed so a voice-over sits comfortably on top */
const TARGET_LUFS = -18;
const tmp = path.join(ROOT, 'audio/_bed.wav');
writeWav(tmp, L, R);

function measure(file) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file,
    '-af', 'loudnorm=I=-18:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const err = (p.stderr || '') + (p.stdout || '');
  const i = err.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
  const tp = err.match(/"input_tp"\s*:\s*"(-?[\d.]+)"/);
  return { i: i ? Number(i[1]) : -24, tp: tp ? Number(tp[1]) : -3 };
}

const before = measure(tmp);
let gainDb = TARGET_LUFS - before.i;
gainDb = Math.min(gainDb, -1.5 - before.tp);   // keep true peak under -1.5 dBTP
const peak = writeWav(path.join(ROOT, 'audio/mix.wav'), L, R, Math.pow(10, gainDb / 20));
fs.unlinkSync(tmp);

const after = measure(path.join(ROOT, 'audio/mix.wav'));
console.log(`mix.wav  ${DUR.toFixed(2)}s  gain=${gainDb.toFixed(1)}dB  I=${after.i.toFixed(1)} LUFS  TP=${after.tp.toFixed(1)} dBTP  peak=${peak.toFixed(3)}`);
