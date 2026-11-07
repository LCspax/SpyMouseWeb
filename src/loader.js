/**
 * loader.js - the loading transition shown before the menu and before every
 * level starts.
 *
 * The screen itself lives in index.html (#loader) so the very first paint is
 * already covered; this module only drives it. Two rules keep it honest:
 *
 *   1. the number on the bar comes from real work (level list, level art,
 *      sprite sheets), never from a fake timer;
 *   2. a load that finishes instantly still holds the screen for a beat, so a
 *      cached level does not flash a yellow frame for 40 ms.
 *
 * Everything is guarded: the Node smoke harness stubs the DOM, and none of this
 * may break the boot path there.
 */

const MIN_VISIBLE_MS = 560; // shortest time the screen stays up
const FADE_MS = 320; // must match the .loading-screen opacity transition
const nowMs = () =>
  typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const rafFn = (cb) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(() => cb(nowMs()), 16);

/** Resolve on the next animation frame (or the next tick when there is none). */
export const nextFrame = () => new Promise((resolve) => rafFn(() => resolve()));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The CSS failsafe hides the loader if the module graph never runs. Once this
// file is evaluated we own the element, so the failsafe must stop applying.
try {
  if (typeof document !== 'undefined' && document.documentElement?.classList) {
    document.documentElement.classList.add('loader-armed');
  }
} catch { /* DOM-less harness */ }

/** Load one image, resolving null instead of rejecting. */
export function loadImage(url) {
  if (!url || typeof Image !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = url;
      // decode() resolves once the bitmap is ready to paint, which is what the
      // first frame of the level actually needs.
      if (typeof img.decode === 'function') img.decode().then(() => done(img), () => {});
    } catch {
      done(null);
    }
  });
}

/** Load a list of images, reporting 0..1 as they settle. */
export async function loadImages(urls, onProgress) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) {
    onProgress?.(1);
    return;
  }
  let done = 0;
  await Promise.all(
    list.map(async (url) => {
      await loadImage(url);
      done += 1;
      onProgress?.(done / list.length);
    }),
  );
  onProgress?.(1);
}

/** Poll `predicate` on animation frames until it is true or `timeout` elapses. */
export async function waitFor(predicate, timeout = 1000) {
  const started = nowMs();
  for (;;) {
    try {
      if (predicate()) return true;
    } catch { return false; }
    if (nowMs() - started >= timeout) return false;
    await nextFrame();
  }
}

/** Wait for the sprite sheets the level will draw (already cached on replay). */
export async function warmUpSprites(sprites, timeout = 1200) {
  if (!sprites || sprites.enabled === false || typeof sprites.ready !== 'function') return true;
  const keys = Object.keys(sprites.images || {});
  if (!keys.length) return true;
  return waitFor(() => keys.every((key) => sprites.ready(key)), timeout);
}

// The home stage pulls these the first time it is shown; warming them before the
// loader fades keeps the menu from popping in image by image.
export const MENU_ART = [
  'assets/menu/logo.png',
  'assets/menu/main_menu_bg.png',
  'assets/menu/main_menu_bg_padleft.png',
  'assets/menu/main_menu_bg_padright.png',
  'assets/menu/mm_mouse.png',
  'assets/menu/mm_mouse_open.png',
  'assets/menu/main_menu_cheese.png',
  'assets/menu/play.png',
];

/** Level art: the painted background (plus extra-floor backgrounds) + sheets. */
export async function warmLevelArt(game, onProgress) {
  const level = game?.level;
  if (!level) {
    onProgress?.(1);
    return;
  }
  const urls = [];
  if (level.bg) urls.push(level.bg);
  for (const floor of level.extraFloors || []) {
    if (floor?.bg && !urls.includes(floor.bg)) urls.push(floor.bg);
  }
  await loadImages(urls, (p) => onProgress?.(p * 0.75));
  await warmUpSprites(game?.sprites, 1200);
  onProgress?.(1);
}

