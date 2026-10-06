/* Biblioteca: grade de modelos com busca, filtros, ordenação e favoritos. */

import * as catalog from '../catalog.js';
import * as auth from '../auth.js';
import { esc, icon, qs, qsa, formatBytes, formatNumber, formatRelative, toast, on, debounce } from '../util.js';

const VIEW_KEY = 'libraryView';

const EMPTY_STATES = {
  all: {
    icon: 'box',
    title: 'A biblioteca ainda está vazia',
    text: 'Nenhum modelo foi publicado até agora. Envie o primeiro arquivo .stl ou .3mf para iniciar o acervo.',
    cta: { href: '#/enviar', label: 'Enviar modelo', icon: 'upload' },
  },
  favorites: {
    icon: 'star',
    title: 'Sem favoritos',
    text: 'Marque modelos com a estrela para encontrá-los rapidamente aqui.',
    cta: { href: '#/biblioteca', label: 'Explorar biblioteca', icon: 'library' },
  },
  mine: {
    icon: 'upload',
    title: 'Você ainda não enviou modelos',
    text: 'Publique um arquivo e ele aparecerá nesta lista.',
    cta: { href: '#/enviar', label: 'Enviar modelo', icon: 'upload' },
  },
  filtered: {
    icon: 'search',
    title: 'Nenhum resultado',
    text: 'Nenhum modelo corresponde aos filtros atuais. Ajuste a busca ou limpe os filtros.',
    cta: null,
  },
};

/* ---------- Cartões ---------- */

function thumbMarkup(model) {
  if (model.thumb) {
    return `<img src="${esc(catalog.fileUrl(model, 'thumb'))}" alt="" loading="lazy" decoding="async"
            onerror="this.remove()">`;
  }
  return `<span class="placeholder">${icon('box', 44)}</span>`;
}

function cardMarkup(model, favorite) {
  return `
    <a class="card" href="#/modelo/${encodeURIComponent(model.id)}">
      <div class="card__media">
        ${thumbMarkup(model)}
        <span class="card__badge">${esc(model.format)}</span>
        <button class="card__fav${favorite ? ' is-on' : ''}" type="button"
                data-fav="${esc(model.id)}"
                aria-label="${favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">
          ${icon('star', 15)}
        </button>
      </div>
      <div class="card__body">
        <h3 class="card__title" title="${esc(model.name)}">${esc(model.name)}</h3>
        <div class="card__meta">
          <span>${icon('triangle', 13)}${formatNumber(model.triangles)}</span>
          <span>${icon('file', 13)}${formatBytes(model.size)}</span>
          <span>${icon('clock', 13)}${esc(formatRelative(model.createdAt))}</span>
        </div>
        ${model.tags.length ? `<div class="card__tags">${
          model.tags.slice(0, 3).map((t) => `<span class="chip chip--static">${esc(t)}</span>`).join('')
        }${model.tags.length > 3 ? `<span class="chip chip--static">+${model.tags.length - 3}</span>` : ''}</div>` : ''}
      </div>
    </a>`;
}

function rowMarkup(model, favorite) {
  return `
    <a class="row" href="#/modelo/${encodeURIComponent(model.id)}">
      <span class="row__thumb">${thumbMarkup(model)}</span>
      <span class="row__main">
        <span class="row__title">${esc(model.name)}</span>
        <span class="row__sub">${esc(model.author)} · ${esc(model.format.toUpperCase())} ·
          ${formatNumber(model.triangles)} triângulos · ${formatBytes(model.size)}</span>
      </span>
      <span class="faint small nowrap">${esc(formatRelative(model.createdAt))}</span>
      <button class="card__fav${favorite ? ' is-on' : ''}" type="button" style="opacity:1;position:static"
              data-fav="${esc(model.id)}" aria-label="Favorito">${icon('star', 15)}</button>
    </a>`;
}

function emptyMarkup(kind) {
  const state = EMPTY_STATES[kind] || EMPTY_STATES.filtered;
  return `
    <div class="empty">
      ${icon(state.icon, 40)}
      <h3>${esc(state.title)}</h3>
      <p>${esc(state.text)}</p>
      ${state.cta ? `<a class="btn btn--primary" href="${esc(state.cta.href)}">
        ${icon(state.cta.icon, 17)} ${esc(state.cta.label)}</a>` : ''}
    </div>`;
}

