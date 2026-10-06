/* Calculadora 3D: preço rápido (simples) e precificação completa (avançada). */

import * as inventory from '../inventory.js';
import {
  compute, breakdown, quickPrices, CHANNELS, getChannel, getSettings, formatMoney, formatHours,
} from '../costing.js';
import store from '../store.js';
import { esc, icon, qs, qsa, toast, openModal } from '../util.js';

const TAB_KEY = 'calcTab';
const ADV_KEY = 'calcAdvanced';
const SIMPLE_KEY = 'calcSimple';

/*
 * O projeto não tem classes para layout de duas colunas com coluna fixa nem
 * para o anel do gráfico, então a view carrega o próprio bloco de estilo em vez
 * de alterar o CSS global.
 */
const STYLE = `
  <style>
    .calc-grid { display: grid; gap: var(--space-5); align-items: start; }
    @media (min-width: 980px) {
      .calc-grid { grid-template-columns: minmax(0, 1fr) 340px; }
      .calc-side { position: sticky; top: var(--space-4); }
    }
    .calc-line { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); font-size: 13px; color: var(--text-muted); }
    .calc-line > span:last-child { color: var(--text); font-variant-numeric: tabular-nums; }
    .calc-line--total { padding-top: var(--space-3); border-top: 1px solid var(--border); font-weight: 700; color: var(--text); }
    .calc-price { text-align: center; padding: var(--space-5) var(--space-4); }
    .calc-price__value { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
    .calc-sug { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); cursor: pointer; }
    .calc-sug:hover { text-decoration: underline; }
    .calc-donut {
      width: 160px; height: 160px; margin: 0 auto; border-radius: 50%;
      -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 26px), #000 calc(100% - 26px));
      mask: radial-gradient(farthest-side, transparent calc(100% - 26px), #000 calc(100% - 26px));
    }
    .calc-donut--empty { background: var(--border); }
    .calc-legend { display: grid; gap: 6px; }
    .calc-legend__item { display: flex; align-items: center; gap: var(--space-2); font-size: 12px; color: var(--text-muted); }
    .calc-legend__dot { flex: none; width: 9px; height: 9px; border-radius: 3px; }
    .calc-legend__item b { margin-left: auto; color: var(--text); font-variant-numeric: tabular-nums; }
    .calc-time { display: flex; align-items: center; gap: var(--space-2); }
    .calc-supply { display: flex; gap: var(--space-2); align-items: center; }
    .calc-supply .input:last-of-type { max-width: 110px; }
  </style>`;

/** Sugestões clicáveis abaixo dos campos, como na calculadora original. */
const sugs = (label, options) => `
  <p class="field__hint">${esc(label)}: ${options
    .map(([text, set]) => `<button type="button" class="calc-sug" data-set="${esc(set)}">${esc(text)}</button>`)
    .join(' | ')}</p>`;

const field = (key, label, { suffix = '', placeholder = '', hint = '' } = {}) => `
  <div class="field">
    <label for="f-${key}">${esc(label)}${suffix ? ` <span class="faint">(${esc(suffix)})</span>` : ''}</label>
    <input class="input" id="f-${key}" data-k="${key}" inputmode="decimal"
           placeholder="${esc(placeholder)}" value="">
    ${hint}
  </div>`;

const toggle = (key, label) => `
  <label class="check"><input type="checkbox" data-k="${key}"><span>${esc(label)}</span></label>`;

function advDefaults() {
  const s = getSettings();
  const channel = getChannel(s.channel);
  return {
    name: '',
    filamentId: '',
    pricePerKg: '',
    grams: '',
    hours: '',
    minutes: '',
    kwhPrice: String(s.kwhPrice),
    watts: String(s.watts),
    depOn: !!s.machineDepreciation,
    printerValue: String(s.printerValue),
    printerLife: String(s.printerLife),
    failOn: !!s.failureEnabled,
    failureRate: String(s.failureRate),
    supplies: [],
    postMinutes: String(s.postMinutes),
    laborRate: String(s.laborRate),
    markup: String(s.markup),
    paintOn: false,
    artHours: '',
    artMinutes: '',
    artRate: String(s.artRate),
    channel: channel.id,
    commission: String(channel.commission),
    fixedFee: String(channel.fixedFee),
  };
}

