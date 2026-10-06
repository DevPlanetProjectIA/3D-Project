/*
 * Ponto de entrada: tema, roteador por hash, casca da aplicação e guarda de acesso.
 *
 * O roteamento usa o fragmento da URL (#/rota) porque o GitHub Pages serve
 * arquivos estáticos: caminhos reais exigiriam um 404 de fallback e quebrariam
 * links compartilhados.
 */

import CONFIG from '../../config.js';
import store from './store.js';
import * as auth from './auth.js';
import * as catalog from './catalog.js';
import { esc, icon, qs, qsa, toast, debounce, initials } from './util.js';

/* ---------- Tema ---------- */

const THEME_KEY = 'theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return media.matches ? 'light' : 'dark';
}

function applyTheme(preference) {
  document.documentElement.dataset.theme = resolveTheme(preference);
}

const getTheme = () => store.get(THEME_KEY, 'dark') || 'dark';
const setTheme = (preference) => {
  store.set(THEME_KEY, preference);
  applyTheme(preference);
};

applyTheme(getTheme());
media.addEventListener('change', () => { if (getTheme() === 'auto') applyTheme('auto'); });

/* ---------- Rotas ---------- */

const ROUTES = [
  { pattern: '/entrar', load: () => import('./views/login.js'), shell: false },
  { pattern: '/criar-conta', load: () => import('./views/login.js'), shell: false },
  { pattern: '/biblioteca', load: () => import('./views/library.js') },
  { pattern: '/favoritos', load: () => import('./views/library.js') },
  { pattern: '/meus-envios', load: () => import('./views/library.js') },
  { pattern: '/modelo/:id', load: () => import('./views/model.js') },
  { pattern: '/enviar', load: () => import('./views/upload.js') },
  { pattern: '/estoque', load: () => import('./views/inventory.js') },
  { pattern: '/calculadora', load: () => import('./views/calculator.js') },
  { pattern: '/orcamento', load: () => import('./views/quote.js') },
  { pattern: '/perfil', load: () => import('./views/profile.js') },
  { pattern: '/config', load: () => import('./views/settings.js') },
];

const PUBLIC_ROUTES = new Set(['/entrar', '/criar-conta']);

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  const normalized = `/${path.replace(/^\/+|\/+$/g, '')}` || '/';
  return { path: normalized === '/' ? '/biblioteca' : normalized, query: new URLSearchParams(search) };
}

function matchRoute(path) {
  for (const route of ROUTES) {
    const patternParts = route.pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) params[patternParts[i].slice(1)] = pathParts[i];
      else if (patternParts[i] !== pathParts[i]) { matched = false; break; }
    }
    if (matched) return { route, params };
  }
  return null;
}

const navigate = (path) => {
  const next = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash === next) render();
  else location.hash = next;
};

/* ---------- Casca ---------- */

const BRAND_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 22 7.5v9L12 22 2 16.5v-9z"/><path d="M2 7.5 12 13l10-5.5M12 13v9"/></svg>`;

const NAV_ITEMS = [
  { href: '#/biblioteca', route: '/biblioteca', icon: 'library', label: 'Biblioteca', count: 'models' },
  { href: '#/favoritos', route: '/favoritos', icon: 'star', label: 'Favoritos', count: 'favorites' },
  { href: '#/meus-envios', route: '/meus-envios', icon: 'upload', label: 'Meus envios', count: 'mine', auth: true },
];

let shellMounted = false;