/* ---------- View ---------- */

export default async function libraryView(container, ctx) {
  const user = auth.currentUser();
  const scope = ctx.route === '/favoritos' ? 'favorites' : ctx.route === '/meus-envios' ? 'mine' : 'all';

  const state = {
    search: ctx.query.get('busca') || '',
    tags: ctx.query.getAll('tag').filter(Boolean),
    format: ctx.query.get('formato') || '',
    sort: ctx.query.get('ordem') || 'recent',
    view: ctx.store.get(VIEW_KEY, 'grid') === 'list' ? 'list' : 'grid',
  };

  const titles = {
    all: ['Biblioteca', 'Todos os modelos publicados no repositório.'],
    favorites: ['Favoritos', 'Modelos que você marcou com estrela.'],
    mine: ['Meus envios', 'Modelos publicados com a sua conta.'],
  };
  const [title, subtitle] = titles[scope];

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>${esc(title)}</h1>
        <p>${esc(subtitle)}</p>
      </div>
      <div class="btn-row">
        <button class="btn" type="button" id="reload">${icon('refresh', 17)} Atualizar</button>
        ${user ? `<a class="btn btn--primary" href="#/enviar">${icon('upload', 17)} Enviar modelo</a>` : ''}
      </div>
    </div>

    <div class="toolbar">
      <div class="segmented" id="format">
        ${[['', 'Todos'], ['stl', 'STL'], ['3mf', '3MF']].map(([value, label]) =>
          `<button type="button" data-format="${value}"
            class="${state.format === value ? 'is-active' : ''}">${label}</button>`).join('')}
      </div>
      <select class="select" id="sort" style="width:auto" aria-label="Ordenação">
        ${Object.entries(catalog.SORTS).map(([key, { label }]) =>
          `<option value="${key}"${state.sort === key ? ' selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
      <div class="toolbar__spacer"></div>
      <span class="small faint" id="result-count"></span>
      <div class="segmented" id="view">
        <button type="button" data-view="grid" class="${state.view === 'grid' ? 'is-active' : ''}"
                aria-label="Grade">${icon('grid', 15)}</button>
        <button type="button" data-view="list" class="${state.view === 'list' ? 'is-active' : ''}"
                aria-label="Lista">${icon('list', 15)}</button>
      </div>
    </div>

    <div id="active-filters" class="toolbar" hidden></div>
    <div id="results" aria-live="polite"></div>`;

  const results = qs('#results', container);
  const countSlot = qs('#result-count', container);
  const filtersSlot = qs('#active-filters', container);

  results.innerHTML = `<div class="grid">${
    Array.from({ length: 8 }, () => `
      <div class="skeleton"><div class="skeleton__media"></div>
      <div class="skeleton__line"></div><div class="skeleton__line"></div></div>`).join('')
  }</div>`;

  let models = [];
  try {
    models = (await catalog.load()).models;
  } catch (error) {
    results.innerHTML = `
      <div class="banner banner--danger">${icon('alert', 18)}
        <div><strong>Não foi possível carregar o catálogo.</strong>
        <div class="small">${esc(error.message || error)}</div></div>
      </div>`;
    return;
  }

  function currentFiltered() {
    const fresh = auth.currentUser();
    const options = {
      search: state.search,
      tags: state.tags,
      format: state.format,
      sort: state.sort,
    };
    if (scope === 'favorites') options.ids = fresh?.favorites || [];
    if (scope === 'mine') options.author = fresh?.username || '\u0000';
    return catalog.query(models, options);
  }

  function renderFilters() {
    const pieces = [];
    if (state.search) pieces.push(`<button class="chip is-active" data-clear="search">${icon('search', 13)} ${esc(state.search)} ${icon('x', 12)}</button>`);
    state.tags.forEach((tag) => {
      pieces.push(`<button class="chip is-active" data-clear-tag="${esc(tag)}">${icon('tag', 13)} ${esc(tag)} ${icon('x', 12)}</button>`);
    });
    if (state.format) pieces.push(`<button class="chip is-active" data-clear="format">${esc(state.format.toUpperCase())} ${icon('x', 12)}</button>`);
    filtersSlot.hidden = pieces.length === 0;
    filtersSlot.innerHTML = pieces.length
      ? `${pieces.join('')}<button class="chip" data-clear="all">Limpar tudo</button>`
      : '';
  }

  function render() {
    const list = currentFiltered();
    const favorites = new Set(auth.currentUser()?.favorites || []);

    countSlot.textContent = list.length
      ? `${formatNumber(list.length)} de ${formatNumber(models.length)} modelo${models.length === 1 ? '' : 's'}`
      : '';

    if (!list.length) {
      const hasFilters = state.search || state.tags.length || state.format;
      const kind = hasFilters ? 'filtered' : scope;
      results.innerHTML = emptyMarkup(models.length && hasFilters ? 'filtered' : kind);
    } else if (state.view === 'list') {
      results.innerHTML = `<div class="grid grid--list">${
        list.map((m) => rowMarkup(m, favorites.has(m.id))).join('')}</div>`;
    } else {
      results.innerHTML = `<div class="grid">${
        list.map((m) => cardMarkup(m, favorites.has(m.id))).join('')}</div>`;
    }

    renderFilters();
    syncHash();
  }

  function syncHash() {
    const params = new URLSearchParams();
    if (state.search) params.set('busca', state.search);
    state.tags.forEach((t) => params.append('tag', t));
    if (state.format) params.set('formato', state.format);
    if (state.sort !== 'recent') params.set('ordem', state.sort);
    const next = `#${ctx.route}${params.toString() ? `?${params}` : ''}`;
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  /* Eventos */

  on(container, '[data-format]', 'click', (_ev, button) => {
    state.format = button.dataset.format;
    qsa('#format button', container).forEach((b) => b.classList.toggle('is-active', b === button));
    render();
  });

  qs('#sort', container).addEventListener('change', (ev) => {
    state.sort = ev.target.value;
    render();
  });

  on(container, '[data-view]', 'click', (_ev, button) => {
    state.view = button.dataset.view;
    ctx.store.set(VIEW_KEY, state.view);
    qsa('#view button', container).forEach((b) => b.classList.toggle('is-active', b === button));
    render();
  });

  qs('#reload', container).addEventListener('click', async (ev) => {
    const button = ev.currentTarget;
    button.classList.add('is-loading');
    try {
      models = (await catalog.load({ force: true })).models;
      render();
      toast('Catálogo recarregado.', { type: 'success', timeout: 2200 });
    } catch (error) {
      toast(error.message || 'Falha ao recarregar.', { type: 'error' });
    } finally {
      button.classList.remove('is-loading');
    }
  });

  on(container, '[data-clear]', 'click', (_ev, button) => {
    const which = button.dataset.clear;
    if (which === 'search') { state.search = ''; ctx.setSearchInput(''); }
    if (which === 'format') { state.format = ''; qsa('#format button', container).forEach((b) => b.classList.toggle('is-active', !b.dataset.format)); }
    if (which === 'all') {
      state.search = ''; state.tags = []; state.format = '';
      ctx.setSearchInput('');
      qsa('#format button', container).forEach((b) => b.classList.toggle('is-active', !b.dataset.format));
    }
    render();
  });

  on(container, '[data-clear-tag]', 'click', (_ev, button) => {
    state.tags = state.tags.filter((t) => t !== button.dataset.clearTag);
    render();
  });

  on(container, '[data-fav]', 'click', (ev, button) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!auth.currentUser()) {
      toast('Entre com uma conta para salvar favoritos.', { type: 'warn' });
      return;
    }
    const updated = auth.toggleFavorite(button.dataset.fav);
    const isOn = (updated?.favorites || []).includes(button.dataset.fav);
    button.classList.toggle('is-on', isOn);
    ctx.refreshShell();
    if (scope === 'favorites') render();
  });

  const onSearch = debounce((value) => {
    state.search = value;
    render();
  }, 180);
  const searchHandler = (event) => onSearch(event.detail);
  document.addEventListener('app:search', searchHandler);

  ctx.setSearchInput(state.search);
  render();

  return () => document.removeEventListener('app:search', searchHandler);
}