function loadAdv() {
  const saved = store.get(ADV_KEY, {}) || {};
  const state = { ...advDefaults(), ...saved };
  state.supplies = Array.isArray(state.supplies)
    ? state.supplies.map((s) => ({ name: String(s?.name || ''), value: String(s?.value ?? '') }))
    : [];
  return state;
}

export default async function calculatorView(container, ctx) {
  let tab = store.get(TAB_KEY, 'simples') === 'avancada' ? 'avancada' : 'simples';
  let release = null;

  container.innerHTML = `
    ${STYLE}
    <div class="page-head">
      <div class="page-head__text">
        <h1>Calculadora 3D</h1>
        <p>Do preço rápido pelo filamento ao custo completo com energia, máquina, mão de obra e taxas.</p>
      </div>
    </div>
    <div class="toolbar">
      <div class="segmented" id="calc-tabs">
        <button type="button" data-tab="simples" class="${tab === 'simples' ? 'is-active' : ''}">
          ${icon('calculator', 15)} Simples</button>
        <button type="button" data-tab="avancada" class="${tab === 'avancada' ? 'is-active' : ''}">
          ${icon('sliders', 15)} Avançada</button>
      </div>
    </div>
    <div id="calc-pane"></div>`;

  const pane = qs('#calc-pane', container);

  const draw = () => {
    release?.();
    release = tab === 'simples' ? renderSimple(pane) : renderAdvanced(pane, ctx);
  };

  qs('#calc-tabs', container).addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button || button.dataset.tab === tab) return;
    tab = button.dataset.tab;
    store.set(TAB_KEY, tab);
    qsa('#calc-tabs button', container).forEach((b) => b.classList.toggle('is-active', b === button));
    draw();
  });

  draw();
  return () => release?.();
}

/* ---------- Aba simples ---------- */

function renderSimple(pane) {
  const saved = store.get(SIMPLE_KEY, {}) || {};
  const state = {
    pricePerKg: String(saved.pricePerKg ?? ''),
    grams: String(saved.grams ?? ''),
    painted: !!saved.painted,
  };
  const ac = new AbortController();
  const bind = { signal: ac.signal };

  pane.innerHTML = `
    <div class="settings stack">
      <div class="panel">
        <div class="panel__head">${icon('calculator', 14)} 1) Insumos</div>
        <div class="panel__body">
          <div class="form">
            <div class="grid-2">
              ${field('pricePerKg', 'Preço do filamento', { suffix: 'R$/kg', placeholder: 'Ex.: 99,90', hint: sugs('Médias', [['PLA R$110', 'pricePerKg:110'], ['ABS R$80', 'pricePerKg:80'], ['Flex R$180', 'pricePerKg:180']]) })}
              ${field('grams', 'Peso da peça', { suffix: 'g', placeholder: 'Ex.: 125', hint: sugs('Exemplos', [['30 g', 'grams:30'], ['100 g', 'grams:100'], ['250 g', 'grams:250']]) })}
            </div>
            <p class="field__hint">Informe quanto você pagou no quilo do filamento. O resultado atualiza a cada digitação.</p>
            <div class="btn-row">
              <button class="btn" type="button" id="simple-clear">${icon('trash', 16)} Limpar</button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('coins', 14)} 2) Valores básicos</div>
        <div class="panel__body">
          <div class="stats">
            <div class="stat"><div class="stat__value" data-out="base">—</div>
              <div class="stat__label">Custo de produção <span class="chip chip--static">base</span></div></div>
            <div class="stat"><div class="stat__value" data-out="retail">—</div>
              <div class="stat__label">Varejo <span class="chip chip--static">×3</span></div></div>
            <div class="stat"><div class="stat__value" data-out="consumer">—</div>
              <div class="stat__label">Consumidor <span class="chip chip--static">×5</span></div></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('palette', 14)} 3) Peça personalizada</div>
        <div class="panel__body">
          <div class="stats">
            <div class="stat"><div class="stat__value" data-out="custom">—</div>
              <div class="stat__label">Preço mínimo <span class="chip chip--static" data-out="mult">×10</span></div></div>
          </div>
          <label class="check"><input type="checkbox" id="simple-paint" ${state.painted ? 'checked' : ''}>
            <span>Pintada à mão? Multiplica por 20 em vez de 10.</span></label>
          <p class="field__hint">Use como piso. Aumente conforme tempo de trabalho e exclusividade da peça.</p>
        </div>
      </div>

      <p class="small faint">* Fórmula: custo = (preço por kg ÷ 1000) × gramas.</p>
      <p class="small faint">* Varejo (×3), consumidor (×5), personalizada (×10, ou ×20 pintada à mão).</p>
    </div>`;

  const inputs = {
    pricePerKg: qs('[data-k="pricePerKg"]', pane),
    grams: qs('[data-k="grams"]', pane),
  };
  inputs.pricePerKg.value = state.pricePerKg;
  inputs.grams.value = state.grams;

  const out = (key) => qs(`[data-out="${key}"]`, pane);

  const update = () => {
    store.set(SIMPLE_KEY, state);
    const prices = quickPrices(state.pricePerKg, state.grams, state.painted);
    out('base').textContent = formatMoney(prices.base);
    out('retail').textContent = formatMoney(prices.retail);
    out('consumer').textContent = formatMoney(prices.consumer);
    out('custom').textContent = formatMoney(prices.custom);
    out('mult').textContent = state.painted ? '×20' : '×10';
  };

  pane.addEventListener('input', (event) => {
    const key = event.target.dataset?.k;
    if (!key) return;
    state[key] = event.target.value;
    update();
  }, bind);

  pane.addEventListener('click', (event) => {
    const sug = event.target.closest('.calc-sug');
    if (!sug) return;
    const [key, value] = sug.dataset.set.split(':');
    state[key] = value;
    inputs[key].value = value;
    update();
  }, bind);

  qs('#simple-paint', pane).addEventListener('change', (event) => {
    state.painted = event.target.checked;
    update();
  }, bind);

  qs('#simple-clear', pane).addEventListener('click', () => {
    state.pricePerKg = '';
    state.grams = '';
    state.painted = false;
    inputs.pricePerKg.value = '';
    inputs.grams.value = '';
    qs('#simple-paint', pane).checked = false;
    update();
  }, bind);

  update();
  return () => ac.abort();
}

