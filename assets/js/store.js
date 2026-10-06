/* Persistência local tolerante a falhas (modo privado, cota cheia, etc.). */

const PREFIX = 'stlib.';

function safeParse(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export const store = {
  get(key, fallback = null) {
    try { return safeParse(localStorage.getItem(PREFIX + key), fallback); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignorado */ }
  },
  /** Valores de sessão: descartados ao fechar a aba. */
  session: {
    get(key, fallback = null) {
      try { return safeParse(sessionStorage.getItem(PREFIX + key), fallback); }
      catch { return fallback; }
    },
    set(key, value) {
      try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
    remove(key) {
      try { sessionStorage.removeItem(PREFIX + key); } catch { /* ignorado */ }
    },
  },
};

export default store;
