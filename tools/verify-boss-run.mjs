// Real-browser verification for the scroll-run / wall-crack fixes.
//
//   node tools/verify-boss-run.mjs [--url http://127.0.0.1:5199/] [--headed]
//
// Everything here needs the real canvas + rAF loop, so it cannot live in the
// Node test suite:
//
//   1. every painted wall crack is enterable by pushing into the wall
//      (1-7 was reported dead: its trigger sat 22 px from the only standable
//      tile, past the 17.6 px reach)
//   2. the scroll run prints no "SECTOR n" wording
//   3. the advance equals the white cat's HORIZONTAL displacement: a vertical
//      patrol leg stops the camera, a horizontal leg moves it by dx
//   4. the scroll camera shows the full map height and never pans vertically
//   5. the run HUD has no red danger band and no "keep up" label
//   6. losing the run and retrying restarts the advance instead of insta-failing
//
// Each case starts from a freshly loaded page (localStorage cleared) so one
// bonus room / boss checkpoint can never leak into the next case.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : fallback;
};
const externalUrl = opt('--url');
const headed = args.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(120);
  }
  throw new Error(`server did not start: ${url}`);
}

const failures = [];
const report = { checks: {}, console: [], pageErrors: [], badResponses: [] };
const expect = (ok, label, detail) => {
  report.checks[label] = { ok: !!ok, detail };
  if (!ok) failures.push(`${label}: ${JSON.stringify(detail)}`);
  return ok;
};