function shellMarkup(user, activeRoute, counts, tags) {
  const guest = !user;
  return `
    <div class="shell">
      <header class="topbar">
        <button class="btn btn--ghost btn--icon topbar__burger" type="button" id="burger"
                aria-label="Abrir menu">${icon('menu', 20)}</button>
        <a class="topbar__brand" href="#/biblioteca">${BRAND_MARK}<span>${esc(CONFIG.siteName)}</span></a>
        <div class="topbar__search">
          ${icon('search', 16)}
          <input class="input" type="search" id="search" placeholder="Buscar por nome, autor ou etiqueta…"
                 autocomplete="off" aria-label="Buscar modelos">
          <kbd>/</kbd>
        </div>
        <div class="topbar__actions">
          ${user ? `<a class="btn btn--primary btn--sm" href="#/enviar">${icon('upload', 15)}
            <span class="nowrap" style="display:none">Enviar</span></a>` : ''}
          <div class="menu-wrap" id="account">
            <button class="btn btn--ghost btn--icon" type="button" id="account-btn"
                    aria-haspopup="menu" aria-expanded="false" aria-label="Conta">
              ${user
                ? `<span class="avatar" style="--av:${esc(user.color)}">${esc(initials(user.username))}</span>`
                : icon('user', 20)}
            </button>
          </div>
        </div>
      </header>

      <div class="body">
        <aside class="sidebar" id="sidebar">
          <nav class="nav">
            ${NAV_ITEMS.filter((item) => !item.auth || user).map((item) => `
              <a class="nav__item${activeRoute === item.route ? ' is-active' : ''}" href="${item.href}">
                ${icon(item.icon, 17)}<span>${esc(item.label)}</span>
                <span class="count">${counts[item.count] ?? ''}</span>
              </a>`).join('')}
            ${user ? `
              <a class="nav__item${activeRoute === '/enviar' ? ' is-active' : ''}" href="#/enviar">
                ${icon('plus', 17)}<span>Enviar modelo</span></a>` : ''}

            <div class="nav__label">Produção</div>
            <a class="nav__item${activeRoute === '/estoque' ? ' is-active' : ''}" href="#/estoque">
              ${icon('package', 17)}<span>Estoque</span></a>
            <a class="nav__item${activeRoute === '/calculadora' ? ' is-active' : ''}" href="#/calculadora">
              ${icon('calculator', 17)}<span>Calculadora 3D</span></a>
            <a class="nav__item${activeRoute === '/orcamento' ? ' is-active' : ''}" href="#/orcamento">
              ${icon('fileText', 17)}<span>Orçamento</span></a>

            <div class="nav__label">Conta</div>
            ${user ? `
              <a class="nav__item${activeRoute === '/perfil' ? ' is-active' : ''}" href="#/perfil">
                ${icon('user', 17)}<span>Perfil</span></a>` : `
              <a class="nav__item" href="#/entrar">${icon('login', 17)}<span>Entrar</span></a>`}
            <a class="nav__item${activeRoute === '/config' ? ' is-active' : ''}" href="#/config">
              ${icon('settings', 17)}<span>Configurações</span></a>

            ${tags.length ? `
              <div class="nav__label">Etiquetas populares</div>
              <div class="tag-cloud">
                ${tags.map(([tag, n]) => `
                  <a class="chip" href="#/biblioteca?tag=${encodeURIComponent(tag)}">${esc(tag)}
                    <span class="faint">${n}</span></a>`).join('')}
              </div>` : ''}
          </nav>
          ${guest ? `
            <div class="banner banner--info" style="margin:24px 12px 0">
              ${icon('info', 16)}
              <div class="small">Você está como visitante.
                <a href="#/criar-conta">Crie uma conta</a> para enviar modelos e salvar favoritos.</div>
            </div>` : ''}
        </aside>
        <main class="main" id="view"></main>
      </div>
    </div>`;
}

function accountMenuMarkup(user) {
  if (!user) {
    return `
      <div class="menu" role="menu">
        <div class="menu__head"><strong>Visitante</strong><small>sem conta ativa</small></div>
        <a class="menu__item" href="#/entrar" role="menuitem">${icon('login', 16)} Entrar</a>
        <a class="menu__item" href="#/criar-conta" role="menuitem">${icon('user', 16)} Criar conta</a>
        <div class="menu__sep"></div>
        <a class="menu__item" href="#/config" role="menuitem">${icon('settings', 16)} Configurações</a>
      </div>`;
  }
  return `
    <div class="menu" role="menu">
      <div class="menu__head">
        <strong>${esc(user.username)}</strong>
        <small>${esc(user.email)}</small>
      </div>
      <a class="menu__item" href="#/perfil" role="menuitem">${icon('user', 16)} Perfil</a>
      <a class="menu__item" href="#/meus-envios" role="menuitem">${icon('upload', 16)} Meus envios</a>
      <a class="menu__item" href="#/favoritos" role="menuitem">${icon('star', 16)} Favoritos</a>
      <div class="menu__sep"></div>
      <button class="menu__item" type="button" role="menuitem" data-theme-toggle>
        ${icon('sun', 16)} Alternar tema
      </button>
      <a class="menu__item" href="#/config" role="menuitem">${icon('settings', 16)} Configurações</a>
      <div class="menu__sep"></div>
      <button class="menu__item menu__item--danger" type="button" role="menuitem" data-signout>
        ${icon('logout', 16)} Sair
      </button>
    </div>`;
}

function wireShell() {
  const app = qs('#app');

  /* Menu da conta */
  const wrap = qs('#account', app);
  const button = qs('#account-btn', app);
  const closeMenu = () => {
    qs('.menu', wrap)?.remove();
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (qs('.menu', wrap)) return closeMenu();
    wrap.insertAdjacentHTML('beforeend', accountMenuMarkup(auth.currentUser()));
    button.setAttribute('aria-expanded', 'true');
    qs('[data-signout]', wrap)?.addEventListener('click', () => {
      auth.signOut();
      auth.leaveGuest();
      closeMenu();
      toast('Sessão encerrada.', { type: 'info', timeout: 2400 });
      navigate('/entrar');
    });
    qs('[data-theme-toggle]', wrap)?.addEventListener('click', () => {
      const next = resolveTheme(getTheme()) === 'dark' ? 'light' : 'dark';
      setTheme(next);
      closeMenu();
    });
    qsa('.menu a', wrap).forEach((link) => link.addEventListener('click', closeMenu));
  });
  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target)) closeMenu();
  });

  /* Sidebar móvel */
  const sidebar = qs('#sidebar', app);
  const burger = qs('#burger', app);
  const closeSidebar = () => {
    sidebar.classList.remove('is-open');
    qs('.scrim', app)?.remove();
  };
  burger.addEventListener('click', () => {
    const opening = !sidebar.classList.contains('is-open');
    closeSidebar();
    if (opening) {
      sidebar.classList.add('is-open');
      const scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.addEventListener('click', closeSidebar);
      app.querySelector('.shell').appendChild(scrim);
    }
  });
  qsa('#sidebar a', app).forEach((link) => link.addEventListener('click', closeSidebar));

  /* Busca */
  const search = qs('#search', app);
  const emit = debounce((value) => {
    document.dispatchEvent(new CustomEvent('app:search', { detail: value }));
  }, 120);
  search.addEventListener('input', () => {
    if (!['/biblioteca', '/favoritos', '/meus-envios'].includes(parseHash().path)) {
      navigate(`/biblioteca?busca=${encodeURIComponent(search.value)}`);
      return;
    }
    emit(search.value);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { search.value = ''; emit(''); search.blur(); }
  });
  document.addEventListener('keydown', (event) => {
    const typing = /^(input|textarea|select)$/i.test(event.target?.tagName || '');
    if (event.key === '/' && !typing) {
      event.preventDefault();
      search.focus();
      search.select();
    }
  });
}

