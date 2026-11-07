#!/usr/bin/env node
// Spy Mouse -> modern Android compatibility builder.
//
// Builds two artefacts from the user's own legally held copy:
//   out/spymouse-compat-slim.apk  : repacked launcher shell only (small).
//                                  Data is provisioned separately via adb.
//   out/spymouse-compat-full.apk  : self-contained APK with the full data pack
//                                  embedded and extracted on first run.
//   out/spymouse-data.zip         : the data pack used by both paths.
//
// This tool does NOT modify, disable or bypass the game's licensing/LVL code,
// and it does not ship any original game assets into the git repository.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORK = path.join(HERE, '_work');
const OUT = path.join(HERE, 'out');

// ---------------------------------------------------------------- CLI ----
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const MODE = valueOf('--mode', 'all');          // slim | full | all
const TARGET_SDK = Number(valueOf('--target-sdk', '28'));
const ORIGINAL_APK = path.resolve(ROOT, valueOf('--apk', '间谍鼠1.0.7.apk'));
const DATA_ROOT = path.resolve(ROOT, valueOf('--data', 'com.ea.spymouse_row/files'));
const CLEAN = has('--clean');
// Legacy APKs ship only lib/armeabi/. Most ARM32-capable emulators advertise
// armeabi-v7a (not the long-deprecated armeabi) in their abilist and reject
// such APKs with INSTALL_FAILED_CPU_ABI_INCOMPATIBLE / NO_MATCHING_ABIS.
// Duplicate the same ELF32 ARM .so into lib/armeabi-v7a/ by default.
const ABI_COMPAT = !has('--no-abi-compat');

if (!['slim', 'full', 'all'].includes(MODE)) {
  console.error('--mode must be slim | full | all');
  process.exit(2);
}

const log = (...a) => console.log('[build]', ...a);
const fail = (msg) => { console.error('[build] ERROR:', msg); process.exit(1); };

// ------------------------------------------------------------- tools ----
const firstExisting = (...candidates) =>
  candidates.filter(Boolean).find((p) => fs.existsSync(p)) || null;