/* ---------- Aba avançada ---------- */

function renderAdvanced(pane, ctx) {
  const state = loadAdv();
  const ac = new AbortController();
  const bind = { signal: ac.signal };
  const filaments = inventory.filaments();

  const filamentOptions = filaments.map((f) => {
    const parts = [f.colorLabel, f.material, f.brand].filter(Boolean).join(' · ');
    return `<option value="${esc(f.id)}">${esc(parts)} — ${esc(formatMoney(inventory.pricePerKg(f)))}/kg</option>`;
  }).join('');

  pane.innerHTML = `
    <div class="calc-grid">
      <div class="stack">
        <div class="panel">
          <div class="panel__head">${icon('tag', 14)} Nome do produto</div>
          <div class="panel__body">
            <div class="field">
              <label for="f-name">Identificação (usada ao salvar no estoque ou gerar orçamento)</label>
              <input class="input" id="f-name" data-k="name" placeholder="Ex.: chaveiro personalizado, vaso decorativo…">
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('zap', 14)} 1. Material e impressão</div>
          <div class="panel__body">
            ${filaments.length ? `
              <div class="field">
                <label for="f-filament">Filamento do estoque</label>
                <select class="select" id="f-filament">
                  <option value="">Informar o preço manualmente</option>
                  ${filamentOptions}
                </select>
                <p class="field__hint">Ao escolher, o preço por quilo é preenchido com o valor do estoque.</p>
              </div>` : `
              <div class="banner banner--info">${icon('package', 18)}
                <div class="small">Nenhum filamento cadastrado. Cadastre seus rolos para puxar o preço por quilo
                  automaticamente. <a href="#/estoque">Abrir o estoque</a></div>
              </div>`}
            <div class="form">
              <div class="grid-2">
                ${field('pricePerKg', 'Preço do filamento', { suffix: 'R$/kg', placeholder: '65', hint: sugs('Médias', [['PLA R$110', 'pricePerKg:110'], ['ABS R$80', 'pricePerKg:80'], ['Flex R$180', 'pricePerKg:180']]) })}
                ${field('grams', 'Peso da peça', { suffix: 'g', placeholder: '50', hint: sugs('Exemplos', [['30 g', 'grams:30'], ['100 g', 'grams:100']]) })}
                <div class="field">
                  <label for="f-hours">Tempo de impressão</label>
                  <div class="calc-time">
                    <input class="input" id="f-hours" data-k="hours" inputmode="decimal" placeholder="5">
                    <span class="faint small">h</span>
                    <input class="input" id="f-minutes" data-k="minutes" inputmode="decimal" placeholder="30">
                    <span class="faint small">min</span>
                  </div>
                  ${sugs('Exemplos', [['1h30', 'hours:1|minutes:30'], ['3h45', 'hours:3|minutes:45'], ['8h', 'hours:8|minutes:0']])}
                </div>
                ${field('kwhPrice', 'Custo da energia', { suffix: 'R$/kWh', placeholder: '0,92', hint: sugs('Média', [['R$ 0,92', 'kwhPrice:0.92'], ['R$ 1,10', 'kwhPrice:1.10']]) })}
                ${field('watts', 'Potência da máquina', { suffix: 'W', placeholder: '150', hint: sugs('Média', [['150 W', 'watts:150'], ['300 W', 'watts:300']]) })}
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('cog', 14)} 2. Custos da máquina</div>
          <div class="panel__body">
            ${toggle('depOn', 'Incluir depreciação da impressora')}
            <div class="banner banner--warn" id="dep-warn" hidden>${icon('alert', 18)}
              <div class="small">Atenção: incluir a depreciação do equipamento aumenta consideravelmente o
                valor da peça.</div>
            </div>
            <div class="form">
              <div class="grid-2">
                ${field('printerValue', 'Valor da impressora', { suffix: 'R$', placeholder: '2500', hint: sugs('Média', [['R$ 3.500', 'printerValue:3500']]) })}
                ${field('printerLife', 'Vida útil', { suffix: 'horas', placeholder: '3000', hint: sugs('Padrão', [['3000 h', 'printerLife:3000']]) })}
              </div>
            </div>
            <div class="calc-line--total" style="font-weight:400">
              ${toggle('failOn', 'Incluir risco de falha de impressão')}
            </div>
            <div class="form">
              ${field('failureRate', 'Taxa de falha (risco)', { suffix: '%', placeholder: '10', hint: sugs('Média', [['10%', 'failureRate:10'], ['15%', 'failureRate:15']]) })}
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('cart', 14)} 3. Consumíveis</div>
          <div class="panel__body">
            <div class="inline">
              <span class="small muted">Cola, lixa, verniz, embalagem, ímãs…</span>
              <span class="toolbar__spacer"></span>
              <button class="btn btn--sm" type="button" id="supply-add">${icon('plus', 15)} Adicionar</button>
            </div>
            <div class="stack stack--sm" id="supply-list"></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('clock', 14)} 4. Mão de obra</div>
          <div class="panel__body">
            <div class="form">
              <div class="grid-2">
                ${field('postMinutes', 'Pós-processamento', { suffix: 'min', placeholder: '20', hint: sugs('Sugestão', [['15 min', 'postMinutes:15'], ['30 min', 'postMinutes:30']]) })}
                ${field('laborRate', 'Seu valor hora', { suffix: 'R$/h', placeholder: '30', hint: sugs('Sugestão', [['R$ 20', 'laborRate:20'], ['R$ 30', 'laborRate:30']]) })}
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('trendingUp', 14)} 5. Markup</div>
          <div class="panel__body">
            <p class="small faint">O markup incide apenas sobre o custo de produção. Mão de obra e pintura
              entram depois, sem multiplicar.</p>
            <div class="form">
              ${field('markup', 'Lucro desejado', { suffix: '%', placeholder: '100', hint: sugs('Sugestão', [['50%', 'markup:50'], ['100%', 'markup:100'], ['150%', 'markup:150']]) })}
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('palette', 14)} 6. Pintura e personalização</div>
          <div class="panel__body">
            ${toggle('paintOn', 'Incluir pintura ou personalização')}
            <p class="small faint">O valor da arte é somado ao preço depois do markup: ele não é multiplicado
              pela margem.</p>
            <div class="form">
              <div class="grid-2">
                <div class="field">
                  <label for="f-artHours">Tempo de pintura</label>
                  <div class="calc-time">
                    <input class="input" id="f-artHours" data-k="artHours" inputmode="decimal" placeholder="2">
                    <span class="faint small">h</span>
                    <input class="input" id="f-artMinutes" data-k="artMinutes" inputmode="decimal" placeholder="30">
                    <span class="faint small">min</span>
                  </div>
                  ${sugs('Sugestão', [['1h30', 'artHours:1|artMinutes:30'], ['2h', 'artHours:2|artMinutes:0'], ['4h', 'artHours:4|artMinutes:0']])}
                </div>
                ${field('artRate', 'Valor hora artística', { suffix: 'R$/h', placeholder: '35', hint: sugs('Sugestão', [['R$ 20', 'artRate:20'], ['R$ 35', 'artRate:35']]) })}
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('money', 14)} 7. Canal de venda</div>
          <div class="panel__body">
            <div class="field">
              <label for="f-channel">Canal</label>
              <select class="select" id="f-channel">
                ${CHANNELS.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}
              </select>
              <p class="field__hint">As taxas abaixo são preenchidas pelo canal e continuam editáveis —
                use <em>Personalizado</em> para valores próprios.</p>
            </div>
            <div class="form">
              <div class="grid-2">
                ${field('commission', 'Comissão', { suffix: '%', placeholder: '0' })}
                ${field('fixedFee', 'Taxa fixa', { suffix: 'R$', placeholder: '0,00' })}
              </div>
            </div>
            <div class="banner banner--warn">${icon('info', 18)}
              <div class="small">O preço bruto é calculado para que, após o desconto do canal, sobre
                exatamente o valor líquido desejado. As taxas predefinidas são referência: os marketplaces
                mudam esses percentuais com frequência.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="calc-side stack">
        <div class="panel">
          <div class="panel__body calc-price">
            <div class="small muted">Preço final de venda</div>
            <div class="calc-price__value" data-out="price">—</div>
            <div class="small" data-out="profitLine"></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('fileText', 14)} Detalhamento</div>
          <div class="panel__body">
            <div class="calc-line"><span>Material</span><span data-out="materialBase">—</span></div>
            <div class="calc-line"><span>Purga / troca de cor</span><span data-out="purge">—</span></div>
            <div class="calc-line"><span>Energia</span><span data-out="energy">—</span></div>
            <div class="calc-line"><span>Máquina</span><span data-out="machine">—</span></div>
            <div class="calc-line"><span>Consumíveis / risco</span><span data-out="suppliesAndRisk">—</span></div>
            <div class="calc-line calc-line--total"><span>Custo de produção</span><span data-out="production">—</span></div>
            <div class="calc-line"><span>Lucro do markup</span><span data-out="markupProfit">—</span></div>
            <div class="calc-line"><span>Mão de obra</span><span data-out="labor">—</span></div>
            <div class="calc-line"><span>Arte / pintura</span><span data-out="art">—</span></div>
            <div class="calc-line"><span>Taxa do canal</span><span data-out="channelFee">—</span></div>
            <div class="calc-line calc-line--total"><span>Lucro líquido</span><span data-out="profit">—</span></div>
            <div class="calc-line"><span>Margem</span><span data-out="margin">—</span></div>
            <div class="calc-line"><span>Tempo de impressão</span><span data-out="hours">—</span></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__head">${icon('scale', 14)} Distribuição do preço</div>
          <div class="panel__body">
            <div class="calc-donut calc-donut--empty" data-out="donut"></div>
            <div class="calc-legend" data-out="legend"></div>
          </div>
        </div>

        <div class="btn-row">
          <button class="btn btn--primary btn--block" type="button" id="act-save">
            ${icon('save', 16)} Salvar como produto no estoque</button>
          <button class="btn btn--block" type="button" id="act-quote">
            ${icon('fileText', 16)} Gerar orçamento</button>
        </div>
      </div>
    </div>`;

  /* Preenche os campos com o estado persistido. */
  qsa('[data-k]', pane).forEach((el) => {
    const key = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!state[key];
    else el.value = state[key] ?? '';
  });
  const channelSelect = qs('#f-channel', pane);
  channelSelect.value = state.channel;
  const filamentSelect = qs('#f-filament', pane);
  if (filamentSelect) filamentSelect.value = state.filamentId;

  const out = (key) => qs(`[data-out="${key}"]`, pane);
  const supplyList = qs('#supply-list', pane);
  let result = compute({});

  const renderSupplies = () => {
    supplyList.innerHTML = state.supplies.length ? `
      ${state.supplies.map((item, index) => `
        <div class="calc-supply" data-index="${index}">
          <input class="input" data-s="name" placeholder="Nome do consumível" value="${esc(item.name)}">
          <input class="input" data-s="value" inputmode="decimal" placeholder="0,00" value="${esc(item.value)}">
          <button class="btn btn--ghost btn--icon" type="button" data-remove="${index}"
                  aria-label="Remover consumível">${icon('trash', 16)}</button>
        </div>`).join('')}
      <div class="calc-line calc-line--total"><span>Total</span><span>${esc(formatMoney(
        state.supplies.reduce((sum, item) => sum + inventory.num(item.value), 0),
      ))}</span></div>` : `
      <p class="small faint">Nenhum consumível adicionado. Use “Adicionar” para incluir cola, lixa,
        embalagem e afins.</p>`;
  };

  const renderDonut = () => {
    const parts = breakdown(result);
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    const donut = out('donut');
    if (total <= 0) {
      donut.style.background = '';
      donut.classList.add('calc-donut--empty');
      out('legend').innerHTML = '<p class="small faint">Preencha o material e o tempo para ver a composição.</p>';
      return;
    }
    let acc = 0;
    const stops = parts.map((part) => {
      const from = (acc / total) * 360;
      acc += part.value;
      return `${part.color} ${from}deg ${(acc / total) * 360}deg`;
    });
    donut.classList.remove('calc-donut--empty');
    donut.style.background = `conic-gradient(${stops.join(',')})`;
    out('legend').innerHTML = parts.map((part) => `
      <div class="calc-legend__item">
        <span class="calc-legend__dot" style="background:${esc(part.color)}"></span>
        ${esc(part.label)} <b>${esc(formatMoney(part.value))}</b>
      </div>`).join('');
  };

  const update = () => {
    store.set(ADV_KEY, state);
    result = compute({
      grams: state.grams,
      hours: state.hours,
      minutes: state.minutes,
      pricePerKg: state.pricePerKg,
      watts: state.watts,
      kwhPrice: state.kwhPrice,
      machineDepreciation: state.depOn,
      printerValue: state.printerValue,
      printerLife: state.printerLife,
      failureEnabled: state.failOn,
      failureRate: state.failureRate,
      supplies: state.supplies,
      markup: state.markup,
      postMinutes: state.postMinutes,
      laborRate: state.laborRate,
      artHours: state.paintOn ? state.artHours : 0,
      artMinutes: state.paintOn ? state.artMinutes : 0,
      artRate: state.artRate,
      channel: state.channel,
      commission: state.commission,
      fixedFee: state.fixedFee,
    });

    ['materialBase', 'purge', 'energy', 'machine', 'suppliesAndRisk', 'production',
      'markupProfit', 'labor', 'art', 'channelFee', 'profit'].forEach((key) => {
      out(key).textContent = formatMoney(result[key]);
    });
    out('price').textContent = formatMoney(result.price);
    out('margin').textContent = `${(result.margin * 100).toFixed(1)}%`;
    out('hours').textContent = formatHours(result.hours);
    out('profitLine').innerHTML = result.price > 0
      ? `Lucro líquido <strong>${esc(formatMoney(result.profit))}</strong> ·
         ${esc(((result.profit / result.price) * 100).toFixed(1))}% do preço`
      : '<span class="faint">Preencha o material e o tempo de impressão.</span>';
    qs('#dep-warn', pane).hidden = !state.depOn;
    renderDonut();
  };

  pane.addEventListener('input', (event) => {
    const el = event.target;
    if (el.dataset.k) {
      state[el.dataset.k] = el.value;
      update();
      return;
    }
    if (el.dataset.s) {
      const index = Number(el.closest('[data-index]').dataset.index);
      state.supplies[index][el.dataset.s] = el.value;
      // O total vive na lista, então só ele é reescrito aqui — não a lista inteira,
      // para não roubar o foco de quem está digitando.
      update();
      const totalSlot = qs('#supply-list .calc-line--total span:last-child', pane);
      if (totalSlot) {
        totalSlot.textContent = formatMoney(
          state.supplies.reduce((sum, item) => sum + inventory.num(item.value), 0),
        );
      }
    }
  }, bind);

  pane.addEventListener('change', (event) => {
    const el = event.target;
    if (el.type === 'checkbox' && el.dataset.k) {
      state[el.dataset.k] = el.checked;
      update();
    }
  }, bind);

  pane.addEventListener('click', (event) => {
    const sug = event.target.closest('.calc-sug');
    if (sug) {
      sug.dataset.set.split('|').forEach((pair) => {
        const [key, value] = pair.split(':');
        state[key] = value;
        const input = qs(`[data-k="${key}"]`, pane);
        if (input) input.value = value;
      });
      update();
      return;
    }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      state.supplies.splice(Number(remove.dataset.remove), 1);
      renderSupplies();
      update();
    }
  }, bind);

  qs('#supply-add', pane).addEventListener('click', () => {
    state.supplies.push({ name: '', value: '' });
    renderSupplies();
    update();
  }, bind);

  channelSelect.addEventListener('change', () => {
    const channel = getChannel(channelSelect.value);
    state.channel = channel.id;
    state.commission = String(channel.commission);
    state.fixedFee = String(channel.fixedFee);
    qs('[data-k="commission"]', pane).value = state.commission;
    qs('[data-k="fixedFee"]', pane).value = state.fixedFee;
    update();
  }, bind);

  filamentSelect?.addEventListener('change', () => {
    state.filamentId = filamentSelect.value;
    const filament = filaments.find((f) => f.id === state.filamentId);
    if (filament) {
      state.pricePerKg = inventory.pricePerKg(filament).toFixed(2);
      qs('[data-k="pricePerKg"]', pane).value = state.pricePerKg;
    }
    update();
  }, bind);

  qs('#act-save', pane).addEventListener('click', async () => {
    const name = await askName(state.name);
    if (!name) return;
    state.name = name;
    qs('[data-k="name"]', pane).value = name;
    inventory.save({
      type: 'produto',
      name,
      qty: 1,
      unit: 'un',
      cost: result.cost + result.labor + result.art,
      price: result.price,
      weight: inventory.num(state.grams),
      printHours: result.hours,
    });
    store.set(ADV_KEY, state);
    toast('Produto salvo no estoque.', { type: 'success' });
  }, bind);

  qs('#act-quote', pane).addEventListener('click', () => {
    const name = state.name.trim() || 'Peça personalizada';
    store.set('quoteDraft', { name, qty: 1, price: result.price });
    ctx.navigate('/orcamento');
  }, bind);

  renderSupplies();
  update();
  return () => ac.abort();
}

