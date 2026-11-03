#!/usr/bin/env node
// Verify the generated web audio assets (Node-only, no browser required).
//
// Checks:
//   - assets/audio/manifest.json exists, version 1
//   - 177 sound-effect entries with ids 0..176, 26 music tracks
//   - every referenced file exists, is non-empty and starts with an OggS page
//   - every entry has an MP3 fallback (Safari/iOS) with a valid MPEG header
//   - loop metadata is sane (loopEnd > loopStart >= 0, duration > 0)
//   - prints counts / total bytes / per-category summary
//
// Usage: node tools/verify-audio.mjs
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MANIFEST = join(ROOT, 'assets/audio/manifest.json');
const SFX_EXPECTED = 177;
const MUSIC_EXPECTED = 26;

const problems = [];
function fail(msg) { problems.push(msg); }

function checkOgg(file) {
  if (!existsSync(file)) return fail(`missing file: ${file}`);
  const st = statSync(file);
  if (!st.isFile() || st.size <= 0) return fail(`empty file: ${file}`);
  let head;
  try {
    const buf = readFileSync(file);
    head = buf.subarray(0, 4);
    if (head.length < 4) return fail(`truncated file: ${file} (${st.size} B)`);
    if (head.toString('latin1') !== 'OggS') return fail(`not an Ogg stream: ${file} (${head.toString('hex')})`);
  } catch (err) {
    return fail(`cannot read ${file}: ${err.message}`);
  }
  return st.size;
}

function checkMp3(file) {
  if (!existsSync(file)) return fail(`missing MP3 fallback: ${file}`);
  const st = statSync(file);
  if (!st.isFile() || st.size <= 0) return fail(`empty MP3 fallback: ${file}`);
  try {
    const buf = readFileSync(file);
    if (buf.length < 4) return fail(`truncated MP3 fallback: ${file} (${st.size} B)`);
    const hasId3 = buf.subarray(0, 3).toString('latin1') === 'ID3';
    const frameSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
    if (!hasId3 && !frameSync) return fail(`not an MP3 stream: ${file} (${buf.subarray(0, 4).toString('hex')})`);
  } catch (err) {
    return fail(`cannot read ${file}: ${err.message}`);
  }
  return st.size;
}

function checkEntry(name, entry, kind) {
  const label = `${kind}.${name}`;
  if (!entry || typeof entry !== 'object') return fail(`${label}: entry is not an object`);
  if (typeof entry.file !== 'string' || !entry.file.startsWith('assets/audio/')) {
    return fail(`${label}: bad file path ${JSON.stringify(entry.file)}`);
  }
  if (typeof entry.fileMp3 !== 'string' || !entry.fileMp3.startsWith('assets/audio/') || !entry.fileMp3.endsWith('.mp3')) {
    return fail(`${label}: bad MP3 fallback path ${JSON.stringify(entry.fileMp3)}`);
  }
  if (typeof entry.duration !== 'number' || !(entry.duration > 0)) {
    fail(`${label}: bad duration ${JSON.stringify(entry.duration)}`);
  }
  if (entry.loop) {
    if (typeof entry.loopStart !== 'number' || entry.loopStart < 0) fail(`${label}: bad loopStart`);
    if (typeof entry.loopEnd !== 'number' || !(entry.loopEnd > (entry.loopStart || 0))) fail(`${label}: bad loopEnd`);
  }
  if (entry.sampleRate != null && entry.sampleRate !== 22050) {
    fail(`${label}: unexpected sampleRate ${entry.sampleRate} (expected 22050)`);
  }
  const oggSize = checkOgg(join(ROOT, entry.file));
  const mp3Size = checkMp3(join(ROOT, entry.fileMp3));
  return {
    ogg: typeof oggSize === 'number' ? oggSize : 0,
    mp3: typeof mp3Size === 'number' ? mp3Size : 0,
  };
}

