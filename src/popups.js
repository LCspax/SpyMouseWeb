// Reusable popups for the SpyMouse web port.
//
// Native reference (ui lane findings):
//   tip.gui         FRAME + ui/popup_first_item.png + LBL_TITLE + CONGRATULATIONS + LBL_ITEM_TEXT
//   achi_popup.gui  hud/achievement_popup.png + ACHIEVEMENT_ICON + ACHIEVEMENT_TITLE
//   popup_tutorial  ui/popup_tutorial.png + LBL_TITLE + TUTORIAL_IMG
//   msgbox.gui      FRAME_MAIN + ui/popup_msgbox.png + LBL_TEXT
// Achievement popups slide in from the right (fcn.0xaef78 sets a negative
// horizontal offset = off-screen start) and play ui_achievement (id 0).
//
// The module top level never touches the DOM: everything below only runs when
// a popup is actually opened, so importing it from Node / smoke is safe.

import {audio} from './audio.js';

const SPRITES = {
  achievement: 'assets/ui/achievement_popup.png',
  tip: 'assets/ui/popup_first_item.png',
  tutorial: 'assets/ui/popup_tutorial.png',
  msgbox: 'assets/ui/popup_msgbox.png',
};

const DEFAULT_SOUND = {achievement: 0, tip: 144, tutorial: 1, msgbox: 1};

function doc() {
  return typeof document !== 'undefined' && document ? document : null;
}

function textOf(value) {
  return value == null ? '' : String(value);
}

/** Find (or lazily create) the popup layer inside `host` (defaults to body). */
function ensureLayer(host) {
  const d = doc();
  if (!d) return null;
  const root = host || d.body;
  if (!root || typeof root.appendChild !== 'function') return null;
  let layer = null;
  if (typeof root.querySelector === 'function') layer = root.querySelector('.game-popup-layer');
  if (!layer) {
    layer = d.createElement('div');
    layer.className = 'game-popup-layer';
    root.appendChild(layer);
  }
  return layer;
}

let singletonKeyHandler = null;

/**
 * Open a popup.
 *
 * @param {object} opts
 * @param {'achievement'|'tip'|'tutorial'|'msgbox'} [opts.kind]
 * @param {Element} [opts.host]      element to append the layer to
 * @param {string}  [opts.title]
 * @param {string}  [opts.body]
 * @param {string}  [opts.image]     explicit art; defaults to the kind sprite
 * @param {string}  [opts.alt]
 * @param {number|null} [opts.progress] 0..1 → progress bar (achievements)
 * @param {number|null} [opts.sound]  sound id; defaults per kind, null to mute
 * @param {Function} [opts.onClose]
 * @returns {{el: Element, close: Function}|null}
 */
export function openPopup(opts = {}) {
  const d = doc();
  const layer = ensureLayer(opts.host);
  if (!d || !layer) return null;
  const kind = opts.kind || 'tip';

  const popup = d.createElement('div');
  popup.className = `game-popup game-popup--${kind}`;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');

  const panel = d.createElement('div');
  panel.className = 'game-popup__panel';
  popup.appendChild(panel);

  const banner = d.createElement('img');
  banner.className = 'game-popup__banner';
  banner.src = opts.banner || SPRITES.achievement;
  banner.alt = '';
  panel.appendChild(banner);

  if (opts.title) {
    const h = d.createElement('h2');
    h.className = 'game-popup__title';
    h.textContent = textOf(opts.title);
    panel.appendChild(h);
  }

  const body = d.createElement('div');
  body.className = 'game-popup__body';
  if (opts.body) body.textContent = textOf(opts.body);
  panel.appendChild(body);

  if (typeof opts.progress === 'number' && Number.isFinite(opts.progress)) {
    const track = d.createElement('div');
    track.className = 'game-popup__progress';
    const fill = d.createElement('div');
    fill.className = 'game-popup__progress-fill';
    fill.style.width = `${Math.max(0, Math.min(1, opts.progress)) * 100}%`;
    track.appendChild(fill);
    panel.appendChild(track);
  }

  const art = opts.image || SPRITES[kind];
  if (art) {
    const img = d.createElement('img');
    img.className = 'game-popup__art';
    img.src = art;
    img.alt = textOf(opts.alt);
    panel.appendChild(img);
  }

  const closeBtn = d.createElement('button');
  closeBtn.className = 'game-popup__close';
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', opts.closeLabel || 'Close');
  panel.appendChild(closeBtn);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    popup.classList.remove('open');
    popup.classList.add('closing');
    const remove = () => {
      if (popup.parentNode && typeof popup.parentNode.removeChild === 'function') popup.parentNode.removeChild(popup);
    };
    if (typeof setTimeout === 'function') setTimeout(remove, 220); else remove();
    if (typeof opts.onClose === 'function') opts.onClose();
  };

  closeBtn.addEventListener('click', close);
  popup.addEventListener('click', (event) => {
    if (event && event.target === popup) close();
  });

  layer.appendChild(popup);
  // next frame so the CSS transition from the off-screen state is seen
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => popup.classList.add('open'));
  else popup.classList.add('open');

  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    if (!singletonKeyHandler) {
      singletonKeyHandler = (event) => {
        if (event && event.key === 'Escape') {
          const open = document.querySelector ? document.querySelector('.game-popup.open') : null;
          if (open && open.__closePopup) open.__closePopup();
        }
      };
      document.addEventListener('keydown', singletonKeyHandler);
    }
    popup.__closePopup = close;
  }

  const sound = opts.sound === null ? null : (opts.sound == null ? DEFAULT_SOUND[kind] : opts.sound);
  if (sound != null) audio.playSound(sound, {priority: 7});

  return {el: popup, close};
}