function sdkTool(name) {
  const base = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!base) return null;
  const bt = path.join(base, 'build-tools');
  if (!fs.existsSync(bt)) return null;
  for (const version of fs.readdirSync(bt).sort().reverse()) {
    for (const candidate of [name, `${name}.exe`, `${name}.bat`]) {
      const p = path.join(bt, version, candidate);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const JAVA = process.env.JAVA || 'java';
const KEYTOOL = process.env.KEYTOOL || 'keytool';
const HB = path.join(os.homedir(), 'Downloads', 'HBuilderX', 'plugins', 'app-safe-pack');

const APKTOOL = firstExisting(
  process.env.APKTOOL_JAR,
  path.join(HB, 'apktool.jar'),
  path.join(ROOT, 'android-port', 'tools', 'apktool.jar'),
);
const APKSIGNER = firstExisting(
  process.env.APKSIGNER_JAR,
  path.join(HB, 'apksigner.jar'),
  path.join(ROOT, 'android-port', 'tools', 'apksigner.jar'),
  sdkTool('apksigner'),
);
const ZIPALIGN = firstExisting(
  process.env.ZIPALIGN,
  path.join(HB, 'zipalign', 'zipalign.exe'),
  sdkTool('zipalign'),
);

function run(cmd, args, { label = cmd, cwd = ROOT, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    throw new Error(
      `${label} failed (exit ${r.status})\n` +
      `${(r.stdout || '').slice(-4000)}\n${(r.stderr || '').slice(-4000)}`,
    );
  }
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

const apktool = (args, label) => run(JAVA, ['-jar', APKTOOL, ...args], { label });
const signer = (args, label) =>
  APKSIGNER.endsWith('.jar')
    ? run(JAVA, ['-jar', APKSIGNER, ...args], { label })
    : run(APKSIGNER, args, { label });

// ------------------------------------------------------------- inputs ----
function checkInputs() {
  const missing = [];
  if (!fs.existsSync(ORIGINAL_APK)) missing.push(`APK: ${ORIGINAL_APK}`);
  if (!fs.existsSync(path.join(DATA_ROOT, 'res'))) missing.push(`res: ${DATA_ROOT}/res`);
  if (!fs.existsSync(path.join(DATA_ROOT, 'res_960x640'))) missing.push(`res_960x640: ${DATA_ROOT}/res_960x640`);
  if (!fs.existsSync(path.join(DATA_ROOT, 'Downloaded.indicate'))) missing.push(`marker: ${DATA_ROOT}/Downloaded.indicate`);
  if (!APKTOOL) missing.push('apktool.jar (set APKTOOL_JAR)');
  if (!APKSIGNER) missing.push('apksigner (set APKSIGNER_JAR)');
  if (!ZIPALIGN) missing.push('zipalign (set ZIPALIGN)');
  if (missing.length) fail(`missing inputs/tools:\n  - ${missing.join('\n  - ')}`);
  log('tools:', { APKTOOL, APKSIGNER, ZIPALIGN });
}

function sha256(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}

// --------------------------------------------------- minimal ZIP writer ----
// STORED entries only. The data pack is already-compressed PNG/JPG/ADPCM, so
// deflating it again costs time for almost no gain, and STORED lets AssetManager
// stream it without a second decompression buffer.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function collect(dir, prefix, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) collect(abs, rel, out);
    else if (st.isFile()) out.push({ abs, rel, size: st.size });
  }
}

function writeStoredZip(root, zipPath) {
  const entries = [];
  collect(root, '', entries);
  const dos = (() => {
    const d = new Date();
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  })();

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  const fd = fs.openSync(zipPath, 'w');
  const central = [];
  let offset = 0;
  let total = 0;

  for (const e of entries) {
    if (e.size > 0xffffffff) throw new Error(`entry too large for ZIP32: ${e.rel}`);
    const data = fs.readFileSync(e.abs);
    const name = Buffer.from(e.rel, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 names
    local.writeUInt16LE(0, 8);            // STORED
    local.writeUInt16LE(dos.time, 10);
    local.writeUInt16LE(dos.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    fs.writeSync(fd, local);
    fs.writeSync(fd, name);
    fs.writeSync(fd, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // central directory signature
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);              // STORED
    cd.writeUInt16LE(dos.time, 12);
    cd.writeUInt16LE(dos.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);         // local header offset
    central.push(Buffer.concat([cd, name]));

    offset += local.length + name.length + data.length;
    total += data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) { fs.writeSync(fd, c); cdSize += c.length; }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  fs.writeSync(fd, eocd);
  fs.closeSync(fd);

  return { entries: entries.length, bytes: total, size: fs.statSync(zipPath).size };
}

// ---------------------------------------------------------- apk patches ----
function patchTree(tree, { targetSdk, noCompressZip = false, injectBootstrap = false, abiCompat = true }) {
  // --- ABI compatibility: duplicate the ELF32 ARM lib into armeabi-v7a/ ---
  // Same bytes, just a directory name. ARMv7 executes ARMv5 code fine, and
  // emulators with an ARM32 native bridge advertise armeabi-v7a (never the
  // deprecated bare "armeabi") in ro.product.cpu.abilist.
  if (abiCompat) {
    const legacy = path.join(tree, 'lib', 'armeabi', 'libSpyMouse.so');
    const modern = path.join(tree, 'lib', 'armeabi-v7a', 'libSpyMouse.so');
    if (!fs.existsSync(legacy)) throw new Error('lib/armeabi/libSpyMouse.so missing from decoded APK');
    fs.mkdirSync(path.dirname(modern), { recursive: true });
    fs.copyFileSync(legacy, modern);
  }

  // --- AndroidManifest.xml ---
  const mf = path.join(tree, 'AndroidManifest.xml');
  let s = fs.readFileSync(mf, 'utf8');
  s = s.replace(/\s*android:installLocation="preferExternal"/, '');
  s = s.replace(
    '<application ',
    '<application android:usesCleartextTraffic="true" ' +
    'android:requestLegacyExternalStorage="true" ' +
    'android:extractNativeLibs="true" ',
  );
  s = s.replace(/\s*<compatible-screens>[\s\S]*?<\/compatible-screens>/, '');
  if (!s.includes('org.apache.http.legacy')) {
    s = s.replace(
      /(\s*)<\/application>/,
      '$1    <uses-library android:name="org.apache.http.legacy" android:required="false"/>$1</application>',
    );
  }
  fs.writeFileSync(mf, s);

  // --- apktool.yml ---
  const ymlPath = path.join(tree, 'apktool.yml');
  let y = fs.readFileSync(ymlPath, 'utf8');
  y = y.replace(/targetSdkVersion:\s*\d+/, `targetSdkVersion: ${targetSdk}`);
  if (noCompressZip && !/^-\s*zip\s*$/m.test(y)) {
    if (!y.includes('doNotCompress:')) y += '\ndoNotCompress:\n';
    y = y.replace(/(doNotCompress:\s*\n)/, '$1- zip\n');
  }
  fs.writeFileSync(ymlPath, y);

  // --- drop stale original signature files, if apktool kept them ---
  const stale = path.join(tree, 'original', 'META-INF');
  if (fs.existsSync(stale)) fs.rmSync(stale, { recursive: true, force: true });

  if (injectBootstrap) {
    const pkgDir = path.join(tree, 'smali', 'com', 'ea', 'spymouse_na');
    fs.copyFileSync(path.join(HERE, 'DataBootstrap.smali'), path.join(pkgDir, 'DataBootstrap.smali'));
    const act = path.join(pkgDir, 'SpyMouseActivity.smali');
    let a = fs.readFileSync(act, 'utf8');
    // apktool emits CRLF on Windows; keep whichever EOL the file actually uses.
    const anchorRe = /(    invoke-super \{p0, p1\}, Lcom\/ea\/blast\/MainActivity;->onCreate\(Landroid\/os\/Bundle;\)V)(\r?\n)/;
    const m = a.match(anchorRe);
    if (!m) throw new Error('cannot find SpyMouseActivity.onCreate super call');
    if (!a.includes('DataBootstrap;->unpack')) {
      const eol = m[2];
      const call = `    invoke-static {p0}, Lcom/ea/spymouse_na/DataBootstrap;->unpack(Landroid/content/Context;)V${eol}`;
      a = a.replace(anchorRe, `$1${eol}${eol}${call}`);
      fs.writeFileSync(act, a);
    }
  }
}

function copyTree(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
}

function buildUnsigned(tree, outApk) {
  apktool(['b', '-f', '-o', outApk, tree], 'apktool build');
  if (!fs.existsSync(outApk)) throw new Error(`apktool did not produce ${outApk}`);
  return fs.statSync(outApk).size;
}

function alignAndSign(unsigned, signed) {
  const aligned = path.join(WORK, `${path.basename(unsigned, '.apk')}-aligned.apk`);
  run(ZIPALIGN, ['-f', '-p', '4', unsigned, aligned], { label: 'zipalign' });
  run(ZIPALIGN, ['-c', '-p', '4', aligned], { label: 'zipalign verify' });

  signer([
    'sign',
    '--ks', KEYSTORE,
    '--ks-pass', 'pass:localcompat',
    '--key-pass', 'pass:localcompat',
    '--ks-key-alias', 'spymouse-compat',
    '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true',
    '--min-sdk-version', '7',
    '--out', signed,
    aligned,
  ], 'apksigner sign');

  const v = signer(['verify', '--verbose', signed], 'apksigner verify').stdout;
  return {
    v1: /Verified using v1 scheme[^\n]*true/.test(v),
    v2: /Verified using v2 scheme[^\n]*true/.test(v),
    verified: /^Verifies$/m.test(v.trim()),
  };
}

// ------------------------------------------------------------- keystore ----
const KEYSTORE = path.join(WORK, 'compat.jks');

function ensureKeystore() {
  if (fs.existsSync(KEYSTORE)) { log('reusing local self-signed keystore'); return; }
  run(KEYTOOL, [
    '-genkeypair', '-v',
    '-keystore', KEYSTORE,
    '-storetype', 'JKS',
    '-alias', 'spymouse-compat',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10950',
    '-storepass', 'localcompat', '-keypass', 'localcompat',
    '-dname', 'CN=SpyMouse Local Compat, OU=Local Research, O=Local, L=Local, ST=Local, C=CN',
  ], { label: 'keytool' });
  log('generated local self-signed keystore (never commit this file)');
}

// ----------------------------------------------------------------- main ----
async function main() {
  if (CLEAN) {
    fs.rmSync(WORK, { recursive: true, force: true });
    fs.rmSync(OUT, { recursive: true, force: true });
    log('cleaned _work/ and out/');
    if (has('--clean-only')) return;
  }
  checkInputs();
  fs.mkdirSync(WORK, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  ensureKeystore();

  const originalCopy = path.join(WORK, 'original.apk');
  fs.copyFileSync(ORIGINAL_APK, originalCopy);
  const decoded = path.join(WORK, 'decoded');
  apktool(['d', '-f', '-o', decoded, originalCopy], 'apktool decode');
  log('decoded original APK');

  const dataZip = path.join(OUT, 'spymouse-data.zip');
  log('packing data pack (this copies ~178 MB, please wait)...');
  const zipInfo = writeStoredZip(DATA_ROOT, dataZip);
  log(`data pack: ${zipInfo.entries} entries, ${(zipInfo.bytes / 1048576).toFixed(1)} MiB raw, ${(zipInfo.size / 1048576).toFixed(1)} MiB zip`);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    targetSdk: TARGET_SDK,
    abiCompat: ABI_COMPAT,
    inputs: {
      apk: path.basename(ORIGINAL_APK),
      apkSha256: sha256(ORIGINAL_APK),
      dataRoot: path.relative(ROOT, DATA_ROOT),
      dataEntries: zipInfo.entries,
      dataRawBytes: zipInfo.bytes,
    },
    tools: { apktool: APKTOOL, apksigner: APKSIGNER, zipalign: ZIPALIGN },
    artefacts: {},
    constraints: [
      'libSpyMouse.so is 32-bit ARM (ELF32/ARM); no arm64-v8a build exists and static ARM32->ARM64 recompilation is not feasible without source.',
      'Duplicating it into lib/armeabi-v7a/ fixes ABI matching on ARM32-capable targets only; Android 15 / MuMu 15 instances expose no ARM32 ABI at all.',
      'targetSdkVersion raised to >=23 because Android 14+ refuses apps targeting <23.',
      'Licensing (Google Play LVL) code is untouched; re-signing may invalidate its offline/online check.',
      'First run of the full build unpacks ~178 MB on the main thread; an ANR prompt may appear.',
    ],
  };

  const buildOne = (name, { bundle, inject }) => {
    const tree = path.join(WORK, `tree-${name}`);
    copyTree(decoded, tree);
    patchTree(tree, {
      targetSdk: TARGET_SDK,
      noCompressZip: bundle,
      injectBootstrap: inject,
      abiCompat: ABI_COMPAT,
    });
    if (bundle) {
      fs.mkdirSync(path.join(tree, 'assets'), { recursive: true });
      fs.copyFileSync(dataZip, path.join(tree, 'assets', 'spymouse-data.zip'));
    }
    log(`building ${name} APK...`);
    const unsigned = path.join(WORK, `${name}-unsigned.apk`);
    const signed = path.join(OUT, `spymouse-compat-${name}.apk`);
    const unsignedSize = buildUnsigned(tree, unsigned);
    const sig = alignAndSign(unsigned, signed);
    if (!sig.v1 || !sig.v2) throw new Error(`${name}: missing v1/v2 signature`);
    const result = {
      path: path.relative(ROOT, signed),
      bytes: fs.statSync(signed).size,
      unsignedBytes: unsignedSize,
      sha256: sha256(signed),
      signature: sig,
      bundledData: bundle,
    };
    report.artefacts[name] = result;
    log(`${name}: ${(result.bytes / 1048576).toFixed(1)} MiB, v1=${sig.v1} v2=${sig.v2}`);
  };

  if (MODE === 'slim' || MODE === 'all') buildOne('slim', { bundle: false, inject: false });
  if (MODE === 'full' || MODE === 'all') buildOne('full', { bundle: true, inject: true });

  report.artefacts['spymouse-data.zip'] = {
    path: path.relative(ROOT, dataZip),
    bytes: zipInfo.size,
    sha256: sha256(dataZip),
    entries: zipInfo.entries,
  };

  fs.writeFileSync(path.join(OUT, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  log('build-report.json written');
  log('DONE. See android-port/README.md for installation and the ABI caveat.');
}

main().catch((err) => { console.error('[build] FAILED:', err.message); process.exit(1); });