/* ---------- Render ---------- */

let disposeCurrentView = null;
let lastShellKey = '';

async function buildShell(activeRoute) {
  const user = auth.currentUser();
  const data = catalog.peek() || await catalog.load();
  const counts = {
    models: data.models.length || '',
    favorites: (user?.favorites || []).length || '',
    mine: user ? data.models.filter((m) => m.author === user.username).length || '' : '',
  };
  const tags = catalog.tagCounts(data.models).slice(0, 12);

  const key = JSON.stringify([user?.id, user?.color, activeRoute, counts, tags.length, auth.hasToken()]);
  if (shellMounted && key === lastShellKey) return;
  lastShellKey = key;

  const previousSearch = qs('#search')?.value || '';
  qs('#app').innerHTML = shellMarkup(user, activeRoute, counts, tags);
  shellMounted = true;
  wireShell();
  const search = qs('#search');
  if (search) search.value = previousSearch;
}

function makeContext({ route, params, query }) {
  return {
    route,
    params,
    query,
    store,
    navigate,
    getTheme,
    setTheme,
    setSearchInput: (value) => { const input = qs('#search'); if (input) input.value = value; },
    refreshShell: () => { lastShellKey = ''; buildShell(route); },
  };
}

async function render() {
  const { path, query } = parseHash();
  const match = matchRoute(path);

  if (!match) {
    qs('#app').innerHTML = `
      <div style="display:grid;place-items:center;min-height:100vh;padding:24px">
        <div class="empty" style="border:0">
          ${icon('alert', 40)}
          <h3>Página não encontrada</h3>
          <p class="mono">${esc(path)}</p>
          <a class="btn btn--primary" href="#/biblioteca">${icon('home', 17)} Ir para a biblioteca</a>
        </div>
      </div>`;
    shellMounted = false;
    lastShellKey = '';
    return;
  }

  const { route, params } = match;
  const isPublic = PUBLIC_ROUTES.has(route.pattern);
  const authenticated = !!auth.currentUser();
  const guest = auth.isGuest() && CONFIG.allowGuestBrowsing;

  // Guarda: rotas da aplicação exigem conta ou modo visitante explícito.
  if (!isPublic && !authenticated && !guest) {
    navigate('/entrar');
    return;
  }
  // Já autenticado não precisa ver a tela de login novamente.
  if (isPublic && authenticated) {
    navigate('/biblioteca');
    return;
  }

  disposeCurrentView?.();
  disposeCurrentView = null;

  const context = makeContext({ route: route.pattern, params, query });

  let container;
  if (route.shell === false) {
    shellMounted = false;
    lastShellKey = '';
    container = qs('#app');
    container.innerHTML = '';
  } else {
    await buildShell(route.pattern);
    container = qs('#view');
    container.innerHTML = '';
  }

  try {
    const module = await route.load();
    const dispose = await module.default(container, context);
    if (typeof dispose === 'function') disposeCurrentView = dispose;
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <div class="empty">${icon('alert', 40)}
        <h3>Falha ao abrir esta página</h3>
        <p>${esc(error?.message || error)}</p>
        <button class="btn" type="button" onclick="location.reload()">${icon('refresh', 17)} Recarregar</button>
      </div>`;
  }

  window.scrollTo({ top: 0 });
}

/* ---------- Inicialização ---------- */

window.addEventListener('hashchange', render);

async function boot() {
  if (!location.hash) {
    const landing = (auth.currentUser() || auth.isGuest()) ? 'biblioteca' : 'entrar';
    history.replaceState(null, '', `${location.pathname}${location.search}#/${landing}`);
  }
  // Pré-carrega o catálogo para que a casca já exiba as contagens.
  catalog.load().catch(() => {});
  await render();
  qs('#boot')?.remove();
  qs('#app').hidden = false;
}

boot().catch((error) => {
  console.error(error);
  const splash = qs('#boot');
  if (splash) {
    splash.innerHTML = `<p class="boot__text">Falha ao iniciar o aplicativo: ${esc(error?.message || error)}</p>`;
  }
});