function main() {
  if (!existsSync(MANIFEST)) {
    console.error(`FAIL: manifest not found: ${MANIFEST}`);
    console.error('Run: powershell -NoProfile -ExecutionPolicy Bypass -File tools\\transcode-sps.ps1');
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    console.error(`FAIL: cannot parse manifest: ${err.message}`);
    process.exit(1);
  }

  const sfx = manifest.sfx || {};
  const music = manifest.music || {};
  const sfxIds = Object.keys(sfx).map(Number).sort((a, b) => a - b);
  const musicNames = Object.keys(music).sort();

  if (manifest.version !== 1) fail(`manifest.version must be 1 (got ${manifest.version})`);
  if (sfxIds.length !== SFX_EXPECTED) fail(`sfx count ${sfxIds.length} != ${SFX_EXPECTED}`);
  if (musicNames.length !== MUSIC_EXPECTED) fail(`music count ${musicNames.length} != ${MUSIC_EXPECTED}`);
  for (let id = 0; id < SFX_EXPECTED; id++) {
    if (!sfx[String(id)]) fail(`sfx id ${id} missing from manifest`);
  }
  const expectedMusic = ['CM_Menu1', 'CM_Menu2', 'CM_Menu3', 'CM_Menu_Loop', 'CM_Space', 'CM_WinGame',
    'CM_Alleys', 'CM_Apartments', 'CM_Factories', 'CM_Haunted', 'CM_Homes', 'CM_Japan', 'CM_Jungle',
    'CM_Urban', 'CM_Volcano', 'CM_Alleys_Win', 'CM_Apartments_Win', 'CM_Factories_Win', 'CM_Haunted_Win',
    'CM_Homes_Win', 'CM_Japan_Win', 'CM_Jungle_Win', 'CM_Urban_Win', 'CM_Volcano_Win',
    'CM_KiskaSting', 'CM_IntroSting'];
  for (const name of expectedMusic) {
    if (!music[name]) fail(`music track missing: ${name}`);
  }

  let sfxBytes = 0; let musicBytes = 0; let sfxMp3Bytes = 0; let musicMp3Bytes = 0;
  let loopedSfx = 0; let loopedMusic = 0;
  const files = new Set();
  for (const id of sfxIds) {
    const sizes = checkEntry(String(id), sfx[String(id)], 'sfx');
    if (sizes) { sfxBytes += sizes.ogg; sfxMp3Bytes += sizes.mp3; }
    files.add(sfx[String(id)].file);
    files.add(sfx[String(id)].fileMp3);
    if (sfx[String(id)].loop) loopedSfx++;
  }
  for (const name of musicNames) {
    const sizes = checkEntry(name, music[name], 'music');
    if (sizes) { musicBytes += sizes.ogg; musicMp3Bytes += sizes.mp3; }
    files.add(music[name].file);
    files.add(music[name].fileMp3);
    if (music[name].loop) loopedMusic++;
  }
  if (files.size !== (sfxIds.length + musicNames.length) * 2) fail(`duplicate file paths: ${files.size} unique for ${(sfxIds.length + musicNames.length) * 2} entries`);

  const mb = (n) => (n / (1024 * 1024)).toFixed(2) + ' MB';
  console.log('audio assets OK');
  console.log(`  sfx:   ${sfxIds.length} entries, ${loopedSfx} looped, ${mb(sfxBytes)} ogg + ${mb(sfxMp3Bytes)} mp3`);
  console.log(`  music: ${musicNames.length} tracks, ${loopedMusic} looped, ${mb(musicBytes)} ogg + ${mb(musicMp3Bytes)} mp3`);
  console.log(`  total: ${mb(sfxBytes + musicBytes + sfxMp3Bytes + musicMp3Bytes)} in ${files.size} files`);
  console.log(`  manifest: ${MANIFEST}`);

  if (problems.length) {
    console.error(`\nFAIL: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 40)) console.error('  - ' + p);
    if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
    process.exit(1);
  }
}

main();
