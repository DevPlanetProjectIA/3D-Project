/* Estoque: filamentos, insumos e produtos guardados neste navegador. */

import * as inventory from '../inventory.js';
import { MATERIALS, PALETTE, getMaterial, colorName } from '../filaments.js';
import { formatMoney } from '../costing.js';
import store from '../store.js';
import {
  esc, icon, qs, qsa, on, toast, confirmDialog, openModal, formatNumber, debounce,
} from '../util.js';

const TAB_KEY = 'estoque.aba';

const TABS = [
  { id: 'filamento', label: 'Filamentos', ico: 'printer' },
  { id: 'insumo', label: 'Insumos', ico: 'layers' },
  { id: 'produto', label: 'Produtos', ico: 'package' },
];

const LOW_GRAMS = 200;

const materialLabel = (id) => getMaterial(id)?.label || String(id || '—');
const grams = (value) => `${formatNumber(Math.round(value))} g`;

/** Círculo de amostra da cor do filamento. */
const swatch = (hex, size = 26) => `
  <span class="row__swatch" style="flex:none;width:${size}px;height:${size}px;border-radius:50%;
    border:1px solid var(--border);background:${esc(hex || '#ffffff')}"></span>`;

const marginOf = (item) => (item.price > 0 ? ((item.price - item.cost) / item.price) * 100 : null);