/** Achievement/progress popup (menu "完成记录" button and unlocks). */
export function showAchievementPopup({host, title, done = 0, total = 0, language = 'zh', onClose = null, sound = null} = {}) {
  const ratio = total > 0 ? done / total : 0;
  const body = language === 'en'
    ? `${done} / ${total} levels completed`
    : `${done} / ${total} 关卡已完成`;
  return openPopup({
    host, kind: 'achievement', title, body, progress: ratio,
    closeLabel: language === 'en' ? 'Close' : '关闭',
    onClose, sound,
  });
}

/** Reward tip popup (native tip.gui: popup_first_item + title/body). */
export function showTipPopup({host, title = '', body = '', image = SPRITES.tip, alt = '', onClose = null, sound = 144} = {}) {
  return openPopup({host, kind: 'tip', title, body, image, alt, onClose, sound});
}

/** Tutorial popup (native popup_tutorial.gui; data lives in popup_tutorials/*.xml). */
export function showTutorialPopup({host, title = '', body = '', image = SPRITES.tutorial, alt = '', onClose = null, sound = 1} = {}) {
  return openPopup({host, kind: 'tutorial', title, body, image, alt, onClose, sound});
}

/** Generic message box (native msgbox.gui). */
export function showMsgbox({host, title = '', body = '', image = SPRITES.msgbox, alt = '', onClose = null, sound = 1} = {}) {
  return openPopup({host, kind: 'msgbox', title, body, image, alt, onClose, sound});
}

// ---------------------------------------------------------------------------
// Tutorial data (assets/ui/tutorials.json, generated from the plaintext
// res/popup_tutorials/*.xml by analysis/rea/ui/tools/gen_tutorials.py).
// Missing file / no fetch (Node) => empty list, callers just skip.
// ---------------------------------------------------------------------------

let tutorialCache = null;
let tutorialPromise = null;

/** Load the tutorial table once. Never throws; returns [] when unavailable. */
export async function loadTutorials() {
  if (tutorialCache) return tutorialCache;
  if (tutorialPromise) return tutorialPromise;
  tutorialPromise = (async () => {
    try {
      if (typeof fetch !== 'function') return [];
      const res = await fetch('assets/ui/tutorials.json', { cache: 'no-cache' });
      if (!res || !res.ok) return [];
      const data = await res.json();
      tutorialCache = Array.isArray(data && data.tutorials) ? data.tutorials : [];
    } catch {
      tutorialCache = [];
    }
    return tutorialCache;
  })();
  return tutorialPromise;
}

/** Show one tutorial from tutorials.json (falls back to the first entry). */
export async function showTutorialById(id, {host = null, title = '', body = '', onClose = null, sound = 1} = {}) {
  const tutorials = await loadTutorials();
  if (!tutorials.length) return null;
  const entry = tutorials.find((t) => t.id === id) || tutorials[0];
  if (!entry) return null;
  const label = String(entry.id || 'tutorial').replaceAll('_', ' ');
  const fallbackBody = [entry.titleId, entry.bodyId].filter(Boolean).join(' · ');
  return showTutorialPopup({
    host,
    title: title || label,
    body: body || fallbackBody,
    image: entry.image || undefined,
    alt: label,
    onClose,
    sound,
  });
}