/**
 * Drives #loader. Safe to construct without a DOM: every method degrades to a
 * no-op so the Node harness and any stripped-down host keep working.
 */
export class LoadingScreen {
  constructor(el) {
    this.el = el || null;
    this.fill = this.#find('.loading-fill');
    this.label = this.#find('.loading-percent');
    this.value = 0;
    this.target = 0;
    this.shownAt = 0;
    this.lastTargetAt = 0;
    this.timer = null;
    this.busy = false;
  }

  #find(selector) {
    try {
      return this.el && typeof this.el.querySelector === 'function' ? this.el.querySelector(selector) : null;
    } catch {
      return null;
    }
  }

  get ok() {
    return !!(this.el && this.el.style && this.el.classList);
  }

  /** Instant to show (the CSS transition only runs on the way out). */
  show() {
    if (!this.ok) return;
    this.busy = true;
    this.el.classList.remove('is-done');
    try { this.el.removeAttribute('aria-hidden'); } catch { /* stub */ }
    this.shownAt = nowMs();
    this.lastTargetAt = this.shownAt;
    this.value = 0;
    this.target = 0.02;
    this.#paint();
    this.#startLoop();
  }

  /** Queue a progress value (0..1); the bar eases towards it. */
  setProgress(value) {
    const next = Math.max(0, Math.min(1, Number(value) || 0));
    if (next > this.target + 0.002) this.lastTargetAt = nowMs();
    this.target = Math.max(this.target, next); // never walk backwards
  }

  /** Fill the bar, hold the minimum on-screen time, then fade out. */
  async hide() {
    if (!this.ok) {
      this.busy = false;
      return;
    }
    this.setProgress(1);
    const elapsed = nowMs() - this.shownAt;
    await wait(Math.max(0, MIN_VISIBLE_MS - elapsed));
    // Let the eased value actually reach the end before the fade starts.
    const deadline = nowMs() + 420;
    while (this.value < 0.99 && nowMs() < deadline) await wait(16);
    this.value = 1;
    this.#paint();
    this.#stopLoop();
    this.el.classList.add('is-done');
    await wait(FADE_MS);
    try { this.el.setAttribute('aria-hidden', 'true'); } catch { /* stub */ }
    this.el.classList.remove('is-done');
    this.busy = false;
  }

  /** Reset without animating (used when a load is abandoned). */
  cancel() {
    this.#stopLoop();
    this.value = 0;
    this.target = 0;
    this.busy = false;
    if (!this.ok) return;
    this.el.classList.add('is-done');
    try { this.el.setAttribute('aria-hidden', 'true'); } catch { /* stub */ }
    this.el.classList.remove('is-done');
  }

  #startLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => this.#tick(), 16);
    // Do not keep a Node process alive for a decorative timer.
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  #stopLoop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  #tick() {
    const delta = this.target - this.value;
    // Ease upwards only: after a creep the bar can sit past `target`, and
    // rewinding it would look like the load went backwards.
    if (delta > 0.002) this.value += delta * 0.165;
    else if (delta > -0.002) this.value = this.target;
    // A single big file (a level background) can block for seconds with the
    // number frozen. Creep towards 92% while we wait so the bar still reads as
    // "working" - it never claims completion and snaps forward the moment the
    // real milestone lands.
    const stalled = nowMs() - this.lastTargetAt > 800;
    if (stalled && this.value < 0.92) this.value += 0.00045;
    this.#paint();
  }

  #paint() {
    const percent = Math.round(this.value * 100);
    if (this.fill && this.fill.style) this.fill.style.width = `${percent}%`;
    if (this.label) this.label.textContent = `${percent}%`;
    try {
      if (this.el && typeof this.el.setAttribute === 'function') {
        this.el.setAttribute('aria-valuenow', String(percent));
      }
    } catch { /* stub */ }
  }
}