function matches(item, term) {
  if (!term) return true;
  const haystack = [
    item.name, item.brand, item.material, materialLabel(item.material),
    item.colorLabel, item.nickname, item.unit, item.notes,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(term);
}

export default async function inventoryView(container, ctx) {
  const stored = store.get(TAB_KEY, 'filamento');
  const state = {
    tab: TABS.some((t) => t.id === stored) ? stored : 'filamento',
    search: '',
  };

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Estoque</h1>
        <p>Filamentos, insumos e produtos. O filamento cadastrado é a base do custo de fabricação.</p>
      </div>
    </div>

    <div id="stats"></div>
    <div id="alert"></div>

    <div class="toolbar">
      <div class="segmented" id="tabs"></div>
      <span class="toolbar__spacer"></span>
      <div class="input-group">
        <input class="input" type="search" id="search" placeholder="Buscar nesta aba…"
               autocomplete="off" spellcheck="false">
      </div>
      <button class="btn btn--primary" type="button" id="add">${icon('plus', 16)} <span id="add-label"></span></button>
    </div>

    <div id="list"></div>`;

  const slots = {
    stats: qs('#stats', container),
    alert: qs('#alert', container),
    tabs: qs('#tabs', container),
    list: qs('#list', container),
    addLabel: qs('#add-label', container),
  };

  /* ---------- Render ---------- */

  function renderStats() {
    const filaments = inventory.filaments();
    slots.stats.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="stat__value">${formatNumber(filaments.length)}</div>
          <div class="stat__label">Filamentos cadastrados</div></div>
        <div class="stat"><div class="stat__value">${grams(inventory.totalGrams())}</div>
          <div class="stat__label">Gramas disponíveis</div></div>
        <div class="stat"><div class="stat__value">${esc(formatMoney(inventory.inventoryValue()))}</div>
          <div class="stat__label">Valor do estoque</div></div>
        <div class="stat"><div class="stat__value">${formatNumber(inventory.products().length)}</div>
          <div class="stat__label">Produtos cadastrados</div></div>
      </div>`;
  }

  function renderAlert() {
    if (inventory.filaments().length) { slots.alert.innerHTML = ''; return; }
    slots.alert.innerHTML = `
      <div class="banner banner--info">${icon('info', 18)}
        <div class="small">O custo de fabricação dos modelos <span class="mono">.3mf</span> sai do
          filamento cadastrado aqui: é dele que vêm o preço por grama e o saldo disponível.
          Sem nenhum filamento no estoque, o cálculo fica sem base de material.</div>
        <div class="banner__actions">
          <button class="btn btn--sm btn--primary" type="button" id="first-filament">
            ${icon('plus', 15)} Cadastrar filamento</button>
        </div>
      </div>`;
    qs('#first-filament', slots.alert).addEventListener('click', () => openForm('filamento'));
  }

  function renderTabs() {
    const counts = inventory.counts();
    slots.tabs.innerHTML = TABS.map((tab) => `
      <button type="button" data-tab="${tab.id}" class="${tab.id === state.tab ? 'is-active' : ''}">
        ${icon(tab.ico, 15)} ${esc(tab.label)} (${formatNumber(counts[tab.id] || 0)})
      </button>`).join('');
  }

  function filamentRow(item) {
    const left = inventory.available(item);
    const out = left <= 0;
    const low = !out && left <= LOW_GRAMS;
    return `
      <div class="row" data-id="${esc(item.id)}">
        ${swatch(item.hex)}
        <span class="row__main">
          <span class="row__title">${esc(item.colorLabel || colorName(item.hex))} ·
            ${esc(materialLabel(item.material))}
            ${item.nickname ? `<span class="faint small">— ${esc(item.nickname)}</span>` : ''}</span>
          <span class="row__sub">
            ${esc(item.brand || 'sem marca')} ·
            ${formatNumber(item.spools)} ${item.spools === 1 ? 'rolo' : 'rolos'} ·
            ${grams(item.spoolWeight)}/rolo ·
            ${esc(formatMoney(inventory.pricePerKg(item)))}/kg ·
            ${grams(left)} disponíveis
          </span>
        </span>
        ${out ? `<span class="chip chip--static" style="background:var(--danger-soft);border-color:transparent;color:var(--danger)">${icon('alert', 13)} Esgotado</span>` : ''}
        ${low ? `<span class="chip chip--static" style="background:var(--warning-soft);border-color:transparent;color:var(--warning)">${icon('alert', 13)} Acabando</span>` : ''}
        ${rowActions()}
      </div>`;
  }

  function supplyRow(item) {
    return `
      <div class="row" data-id="${esc(item.id)}">
        <span class="row__main">
          <span class="row__title">${esc(item.name || 'Sem nome')}</span>
          <span class="row__sub">
            ${formatNumber(item.qty)} ${esc(item.unit || 'un')} ·
            ${esc(formatMoney(item.unitPrice))} cada ·
            total ${esc(formatMoney(item.qty * item.unitPrice))}
            ${item.notes ? ` · ${esc(item.notes)}` : ''}
          </span>
        </span>
        ${rowActions()}
      </div>`;
  }

  function productRow(item) {
    const margin = marginOf(item);
    return `
      <div class="row" data-id="${esc(item.id)}">
        <span class="row__main">
          <span class="row__title">${esc(item.name || 'Sem nome')}</span>
          <span class="row__sub">
            ${formatNumber(item.qty)} ${esc(item.unit || 'un')} ·
            custo ${esc(formatMoney(item.cost))} ·
            preço ${esc(formatMoney(item.price))} ·
            margem ${margin === null ? '—' : `${margin.toFixed(0)}%`}
            ${item.weight ? ` · ${grams(item.weight)}` : ''}
            ${item.printHours ? ` · ${formatNumber(item.printHours)} h de impressão` : ''}
            ${item.notes ? ` · ${esc(item.notes)}` : ''}
          </span>
        </span>
        ${rowActions()}
      </div>`;
  }

  function rowActions() {
    return `
      <span class="inline">
        <button class="btn btn--ghost btn--icon" type="button" data-act="edit" title="Editar">${icon('edit', 16)}</button>
        <button class="btn btn--ghost btn--icon" type="button" data-act="remove" title="Excluir">${icon('trash', 16)}</button>
      </span>`;
  }

  function renderList() {
    const tab = TABS.find((t) => t.id === state.tab);
    slots.addLabel.textContent = `Cadastrar ${tab.id}`;
    const all = inventory.list(state.tab);
    const items = all.filter((item) => matches(item, state.search));

    if (!items.length) {
      slots.list.innerHTML = `
        <div class="empty">${icon(tab.ico, 40)}
          <h3>${all.length ? 'Nada encontrado' : `Nenhum ${esc(tab.id)} cadastrado`}</h3>
          <p>${all.length
            ? 'Nenhum item desta aba corresponde à busca.'
            : 'Cadastre o primeiro item para acompanhar saldo e custo.'}</p>
          ${all.length ? '' : `<button class="btn btn--primary" type="button" data-act="add">
            ${icon('plus', 16)} Cadastrar ${esc(tab.id)}</button>`}
        </div>`;
      return;
    }

    const row = { filamento: filamentRow, insumo: supplyRow, produto: productRow }[state.tab];
    slots.list.innerHTML = `<div class="grid grid--list">${items.map(row).join('')}</div>`;
  }

  function render() {
    renderStats();
    renderAlert();
    renderTabs();
    renderList();
  }

  /* ---------- Formulários ---------- */

  const field = (label, inner, hint) => `
    <div class="field">
      <label>${esc(label)}</label>
      ${inner}
      ${hint ? `<p class="field__hint">${hint}</p>` : ''}
    </div>`;

  const numberInput = (name, value, extra = '') =>
    `<input class="input" type="number" name="${name}" value="${esc(String(value ?? ''))}"
            step="any" min="0" inputmode="decimal" ${extra}>`;

  const textInput = (name, value, placeholder = '') =>
    `<input class="input" type="text" name="${name}" value="${esc(String(value ?? ''))}"
            placeholder="${esc(placeholder)}" autocomplete="off">`;

  const notesField = (value) => field('Observações',
    `<textarea class="textarea" name="notes" rows="2" placeholder="Opcional">${esc(value || '')}</textarea>`);

  function filamentBody(item) {
    const hex = item.hex || '#ffffff';
    return `
      ${field('Cor do filamento', `
        <div class="tag-cloud" id="palette" style="padding:0;gap:6px">
          ${PALETTE.map(([name, swatchHex]) => `
            <button type="button" class="chip" data-hex="${esc(swatchHex)}" data-name="${esc(name)}"
                    title="${esc(name)}" style="padding:4px 9px">
              ${swatch(swatchHex, 14)} ${esc(name)}
            </button>`).join('')}
        </div>
        <div class="inline" style="margin-top:8px;gap:8px">
          <input class="input" type="color" name="hex" value="${esc(hex)}" style="max-width:64px;padding:3px">
          ${textInput('colorLabel', item.colorLabel || colorName(hex), 'Nome da cor')}
        </div>`,
        'Escolha uma amostra da paleta ou use o seletor para uma cor livre.')}

      ${field('Tipo do filamento', `
        <select class="select" name="material">
          ${MATERIALS.map((m) => `<option value="${esc(m.id)}"
            ${m.id === (item.material || 'PLA') ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
        </select>`)}

      ${field('Marca (opcional)', textInput('brand', item.brand, 'Ex: 3D Fila, Voolt…'))}

      <div class="grid-2">
        ${field('Quantidade (rolos)', numberInput('spools', item.spools ?? 1))}
        ${field('Peso por rolo (g)', numberInput('spoolWeight', item.spoolWeight ?? 1000))}
      </div>

      <div class="grid-2">
        ${field('Valor pago por rolo (R$)', numberInput('spoolPrice', item.spoolPrice ?? 0))}
        ${field('Saldo restante (g) — opcional', numberInput('remaining', item.remaining ?? 0),
          'Use para um rolo parcialmente usado: informe quantas gramas ainda existem. Em branco ou zero, o saldo vem de rolos × peso por rolo.')}
      </div>

      <div class="banner banner--info">${icon('coins', 18)}
        <div class="small">Preço por quilo: <strong id="ppk">—</strong></div>
      </div>

      ${field('Nome/apelido (opcional)', textInput('nickname', item.nickname, 'Ex: PLA preto para miniaturas'))}
      ${notesField(item.notes)}`;
  }

  function supplyBody(item) {
    return `
      ${field('Nome do insumo', textInput('name', item.name, 'Ex: Parafuso M3'))}
      <div class="grid-2">
        ${field('Quantidade', numberInput('qty', item.qty ?? 1))}
        ${field('Unidade', textInput('unit', item.unit || 'un', 'un, m, kg…'))}
      </div>
      ${field('Preço unitário (R$)', numberInput('unitPrice', item.unitPrice ?? 0))}
      <div class="banner banner--info">${icon('calculator', 18)}
        <div class="small">Total: <strong id="total">—</strong></div>
      </div>
      ${notesField(item.notes)}`;
  }

  function productBody(item) {
    return `
      ${field('Nome do produto', textInput('name', item.name, 'Ex: Chaveiro personalizado'))}
      <div class="grid-2">
        ${field('Quantidade', numberInput('qty', item.qty ?? 1))}
        ${field('Unidade', textInput('unit', item.unit || 'un', 'un, par, kit…'))}
      </div>
      <div class="grid-2">
        ${field('Custo de produção (R$)', numberInput('cost', item.cost ?? 0))}
        ${field('Preço de venda (R$)', numberInput('price', item.price ?? 0))}
      </div>
      <div class="banner banner--info">${icon('trendingUp', 18)}
        <div class="small">Margem: <strong id="margin">—</strong></div>
      </div>
      <div class="grid-2">
        ${field('Peso (g)', numberInput('weight', item.weight ?? 0), 'Dados de impressão 3D (opcional).')}
        ${field('Impressão (h)', numberInput('printHours', item.printHours ?? 0))}
      </div>
      ${notesField(item.notes)}`;
  }

  const BODIES = { filamento: filamentBody, insumo: supplyBody, produto: productBody };
  const TITLES = { filamento: 'Filamento', insumo: 'Insumo', produto: 'Produto' };

  /**
   * Abre o modal de cadastro/edição. O box é consultado logo depois de
   * `openModal` porque a inserção no DOM acontece de forma sincrona.
   */
  async function openForm(type, id) {
    const item = id ? inventory.getItem(id) || {} : {};
    let close = () => {};

    const result = openModal((closeFn) => {
      close = closeFn;
      return `
        <form class="form" id="form-item" novalidate>
          <div class="modal__head"><h2>${id ? 'Editar' : 'Cadastrar'} ${esc(TITLES[type].toLowerCase())}</h2>
            <button class="btn btn--ghost btn--icon" type="button" data-close="">${icon('x', 18)}</button></div>
          <div class="modal__body">${BODIES[type](item)}</div>
          <div class="modal__foot">
            <button class="btn" type="button" data-close="">Cancelar</button>
            <button class="btn btn--primary" type="submit">${icon('check', 16)} Salvar</button>
          </div>
        </form>`;
    }, { wide: true });

    const overlays = qsa('#modal-root .modal');
    const box = overlays.length ? qs('.modal__box', overlays[overlays.length - 1]) : null;
    if (box) wireForm(box, type, item, close);

    if (await result === 'saved') render();
  }

  function wireForm(box, type, item, close) {
    const form = qs('#form-item', box);
    const value = (name) => qs(`[name="${name}"]`, form)?.value ?? '';
    const n = (name) => inventory.num(value(name));

    if (type === 'filamento') {
      const hexInput = qs('[name="hex"]', form);
      const labelInput = qs('[name="colorLabel"]', form);
      const ppk = qs('#ppk', box);

      const updatePpk = () => {
        const weight = n('spoolWeight');
        ppk.textContent = weight > 0
          ? `${formatMoney((n('spoolPrice') / weight) * 1000)} por kg`
          : 'informe o peso do rolo';
      };
      updatePpk();
      ['spoolPrice', 'spoolWeight'].forEach((name) => {
        qs(`[name="${name}"]`, form).addEventListener('input', updatePpk);
      });

      on(box, '[data-hex]', 'click', (event, button) => {
        hexInput.value = button.dataset.hex;
        labelInput.value = button.dataset.name;
        qsa('[data-hex]', box).forEach((b) => b.classList.toggle('is-active', b === button));
      });
      hexInput.addEventListener('input', () => {
        qsa('[data-hex]', box).forEach((b) => b.classList.remove('is-active'));
        labelInput.value = colorName(hexInput.value);
      });
    }

    if (type === 'insumo') {
      const slot = qs('#total', box);
      const update = () => { slot.textContent = formatMoney(n('qty') * n('unitPrice')); };
      update();
      qsa('[name="qty"], [name="unitPrice"]', form)
        .forEach((input) => input.addEventListener('input', update));
    }

    if (type === 'produto') {
      const slot = qs('#margin', box);
      const update = () => {
        const price = n('price');
        slot.textContent = price > 0 ? `${(((price - n('cost')) / price) * 100).toFixed(0)}%` : '—';
      };
      update();
      qsa('[name="cost"], [name="price"]', form)
        .forEach((input) => input.addEventListener('input', update));
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = { id: item.id, type, createdAt: item.createdAt, notes: value('notes') };

      if (type === 'filamento') {
        Object.assign(data, {
          hex: value('hex'),
          colorLabel: value('colorLabel').trim() || colorName(value('hex')),
          material: value('material'),
          brand: value('brand').trim(),
          spools: n('spools'),
          spoolWeight: n('spoolWeight') || 1000,
          spoolPrice: n('spoolPrice'),
          remaining: n('remaining'),
          nickname: value('nickname').trim(),
        });
      } else if (type === 'insumo') {
        if (!value('name').trim()) { toast('Informe o nome do insumo.', { type: 'warn' }); return; }
        Object.assign(data, {
          name: value('name').trim(), qty: n('qty'), unit: value('unit').trim() || 'un', unitPrice: n('unitPrice'),
        });
      } else {
        if (!value('name').trim()) { toast('Informe o nome do produto.', { type: 'warn' }); return; }
        Object.assign(data, {
          name: value('name').trim(), qty: n('qty'), unit: value('unit').trim() || 'un',
          cost: n('cost'), price: n('price'), weight: n('weight'), printHours: n('printHours'),
          modelId: item.modelId || '',
        });
      }

      inventory.save(data);
      toast(`${TITLES[type]} salvo.`, { type: 'success', timeout: 2200 });
      close('saved');
    });
  }

  /* ---------- Eventos ---------- */

  on(slots.tabs, '[data-tab]', 'click', (event, button) => {
    state.tab = button.dataset.tab;
    store.set(TAB_KEY, state.tab);
    renderTabs();
    renderList();
  });

  qs('#search', container).addEventListener('input', debounce((event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderList();
  }, 180));

  qs('#add', container).addEventListener('click', () => openForm(state.tab));
  on(slots.list, '[data-act="add"]', 'click', () => openForm(state.tab));

  on(slots.list, '[data-act="edit"]', 'click', (event, button) => {
    openForm(state.tab, button.closest('[data-id]').dataset.id);
  });

  on(slots.list, '[data-act="remove"]', 'click', async (event, button) => {
    const id = button.closest('[data-id]').dataset.id;
    const item = inventory.getItem(id);
    if (!item) return;
    const confirmed = await confirmDialog({
      title: `Excluir ${TITLES[item.type].toLowerCase()}`,
      message: `"${item.name || item.colorLabel || 'item'}" será removido do estoque deste navegador.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmed) return;
    inventory.remove(id);
    toast('Item removido.', { type: 'info', timeout: 2200 });
    render();
  });

  render();
}
