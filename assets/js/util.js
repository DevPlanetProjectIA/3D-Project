/* Utilidades gerais: DOM, formatação, ícones, toasts e modais. */

/* ---------- DOM ---------- */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escapa texto para interpolação segura em HTML. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapa texto para uso dentro de um atributo entre aspas duplas. */
export const escAttr = esc;

/** Cria um elemento a partir de uma string HTML. */
export function fromHTML(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

export function on(root, selector, type, handler) {
  root.addEventListener(type, (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest(selector) : null;
    if (target && root.contains(target)) handler(ev, target);
  });
}

export function debounce(fn, wait = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ---------- Formatação ---------- */

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function formatNumber(n) {
  return new Intl.NumberFormat('pt-BR').format(Number(n) || 0);
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatRelative(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536e6], ['month', 2592e6], ['week', 6048e5],
    ['day', 864e5], ['hour', 36e5], ['minute', 6e4],
  ];
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return 'agora mesmo';
}

export function formatMm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(n < 100 ? 1 : 0)} mm`;
}

/** Converte um texto livre em slug utilizável como caminho. */
export function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'modelo';
}

/** Cor estável derivada de uma string, para avatares. */
export function colorFor(seed) {
  let hash = 0;
  for (let i = 0; i < String(seed).length; i++) hash = (hash * 31 + String(seed).charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 48%)`;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/[\s_.-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ---------- Ícones (Lucide-like, 24x24 stroke) ---------- */

const ICONS = {
  cube: '<path d="M12 2 22 7.5v9L12 22 2 16.5v-9z"/><path d="M2 7.5 12 13l10-5.5M12 13v9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M3 15v3a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3"/>',
  download: '<path d="M12 4v12m0 0 5-5m-5 5-5-5"/><path d="M3 15v3a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3"/>',
  library: '<path d="M3 5h5v14H3zM10 5h5v14h-5zM17.5 5.5l3.5 13"/>',
  star: '<path d="m12 3 2.9 5.9 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.9l1.2-6.5L2.5 9.8l6.6-.9z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 2.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M9 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h3"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  login: '<path d="M15 3h3a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-3"/><path d="M10 17l-5-5 5-5M3 12h12"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.4 3.3M6.1 6.3A18 18 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4-.8"/><path d="m9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 5-5"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  tag: '<path d="M3 11.5V5a2 2 0 0 1 2-2h6.5L21 12.5 12.5 21z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6v.1M3.5 12v.1M3.5 18v.1"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 4.5-1.4 4.5-5a4 4 0 0 0-1.1-2.8 3.7 3.7 0 0 0-.1-2.8s-1.2-.4-3.8 1.4a9.3 9.3 0 0 0-5 0C6.4 2.7 5.2 3.1 5.2 3.1a3.7 3.7 0 0 0-.1 2.8A4 4 0 0 0 4 8.7c0 3.6 1.7 4.7 4.5 5-.6.6-.6 1.2-.5 2V21"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8-8M17 4l3 3M14.5 6.5l3 3"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
  triangle: '<path d="M12 4 3 19h18z"/>',
  ruler: '<path d="M3 15.5 8.5 21 21 8.5 15.5 3z"/><path d="m7 12 2 2M10 9l2 2M13 6l2 2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  home: '<path d="M4 10.5 12 3l8 7.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',
  wifiOff: '<path d="m2 2 20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 3-2M2 8.8A16 16 0 0 1 8 5.3M14.5 5.5A16 16 0 0 1 22 8.8M16.5 11.8A10 10 0 0 1 19 13M12 20v.1"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M21 4v4h-4M3 20v-4h4"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};

/** Retorna o markup de um ícone SVG. */
export function icon(name, size = 18, extraClass = '') {
  const body = ICONS[name] || ICONS.box;
  return `<svg class="ico ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ---------- Toasts ---------- */

const TOAST_ICON = { success: 'checkCircle', error: 'alert', warn: 'alert', info: 'info' };

export function toast(message, { type = 'info', title = '', timeout = 4800 } = {}) {
  const host = qs('#toasts');
  if (!host) return;
  const node = fromHTML(`
    <div class="toast toast--${esc(type)}">
      ${icon(TOAST_ICON[type] || 'info', 18)}
      <div class="toast__main">
        ${title ? `<strong>${esc(title)}</strong>` : ''}
        <span>${esc(message)}</span>
      </div>
      <button class="toast__close" type="button" aria-label="Fechar">${icon('x', 15)}</button>
    </div>`);
  const dismiss = () => {
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };
  node.querySelector('.toast__close').addEventListener('click', dismiss);
  host.appendChild(node);
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}

/* ---------- Modal ---------- */

/**
 * Abre um modal. `render(close)` recebe o fechador e devolve o markup interno.
 * Retorna uma promessa resolvida com o valor passado a `close()`.
 */
export function openModal(render, { wide = false, dismissable = true } = {}) {
  const root = qs('#modal-root');
  return new Promise((resolve) => {
    const overlay = fromHTML(`<div class="modal" role="dialog" aria-modal="true"><div class="modal__box${wide ? ' modal__box--wide' : ''}"></div></div>`);
    const box = overlay.firstElementChild;
    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (ev) => { if (ev.key === 'Escape' && dismissable) close(undefined); };
    box.innerHTML = render(close);
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay && dismissable) close(undefined); });
    document.addEventListener('keydown', onKey);
    root.appendChild(overlay);
    box.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => close(btn.dataset.close || undefined));
    });
    const focusTarget = box.querySelector('[autofocus], input, button');
    if (focusTarget) focusTarget.focus();
    overlay.dispatchEvent(new CustomEvent('modal:ready', { detail: { box, close } }));
    // Permite ao chamador capturar o box pelo microtask seguinte.
    queueMicrotask(() => overlay.dataset.ready = '1');
  });
}

/** Modal de confirmação. Resolve `true` quando confirmado. */
export async function confirmDialog({
  title = 'Confirmar',
  message = '',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
} = {}) {
  const result = await openModal((close) => `
    <div class="modal__head"><h2>${esc(title)}</h2>
      <button class="btn btn--ghost btn--icon" type="button" data-close="">${icon('x', 18)}</button></div>
    <div class="modal__body"><p class="muted">${esc(message)}</p></div>
    <div class="modal__foot">
      <button class="btn" type="button" data-close="">${esc(cancelLabel)}</button>
      <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-close="yes" autofocus>${esc(confirmLabel)}</button>
    </div>`);
  return result === 'yes';
}

/* ---------- Diversos ---------- */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  }
}

export function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle('is-loading', !!busy);
  button.disabled = !!busy;
}