/** Pede o nome do produto antes de gravar no estoque. */
function askName(current = '') {
  return openModal((close) => {
    // `render` devolve markup, então o formulário só pode ser ligado depois que
    // o modal entra no DOM — daí o microtask.
    queueMicrotask(() => {
      const form = document.querySelector('#ask-name');
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = form.querySelector('#prod-name').value.trim();
        if (!value) {
          toast('Informe o nome do produto.', { type: 'error' });
          return;
        }
        close(value);
      });
    });
    return `
    <div class="modal__head"><h2>Salvar no estoque</h2>
      <button class="btn btn--ghost btn--icon" type="button" data-close="">${icon('x', 18)}</button></div>
    <div class="modal__body">
      <form class="form" id="ask-name">
        <div class="field">
          <label for="prod-name">Nome do produto</label>
          <input class="input" id="prod-name" value="${esc(current)}" autofocus
                 placeholder="Ex.: vaso decorativo P" required>
          <p class="field__hint">O item é gravado como <strong>produto</strong>, com custo, preço,
            peso e tempo de impressão deste cálculo.</p>
        </div>
      </form>
    </div>
    <div class="modal__foot">
      <button class="btn" type="button" data-close="">Cancelar</button>
      <button class="btn btn--primary" type="submit" form="ask-name">${icon('save', 16)} Salvar</button>
    </div>`;
  }).then((value) => (typeof value === 'string' ? value.trim() : ''));
}
