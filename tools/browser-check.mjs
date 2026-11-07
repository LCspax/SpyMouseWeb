// Real-browser smoke harness (Playwright Core + the user's installed Chrome).
// Used by the Lead for visual/interaction checks that the DOM stub in
// tools/smoke.mjs cannot cover.
//
//   node tools/browser-check.mjs [--url http://127.0.0.1:5199/] [--headed]
//
// Without --url it starts tools/serve.mjs on a free port, runs the checks,
// writes screenshots to analysis/screenshots/ and prints a JSON report.
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

async function waitFor(url, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* server not yet up */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`server did not start: ${url}`);
}

let server = null;
let baseUrl = externalUrl;
const report = { url: null, console: [], pageErrors: [], badResponses: [], checks: {}, screenshots: [] };

try {
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.execPath, ['tools/serve.mjs', String(port)], {
      cwd: path.resolve('.'),
      stdio: 'ignore',
    });
    baseUrl = `http://127.0.0.1:${port}/`;
    await waitFor(baseUrl);
  }
  report.url = baseUrl;

  const executablePath = chromePath();
  if (!executablePath) throw new Error('Chrome not found; set CHROME_PATH');
  const browser = await chromium.launch({
    executablePath,
    headless: !headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') report.console.push(msg.text());
  });
  page.on('pageerror', (err) => report.pageErrors.push(String(err)));
  page.on('response', (res) => {
    if (res.status() >= 400) report.badResponses.push({ status: res.status(), url: res.url() });
  });
  page.on('requestfailed', (req) => {
    report.badResponses.push({ status: 'failed', url: req.url(), error: req.failure()?.errorText });
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#frontEnd:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(400);

  fs.mkdirSync('analysis/screenshots', { recursive: true });
  const shot = async (name) => {
    const file = path.join('analysis/screenshots', name);
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  };

  // Expensive to keep all of them? Only record the things the stubs miss.
  report.checks.menu = await page.evaluate(() => ({
    visibleStages: [...document.querySelectorAll('.menu-stage')].filter((el) => getComputedStyle(el).display !== 'none').length,
    startButtons: [...document.querySelectorAll('[data-action="start"]')].filter((el) => el.offsetParent !== null).length,
    logos: [...document.querySelectorAll('.menu-logo')].filter((el) => el.offsetParent !== null).length,
  }));
  await shot('01-home.png');

  await page.locator('[data-action="start"]').click();
  // Sample the whole 0.4 s transition: the old bug replayed stage-in when
  // .stage-swap was removed at 280 ms, so a single 350 ms snapshot is not
  // enough to prove the fix.
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(40);
    samples.push(await page.evaluate(() => document.getAnimations().map((a) => a.animationName)));
  }
  report.checks.afterStart = await page.evaluate(() => ({
    view: document.querySelector('#frontEnd')?.dataset.view,
    visibleStages: [...document.querySelectorAll('.menu-stage')].filter((el) => getComputedStyle(el).display !== 'none').length,
    animations: document.getAnimations().map((a) => a.animationName),
    visibleMapNodes: [...document.querySelectorAll('.map-node')].filter((el) => el.offsetParent !== null).length,
  }));
  report.checks.transitionSamples = samples.map((names, i) => ({ ms: (i + 1) * 40, names }));
  report.checks.stageInReplayed = samples.some((names) => names.includes('stage-in'));
  await shot('02-world.png');

  await page.locator('[data-action="home"]').click();
  const homeSamples = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(40);
    homeSamples.push(await page.evaluate(() => document.getAnimations().map((a) => a.animationName)));
  }
  report.checks.afterHome = await page.evaluate(() => ({
    view: document.querySelector('#frontEnd')?.dataset.view,
    visibleStages: [...document.querySelectorAll('.menu-stage')].filter((el) => getComputedStyle(el).display !== 'none').length,
    animations: document.getAnimations().map((a) => a.animationName),
  }));
  report.checks.homeStageInReplayed = homeSamples.some((names) => names.includes('stage-in'));
  await shot('03-home-again.png');

  // Portrait home (multi-device): the 1024x640 backdrop must follow the stage
  // transform as one unit, and the landscape recommendation must be visible in
  // the spare space below the letterboxed scene.
  const portraitContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const portraitPage = await portraitContext.newPage();
  const portraitErrors = [];
  portraitPage.on('pageerror', (err) => portraitErrors.push(String(err)));
  await portraitPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await portraitPage.waitForSelector('#frontEnd:not([hidden])', { timeout: 15000 });
  await portraitPage.waitForTimeout(400);
  report.checks.portraitHome = await portraitPage.evaluate(() => {
    const stage = document.querySelector('.menu-stage.home-stage')?.getBoundingClientRect();
    const backdrop = document.querySelector('.menu-backdrop')?.getBoundingClientRect();
    const hint = document.querySelector('.portrait-hint');
    return {
      hintVisible: !!hint && getComputedStyle(hint).display !== 'none',
      hintText: document.querySelector('.portrait-hint-text')?.textContent || '',
      stageBackdropAligned: !!stage && !!backdrop
        && Math.abs(stage.top - backdrop.top) < 1
        && Math.abs(stage.height - backdrop.height) < 1
        && Math.abs((stage.left + stage.width / 2) - (backdrop.left + backdrop.width / 2)) < 1,
    };
  });
  report.checks.portraitHome.errors = portraitErrors;
  await portraitPage.screenshot({ path: 'analysis/screenshots/05-home-portrait.png' });
  report.screenshots.push('analysis/screenshots/05-home-portrait.png');
  await portraitContext.close();

  // Backpack: all 17 cards exist and the modal body can scroll to the last one.
  await page.locator('#frontEnd [data-action="start"]').click();
  await page.waitForSelector('#frontEnd[data-view="world"]', { timeout: 8000 });
  await page.locator('#frontEnd [data-action="bag"]').click();
  await page.waitForSelector('#frontEnd .backpack-grid', { timeout: 8000 });
  report.checks.backpack = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#frontEnd .dossier-card')];
    const body = document.querySelector('#frontEnd .modal-body');
    body.scrollTop = body.scrollHeight;
    const last = cards.at(-1)?.getBoundingClientRect();
    const panel = document.querySelector('#frontEnd .options-card')?.getBoundingClientRect();
    return {
      cards: cards.length,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      scrollable: body.scrollHeight > body.clientHeight + 4,
      lastCardInsidePanel: !!(last && panel && last.top >= panel.top - 2 && last.bottom <= panel.bottom + 2),
    };
  });
  await shot('04-backpack.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Regression: a returning player with saved dossiers must boot into the menu
  // (round-3 bug: game.dossiers was initialised inside resetLevel, so seeding
  // before loadLevel crashed boot and the menu never appeared).
  const seededContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await seededContext.addInitScript(() => {
    localStorage.setItem('spymouse.progress.v1', JSON.stringify({ done: [], last: 0, dossiers: [0, 1, 2, 3] }));
  });
  const seededPage = await seededContext.newPage();
  const seededErrors = [];
  seededPage.on('pageerror', (err) => seededErrors.push(String(err)));
  await seededPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await seededPage.waitForSelector('#frontEnd:not([hidden])', { timeout: 15000 });
  report.checks.seededDossiers = await seededPage.evaluate(() => ({
    menuVisible: !document.querySelector('#frontEnd')?.hidden,
    dossierCount: window.__game?.dossiers?.size ?? -1,
    saved: JSON.parse(localStorage.getItem('spymouse.progress.v1') || '{}').dossiers?.length ?? -1,
  }));
  report.checks.seededDossiers.errors = seededErrors;
  await seededContext.close();

  await browser.close();
} catch (error) {
  report.error = String(error?.stack || error);
} finally {
  if (server) server.kill();
}

console.log(JSON.stringify(report, null, 2));
if (report.error) process.exitCode = 1;