let server = null;
let baseUrl = externalUrl;
try {
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.execPath, ['tools/serve.mjs', String(port)], { cwd: path.resolve('.'), stdio: 'ignore' });
    baseUrl = `http://127.0.0.1:${port}/`;
    await waitFor(baseUrl);
  }
  const executablePath = chromePath();
  if (!executablePath) throw new Error('Chrome not found; set CHROME_PATH');
  const browser = await chromium.launch({
    executablePath,
    headless: !headed,
    args: ['--no-sandbox'],
    // Remote URLs (e.g. the deployed site) need the local proxy when one is
    // set. A proxy must NOT be applied to the local server: it would answer
    // every 127.0.0.1 module request with 404 and boot() would never finish.
    ...(externalUrl && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
      ? { proxy: { server: process.env.HTTPS_PROXY || process.env.HTTP_PROXY } }
      : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch { /* private mode */ }
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => report.pageErrors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') report.console.push(msg.text()); });
  page.on('response', (res) => { if (res.status() >= 400) report.badResponses.push(`${res.status()} ${res.url()}`); });

  // Boot the page, install the draw probes, and expose a level loader that does
  // not inherit a saved boss checkpoint.
  const fresh = async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__game && window.__levels', null, { timeout: 60000 });
    await sleep(350);
    await page.evaluate(() => {
      window.__hud = { text: [], fillStyles: [] };
      window.__resetHud = () => { window.__hud = { text: [], fillStyles: [] }; };
      const proto = CanvasRenderingContext2D.prototype;
      const fillText = proto.fillText;
      const fillRect = proto.fillRect;
      proto.fillText = function (t, ...rest) {
        window.__hud.text.push(String(t));
        return fillText.call(this, t, ...rest);
      };
      proto.fillRect = function (...a) {
        window.__hud.fillStyles.push(String(this.fillStyle));
        return fillRect.apply(this, a);
      };
      window.__load = (id) => {
        const g = window.__game;
        const i = window.__levels.findIndex((l) => l.id === id);
        document.getElementById('frontEnd')?.style.setProperty('display', 'none');
        g.language = 'zh';
        g.crackClaims = {};
        g.bossRun = null;
        g.bossResume = null;
        g.loadLevel(window.__levels[i], i);
        g.state = 'playing';
        g.intro = null;
        g.bonusReturn = null;
        g.bonusLevelId = null;
        g.crackEnter = null;
        g.cracks?.forEach((c) => { c.used = false; });
        return { id: g.level.id, w: g.level.world.w, h: g.level.world.h, cell: g.level.world.cell };
      };
      window.__cam = () => ({ scale: window.__game.cam.scale, ox: window.__game.cam.ox, oy: window.__game.cam.oy });
    });
  };

  // --- 1. wall cracks -----------------------------------------------------
  // Stand on the floor tile beside the painted crack (that is where a player who
  // pushed against the wall ends up) and check the hero is pulled through. The
  // walkability of that tile from the spawn is covered by the Node suite.
  const crackCases = [
    { id: 'map98', target: 'map798' }, // 1-7
    { id: 'map724', target: 'map584' }, // 3-2
    { id: 'map709', target: 'map522' }, // 3-8
    { id: 'map525', target: 'map756' }, // 5-2
  ];
  const crackResults = [];
  for (const c of crackCases) {
    await fresh();
    const setup = await page.evaluate((id) => {
      window.__load(id);
      const g = window.__game;
      const crack = g.cracks[0];
      const stand = g.level.world.closestOpen(crack.x, crack.y, g.mouse.radius);
      g.mouse.x = stand.x;
      g.mouse.y = stand.y;
      g.mouse.clearPath();
      g.mouse.moving = false;
      return {
        stand,
        crack: { x: crack.x, y: crack.y },
        distToDecal: Math.hypot(stand.x - crack.x, stand.y - crack.y),
        distToTrigger: Math.hypot(stand.x - crack.trigger.x, stand.y - crack.trigger.y),
        reach: g.level.world.cell * 1.1,
      };
    }, c.id);
    let entered = false;
    let landed = c.id;
    for (let i = 0; i < 50; i++) {
      await sleep(120);
      const s = await page.evaluate(() => ({ enter: !!window.__game.crackEnter, level: window.__game.level.id }));
      entered = entered || s.enter;
      landed = s.level;
      if (landed !== c.id) break;
    }
    crackResults.push({ level: c.id, target: c.target, landed, ...setup, sawTransit: entered });
  }
  expect(
    crackResults.every((r) => r.landed === r.target),
    '1 wall cracks open on contact',
    crackResults.map((r) => ({ level: r.level, landed: r.landed, decal: +r.distToDecal.toFixed(1), trigger: +r.distToTrigger.toFixed(1), reach: +r.reach.toFixed(1), sawTransit: r.sawTransit })),
  );

  // --- boss entrance ------------------------------------------------------
  await fresh();
  const dims = await page.evaluate(() => window.__load('map736'));
  await sleep(450);
  const viewing = await page.evaluate(() => {
    const g = window.__game;
    return { cssH: g.cssH, cssW: g.cssW, worldH: g.level.world.h, worldW: g.level.world.w };
  });

  // --- 4. full height, no vertical pan ------------------------------------
  const camStart = await page.evaluate(() => window.__cam());
  expect(
    viewing.worldH * camStart.scale <= viewing.cssH + 1,
    '4a full map height fits the screen',
    { worldH: viewing.worldH, scale: +camStart.scale.toFixed(4), onScreen: +(viewing.worldH * camStart.scale).toFixed(1), cssH: viewing.cssH },
  );
  const oys = [];
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowDown']) {
    await page.keyboard.down(key);
    await sleep(280);
    await page.keyboard.up(key);
    await sleep(140);
    oys.push(await page.evaluate(() => window.__cam().oy));
  }
  const oySpread = Math.max(...oys) - Math.min(...oys);
  expect(oySpread <= 1.5, '4b the camera never pans vertically', { oys: oys.map((v) => +v.toFixed(2)), spread: +oySpread.toFixed(2) });

  // --- 3. the advance follows the cat's x, not a clock ----------------------
  // The authored driver is cat type 3 (`bosscat`). Its route is a mix of
  // horizontal and vertical legs, so the scroll distance over 2 s must equal
  // the cat's x displacement - and be smaller than a constant 60 px/s clock.
  await page.evaluate(() => { window.__load('map736'); window.__game.mouse.clearPath(); });
  await sleep(200);
  const t0 = await page.evaluate(() => {
    const g = window.__game;
    const cat = g.level.cats.find((c) => c.type === 3);
    return { t: performance.now(), trail: g.bossFlow.trail, catX: cat?.x ?? null };
  });
  await sleep(2000);
  const t1 = await page.evaluate(() => {
    const g = window.__game;
    const cat = g.level.cats.find((c) => c.type === 3);
    return { t: performance.now(), trail: g.bossFlow.trail, catX: cat?.x ?? null };
  });
  const seconds = (t1.t - t0.t) / 1000;
  const catDx = t1.catX - t0.catX;
  const trailDx = t1.trail - t0.trail;
  const catWalk = 3.75 * dims.cell;
  expect(
    Math.abs(trailDx - catDx) <= 2 && catDx > 0 && catDx < catWalk * seconds,
    '3a the advance equals the white cat horizontal displacement',
    { seconds: +seconds.toFixed(2), trailDx: +trailDx.toFixed(1), catDx: +catDx.toFixed(1), clock: +(catWalk * seconds).toFixed(1) },
  );

  // Take manual control of the authored driver to prove the two legs:
  // 1 s of pure vertical motion -> camera frozen; 1 s of +1px/frame x -> +dx.
  await page.evaluate(() => {
    window.__load('map816');
    const g = window.__game;
    g.mouse.clearPath();
    const cat = g.level.cats.find((c) => c.type === 3);
    window.__catProbe = cat;
    // The first authored leg of map816 is straight down; keep it vertical
    // under our control so the assertion cannot depend on route timing.
    // Drive it at the authored 60 px/s using the real dt so a high-refresh
    // rAF loop (dt < 1/60) does not outrun the per-frame clamp.
    cat.update = (dt) => { cat.y += 60 * (dt || 1 / 60); };
  });
  await sleep(150);
  const v0 = await page.evaluate(() => ({ trail: window.__game.bossFlow.trail, catX: window.__catProbe.x }));
  await sleep(1000);
  const v1 = await page.evaluate(() => ({ trail: window.__game.bossFlow.trail, catX: window.__catProbe.x }));
  expect(
    Math.abs(v1.trail - v0.trail) < 0.5 && Math.abs(v1.catX - v0.catX) < 0.5,
    '3b a vertical white-cat leg stops the camera',
    { trail: [v0.trail, v1.trail], catX: [v0.catX, v1.catX] },
  );
  await page.evaluate(() => {
    const cat = window.__catProbe;
    cat.update = (dt) => { cat.x += 60 * (dt || 1 / 60); };
  });
  await sleep(1000);
  const h1 = await page.evaluate(() => ({ trail: window.__game.bossFlow.trail, catX: window.__catProbe.x }));
  expect(
    Math.abs((h1.trail - v1.trail) - (h1.catX - v1.catX)) <= 2,
    '3c a horizontal white-cat leg advances the camera by dx',
    { trailDx: +(h1.trail - v1.trail).toFixed(1), catDx: +(h1.catX - v1.catX).toFixed(1) },
  );

  // --- 2 + 5. no sector wording, no red band, no "keep up" label ----------
  // The whole frame paints plenty of reds (level art, cat cones), so the HUD is
  // probed on its own: drawHud() into a recording context, exactly as the game
  // calls it, plus the real frame's text list for the wording check.
  const hudProbe = await page.evaluate(() => {
    const g = window.__game;
    const calls = [];
    const probe = new Proxy({}, {
      get: (t, k) => {
        if (k === 'measureText') return () => ({ width: 40 });
        if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...a) => calls.push({ k, args: a.map((v) => (typeof v === 'string' ? v : typeof v === 'number' ? v : null)) });
      },
      set: (t, k, v) => { calls.push({ k, args: [String(v)] }); return true; },
    });
    g.bossFlow.drawHud(probe, g);
    return calls;
  });
  const hudText = hudProbe.filter((c) => c.k === 'fillText').map((c) => String(c.args[0]));
  const hudFills = hudProbe.filter((c) => c.k === 'fillStyle').map((c) => String(c.args[0]));
  const hudShapes = hudProbe.filter((c) => c.k === 'fill').length;
  expect(hudText.length === 0, '2a the run HUD prints no words', { printed: hudText });
  const reds = hudFills.filter((s) => {
    const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m && Number(m[1]) > 170 && Number(m[2]) < 130 && Number(m[3]) < 130;
  });
  expect(reds.length === 0, '5a the run HUD paints no danger red', { reds, fills: hudFills });
  expect(hudShapes === 4, '5b the run HUD is only the four progress pips', { fills: hudShapes });

  // Walk the advance up to the boss reveal: the sector changes are what used to
  // raise the "第 n 区段" banner, so they must stay silent all the way through.
  await page.evaluate(() => { window.__load('map736'); window.__resetHud(); });
  await sleep(200);
  await page.evaluate((x) => { window.__game.mouse.x = x; }, viewing.worldW * 0.95);
  const sectorSamples = [];
  for (let i = 0; i < 90; i++) {
    await sleep(250);
    const s = await page.evaluate(() => ({
      sector: window.__game.bossFlow.sector,
      banner: window.__game.bossFlow.banner.text,
      state: window.__game.state,
    }));
    sectorSamples.push(s);
    if (s.sector >= 3 || s.state !== 'playing') break;
  }
  const frameHud = await page.evaluate(() => window.__hud);
  const badText = frameHud.text.filter((t) => /区段|SECTOR|别被甩下|KEEP UP|追上/i.test(t));
  expect(badText.length === 0, '2b no wording is ever printed on the frame', { bad: badText });
  expect(Math.max(...sectorSamples.map((s) => s.sector)) >= 3, '2c the run still reaches the boss sector', { last: sectorSamples.slice(-2) });
  expect(sectorSamples.every((s) => s.banner === ''), '2d no banner text is ever raised', sectorSamples.map((s) => s.banner));

  // --- 6. retry after being left behind ----------------------------------
  await fresh();
  await page.evaluate(() => window.__load('map736'));
  await sleep(250);
  const start = await page.evaluate(() => ({ trail: window.__game.bossFlow.trail, heroX: window.__game.mouse.x }));
  let caught = null;
  for (let i = 0; i < 140; i++) {
    await sleep(150);
    caught = await page.evaluate(() => ({
      state: window.__game.state,
      trail: window.__game.bossFlow.trail,
      cause: window.__game.death?.cause || null,
    }));
    if (caught.state !== 'playing') break;
  }
  expect(caught.state === 'caught' && caught.cause === 'scroll', '6a standing still loses the run', { start, caught });

  const afterRetry = await page.evaluate(() => {
    const g = window.__game;
    g.retryLevel();
    return {
      state: g.state,
      death: g.death,
      trail: g.bossFlow.trail,
      heroX: g.mouse.x,
      revealed: g.bossFlow.revealed,
      bossActor: !!g.bossFlow.bossActor,
      cinematic: !!g.bossFlow.cinematic,
    };
  });
  expect(
    afterRetry.state === 'playing' && afterRetry.death === null && afterRetry.trail < afterRetry.heroX,
    '6b retry rebuilds the advance behind the hero',
    afterRetry,
  );
  // The old bug: the edge stayed where the run died, so the respawned hero was
  // instantly behind it and lost again within a frame.
  await sleep(2400);
  const revived = await page.evaluate(() => ({
    state: window.__game.state,
    trail: window.__game.bossFlow.trail,
    cause: window.__game.death?.cause || null,
  }));
  expect(revived.state === 'playing' && revived.trail > afterRetry.trail, '6c the retried run is playable', revived);

  fs.mkdirSync('analysis/screenshots', { recursive: true });
  await page.screenshot({ path: 'analysis/screenshots/boss-run-verify.png' });
  report.screenshot = 'analysis/screenshots/boss-run-verify.png';
  await browser.close();
} catch (error) {
  report.error = String(error?.stack || error);
  failures.push(`harness: ${error?.message || error}`);
} finally {
  if (server) server.kill();
}

report.failures = failures;
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
