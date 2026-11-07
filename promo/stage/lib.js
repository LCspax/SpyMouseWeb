export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => clamp((v - a) / (b - a));
export const easeOut = t => 1 - Math.pow(1 - t, 3);
export const easeIn = t => t * t * t;
export const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const pulse = (t, freq = 1) => .5 + .5 * Math.sin(t * Math.PI * 2 * freq);

export function el(tag, cls, parent, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  if (parent) parent.appendChild(n);
  return n;
}
export function css(n, obj) { Object.assign(n.style, obj); return n; }

let timeline = null;
export async function TL() {
  if (!timeline) timeline = await (await fetch('./timeline.json')).json();
  return timeline;
}

export function video(src, parent, startAt = 0, rate = 1) {
  const v = el('video', '', parent);
  v.src = src; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.dataset.start = startAt; v.dataset.rate = rate;
  return v;
}

export const registry = [];
export function defineShot(id, build) { registry.push({ id, build }); }
