#!/usr/bin/env node
// Static verification of the APKs produced by build.mjs.
//   node android-port/verify.mjs
// No device/emulator is required. It checks packaging, signatures, the
// manifest adaptation, that licensing classes are still present, and the
// CRC of every entry in the bundled data pack.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const WORK = path.join(HERE, '_work');

const firstExisting = (...c) => c.filter(Boolean).find((p) => fs.existsSync(p)) || null;
const HB = path.join(os.homedir(), 'Downloads', 'HBuilderX', 'plugins', 'app-safe-pack');
const JAVA = process.env.JAVA || 'java';
const APKTOOL = firstExisting(process.env.APKTOOL_JAR, path.join(HB, 'apktool.jar'));
const APKSIGNER = firstExisting(process.env.APKSIGNER_JAR, path.join(HB, 'apksigner.jar'));
const ZIPALIGN = firstExisting(process.env.ZIPALIGN, path.join(HB, 'zipalign', 'zipalign.exe'));

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` -- ${detail}` : ''}`);
  return !!ok;
};

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) return { status: -1, out: r.error.message };
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const signer = (args, label) =>
  APKSIGNER.endsWith('.jar') ? run(JAVA, ['-jar', APKSIGNER, ...args], label) : run(APKSIGNER, args, label);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function centralDirectory(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.statSync(file).size;
  const tailLen = Math.min(size, 66000);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error('no EOCD found');
  const count = tail.readUInt16LE(e + 10);
  const cdSize = tail.readUInt32LE(e + 12);
  const cdOffset = tail.readUInt32LE(e + 16);
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOffset);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const nlen = cd.readUInt16LE(p + 28);
    const xlen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    entries.push({
      name: cd.subarray(p + 46, p + 46 + nlen).toString('utf8'),
      method: cd.readUInt16LE(p + 10),
      crc: cd.readUInt32LE(p + 16),
      csize: cd.readUInt32LE(p + 20),
      usize: cd.readUInt32LE(p + 24),
      localOff: cd.readUInt32LE(p + 42),
    });
    p += 46 + nlen + xlen + clen;
  }
  return { fd, entries };
}

function entryDataOffset(fd, e) {
  const lh = Buffer.alloc(30);
  fs.readSync(fd, lh, 0, 30, e.localOff);
  return e.localOff + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
}

function readEntry(fd, e) {
  const buf = Buffer.alloc(e.csize);
  fs.readSync(fd, buf, 0, e.csize, entryDataOffset(fd, e));
  return e.method === 0 ? buf : zlib.inflateRawSync(buf);
}

function verifyAllCrc(fd, entries) {
  const chunk = Buffer.alloc(1024 * 1024);
  let checkedBytes = 0;
  for (const e of entries) {
    let c = -1;
    let off = entryDataOffset(fd, e);
    let left = e.csize;
    while (left > 0) {
      const n = Math.min(chunk.length, left);
      fs.readSync(fd, chunk, 0, n, off);
      for (let i = 0; i < n; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
      off += n;
      left -= n;
    }
    checkedBytes += e.csize;
    if (e.method !== 0 || (((c ^ -1) >>> 0) !== e.crc)) return { ok: false, bad: e.name, checkedBytes };
  }
  return { ok: true, count: entries.length, checkedBytes };
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function main() {
  const slim = path.join(OUT, 'spymouse-compat-slim.apk');
  const full = path.join(OUT, 'spymouse-compat-full.apk');
  const dataZip = path.join(OUT, 'spymouse-data.zip');
  for (const f of [slim, full, dataZip]) {
    if (!fs.existsSync(f)) { console.error(`missing artefact: ${f}\nrun: node android-port/build.mjs --mode all`); process.exit(1); }
  }

  console.log('\n== 1. signatures and alignment ==');
  for (const [name, file] of [['slim', slim], ['full', full]]) {
    const v = signer(['verify', '--verbose', file], 'verify');
    check(`${name}: apksigner verify`, v.status === 0 && /Verifies/.test(v.out));
    check(`${name}: v1 + v2 schemes`, /v1 scheme[^\n]*true/.test(v.out) && /v2 scheme[^\n]*true/.test(v.out));
    const a = run(ZIPALIGN, ['-c', '-p', '4', file], 'zipalign');
    check(`${name}: zipalign -c`, a.status === 0);
  }

  console.log('\n== 2. manifest adaptation (re-decoded from slim APK) ==');
  const decoded = path.join(WORK, 'verify-decoded');
  const d = run(JAVA, ['-jar', APKTOOL, 'd', '-f', '-s', '-o', decoded, slim], 'apktool decode');
  check('apktool can decode slim APK', d.status === 0);
  if (d.status === 0) {
    const mf = fs.readFileSync(path.join(decoded, 'AndroidManifest.xml'), 'utf8');
    const yml = fs.readFileSync(path.join(decoded, 'apktool.yml'), 'utf8');
    const sdk = /targetSdkVersion:\s*(\d+)/.exec(yml);
    const target = sdk ? Number(sdk[1]) : 0;
    check('targetSdkVersion >= 23 (Android 14+ install gate)', target >= 23, `targetSdkVersion=${target}`);
    check('usesCleartextTraffic (legacy HTTP downloader)', mf.includes('android:usesCleartextTraffic="true"'));
    check('requestLegacyExternalStorage', mf.includes('android:requestLegacyExternalStorage="true"'));
    check('extractNativeLibs for 32-bit .so', mf.includes('android:extractNativeLibs="true"'));
    check('org.apache.http.legacy uses-library', mf.includes('org.apache.http.legacy'));
    check('compatible-screens removed', !mf.includes('compatible-screens'));
    check('preferExternal removed', !mf.includes('preferExternal'));
    check('CHECK_LICENSE permission untouched', mf.includes('com.android.vending.CHECK_LICENSE'));
    check('launcher activity untouched', mf.includes('com.ea.spymouse_na.SpyMouseActivity'));
  }

  console.log('\n== 3. APK contents ==');
  const slimZip = centralDirectory(slim);
  const fullZip = centralDirectory(full);
  const slimNames = new Set(slimZip.entries.map((e) => e.name));
  const fullNames = new Set(fullZip.entries.map((e) => e.name));
  const nativeName = 'lib/armeabi/libSpyMouse.so';
  check('slim contains 32-bit native lib', slimNames.has(nativeName));
  check('full contains 32-bit native lib', fullNames.has(nativeName));
  const refSo = path.join(ROOT, 'libSpyMouse.so');
  if (slimNames.has(nativeName) && fs.existsSync(refSo)) {
    const e = slimZip.entries.find((x) => x.name === nativeName);
    const packaged = sha256(readEntry(slimZip.fd, e));
    const original = sha256(fs.readFileSync(refSo));
    check('native lib byte-identical to original', packaged === original, packaged.slice(0, 16));
  }
  const compatName = 'lib/armeabi-v7a/libSpyMouse.so';
  check('slim declares armeabi-v7a (ARM32 bridge targets)', slimNames.has(compatName));
  check('full declares armeabi-v7a', fullNames.has(compatName));
  if (slimNames.has(nativeName) && slimNames.has(compatName)) {
    const a = sha256(readEntry(slimZip.fd, slimZip.entries.find((x) => x.name === nativeName)));
    const b = sha256(readEntry(slimZip.fd, slimZip.entries.find((x) => x.name === compatName)));
    check('v7a lib is a byte-identical copy (no fake arm64)', a === b, a.slice(0, 16));
  }
  const dataEntry = fullZip.entries.find((e) => e.name === 'assets/spymouse-data.zip');
  check('full embeds data pack', !!dataEntry, dataEntry ? `${(dataEntry.usize / 1048576).toFixed(1)} MiB` : '');
  check('data pack stored uncompressed (streamable)', !!dataEntry && dataEntry.method === 0);
  check('slim does NOT embed data pack', !slimNames.has('assets/spymouse-data.zip'));

  console.log('\n== 4. dex integrity ==');
  const slimDex = readEntry(slimZip.fd, slimZip.entries.find((e) => e.name === 'classes.dex')).toString('latin1');
  const fullDex = readEntry(fullZip.fd, fullZip.entries.find((e) => e.name === 'classes.dex')).toString('latin1');
  check('LVL licensing classes retained in both',
    slimDex.includes('LicenseServerActivity') && fullDex.includes('LicenseServerActivity'));
  check('full dex contains DataBootstrap', fullDex.includes('Lcom/ea/spymouse_na/DataBootstrap;'));
  check('full dex contains bootstrap log tag', fullDex.includes('SpyMouseCompat'));
  check('slim dex is unmodified bootstrap-wise', !slimDex.includes('DataBootstrap'));

  console.log('\n== 5. data pack integrity ==');
  const dz = centralDirectory(dataZip);
  check('data pack entry count matches source (5348-ish)', dz.entries.length > 5000, `${dz.entries.length} entries`);
  const names = new Set(dz.entries.map((e) => e.name));
  check('contains Downloaded.indicate', names.has('Downloaded.indicate'));
  check('contains res/ tree', [...names].some((n) => n.startsWith('res/')));
  check('contains res_960x640/ tree', [...names].some((n) => n.startsWith('res_960x640/')));
  const marker = readEntry(dz.fd, dz.entries.find((e) => e.name === 'Downloaded.indicate')).toString('utf8');
  check('marker declares COMPLETE', marker.includes('COMPLETE'), JSON.stringify(marker.trim()));
  const crc = verifyAllCrc(dz.fd, dz.entries);
  check('all data pack CRCs valid', crc.ok, crc.ok ? `${crc.count} entries, ${(crc.checkedBytes / 1048576).toFixed(1)} MiB` : `bad: ${crc.bad}`);

  for (const z of [slimZip, fullZip, dz]) fs.closeSync(z.fd);

  const ok = checks.every((c) => c.ok);
  const report = { verifiedAt: new Date().toISOString(), passed: ok, checks };
  fs.writeFileSync(path.join(OUT, 'verify-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} -- ${checks.filter((c) => c.ok).length}/${checks.length}`);
  console.log('report: android-port/out/verify-report.json');
  if (!ok) process.exit(1);
}

try { main(); } catch (err) { console.error('verify failed:', err.stack); process.exit(1); }
