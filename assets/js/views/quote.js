/*
 * Orçamento: formulário, totais ao vivo, documento para impressão e WhatsApp.
 *
 * Não há jsPDF aqui (site estático, zero dependências): o PDF sai do próprio
 * navegador. Montamos `#orcamento-print` fora de `#view` e chamamos
 * `window.print()`; `assets/css/print.css` esconde a interface e deixa só ele.
 */

import store from '../store.js';
import { products, num } from '../inventory.js';
import { formatMoney, getSettings } from '../costing.js';
import { esc, icon, qs, on, toast, openModal, formatDate } from '../util.js';

const DDIS = ['+55', '+1', '+351', '+34'];
const DELIVERIES = ['Sem prazo', '3 dias', '5 dias', '7 dias', '10 dias', '15 dias', '30 dias'];
const HISTORY_KEY = 'quotes';
const HISTORY_MAX = 50;
const LOGO_KEY = 'quoteLogo';
const PRINT_ID = 'orcamento-print';

const emptyItem = () => ({ name: '', qty: 1, desc: '', price: '', disc: '' });

const lineTotal = (it) => Math.max(0, num(it.qty) * num(it.price) * (1 - num(it.disc) / 100));

const onlyDigits = (value) => String(value || '').replace(/\D+/g, '');

function blankForm(settings) {
  return {
    logo: store.get(LOGO_KEY, '') || '',
    number: '',
    validity: 7,
    seller: settings.studioName || '',
    sellerPhone: settings.phone || '',
    client: '',
    ddi: '+55',
    phone: '',
    email: '',
    doc: '',
    delivery: 'Sem prazo',
    items: [emptyItem()],
    discType: '%',
    discount: '',
    shipping: '',
    notes: '',
  };
}

export default async function quoteView(container, ctx) {
  const settings = getSettings();
  const f = blankForm(settings);

  /* Rascunho da calculadora de preço: entra como primeiro item e é consumido. */
  const draft = ctx.store?.get('quoteDraft') ?? store.get('quoteDraft');
  if (draft && (draft.name || draft.price || draft.qty)) {
    f.items = [{ ...emptyItem(), name: draft.name || '', qty: draft.qty || 1, price: draft.price ?? '' }];
    store.remove('quoteDraft');
  }

  const totals = () => {
    const subtotal = f.items.reduce((sum, it) => sum + lineTotal(it), 0);
    const discount = f.discType === '%' ? subtotal * (num(f.discount) / 100) : num(f.discount);
    const shipping = num(f.shipping);
    return { subtotal, discount, shipping, total: Math.max(0, subtotal - discount + shipping) };
  };

  const history = () => {
    const raw = store.get(HISTORY_KEY, []);
    return Array.isArray(raw) ? raw : [];
  };

  /* ---------- Markup ---------- */

  const itemRow = (it, index) => `
    <div class="panel" data-item="${index}" style="background:var(--surface)">
      <div class="panel__body stack stack--sm">
        <div class="grid-2">
          <div class="field">
            <label>Nome do item</label>
            <input class="input" data-key="name" placeholder="Ex.: Suporte de fone"
                   value="${esc(it.name)}">
          </div>
          <div class="field">
            <label>Qtd</label>
            <input class="input" data-key="qty" type="number" min="1" inputmode="numeric"
                   value="${esc(it.qty)}">
          </div>
          <div class="field">
            <label>Preço unit.</label>
            <input class="input" data-key="price" inputmode="decimal" placeholder="0,00"
                   value="${esc(it.price)}">
          </div>
          <div class="field">
            <label>Desc. %</label>
            <input class="input" data-key="disc" inputmode="decimal" placeholder="0"
                   value="${esc(it.disc)}">
          </div>
        </div>
        <div class="field">
          <label>Descrição (opcional)</label>
          <input class="input" data-key="desc" placeholder="Cor, material, acabamento…"
                 value="${esc(it.desc)}">
        </div>
        <div class="inline">
          <strong class="nowrap" data-line-total>${esc(formatMoney(lineTotal(it)))}</strong>
          <span class="toolbar__spacer"></span>
          <button class="btn btn--ghost btn--sm" type="button" data-remove-item
                  ${f.items.length > 1 ? '' : 'disabled'}>${icon('trash', 15)} Remover</button>
        </div>
      </div>
    </div>`;

  const historyMarkup = () => {
    const recent = history().slice(0, 5);
    if (!recent.length) {
      return '<p class="small faint">Nenhum orçamento gerado ainda neste navegador.</p>';
    }
    return recent.map((q, index) => `
      <div class="row">
        <span class="row__main">
          <span class="row__title">${esc(q.client || 'Sem cliente')}${q.number ? ` · Nº ${esc(q.number)}` : ''}</span>
          <span class="row__sub">${esc(formatMoney(num(q.total)))} · ${esc(formatDate(q.date))}</span>
        </span>
        <button class="btn btn--sm" type="button" data-load-quote="${index}">
          ${icon('rotate', 15)} Recarregar</button>
      </div>`).join('');
  };

  const markup = () => `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Orçamento</h1>
        <p>Monte a proposta, veja o total em tempo real e envie por WhatsApp ou PDF.</p>
      </div>
    </div>

    <div class="stack">
      <div class="panel">
        <div class="panel__head">${icon('fileText', 14)} Identificação</div>
        <div class="panel__body stack">
          <div class="field">
            <label for="logo">Logo (opcional)</label>
            <input class="input" type="file" id="logo" accept="image/*">
            <p class="field__hint">Fica guardada neste navegador para os próximos orçamentos.</p>
            <div id="logo-preview" class="inline">${f.logo ? `
              <img src="${esc(f.logo)}" alt="Pré-visualização da logo"
                   style="max-height:72px;max-width:160px;object-fit:contain;background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:4px">
              <button class="btn btn--ghost btn--sm" type="button" id="logo-clear">
                ${icon('x', 15)} Remover logo</button>` : ''}</div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="number">Nº do orçamento (opcional)</label>
              <input class="input" id="number" data-f="number" placeholder="Ex.: ORC-001"
                     value="${esc(f.number)}">
            </div>
            <div class="field">
              <label for="validity">Validade (dias)</label>
              <input class="input" id="validity" data-f="validity" type="number" min="1"
                     inputmode="numeric" value="${esc(f.validity)}">
            </div>
            <div class="field">
              <label for="seller">Nome da empresa / vendedor *</label>
              <input class="input" id="seller" data-f="seller" placeholder="Ex.: Estúdio 3D do Bruno"
                     value="${esc(f.seller)}">
            </div>
            <div class="field">
              <label for="sellerPhone">Telefone do vendedor (opcional)</label>
              <input class="input" id="sellerPhone" data-f="sellerPhone" placeholder="Ex.: (11) 99999-9999"
                     value="${esc(f.sellerPhone)}">
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('user', 14)} Cliente</div>
        <div class="panel__body">
          <div class="grid-2">
            <div class="field">
              <label for="client">Nome do cliente *</label>
              <input class="input" id="client" data-f="client" placeholder="Ex.: João da Silva"
                     value="${esc(f.client)}">
            </div>
            <div class="field">
              <label for="phone">WhatsApp do cliente</label>
              <div class="inline">
                <select class="select" id="ddi" data-f="ddi" style="width:96px" aria-label="Código do país">
                  ${DDIS.map((d) => `<option value="${esc(d)}"${f.ddi === d ? ' selected' : ''}>${esc(d)}</option>`).join('')}
                </select>
                <input class="input" id="phone" data-f="phone" style="flex:1;min-width:140px"
                       placeholder="Ex.: (61) 99999-0000" value="${esc(f.phone)}">
              </div>
            </div>
            <div class="field">
              <label for="email">E-mail do cliente</label>
              <input class="input" id="email" data-f="email" type="email" placeholder="cliente@email.com"
                     value="${esc(f.email)}">
            </div>
            <div class="field">
              <label for="doc">CPF / CNPJ</label>
              <input class="input" id="doc" data-f="doc" placeholder="000.000.000-00" value="${esc(f.doc)}">
            </div>
            <div class="field">
              <label for="delivery">Prazo de entrega</label>
              <select class="select" id="delivery" data-f="delivery">
                ${DELIVERIES.map((d) => `<option value="${esc(d)}"${f.delivery === d ? ' selected' : ''}>${esc(d)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('package', 14)} Itens</div>
        <div class="panel__body stack">
          <div class="btn-row">
            <button class="btn btn--sm" type="button" id="import-stock">
              ${icon('box', 15)} Importar do estoque</button>
            <button class="btn btn--primary btn--sm" type="button" id="add-item">
              ${icon('plus', 15)} Adicionar item</button>
          </div>
          <div class="stack stack--sm" id="items">${f.items.map(itemRow).join('')}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('coins', 14)} Desconto, frete e totais</div>
        <div class="panel__body stack">
          <div class="grid-2">
            <div class="field">
              <label for="discount">Desconto geral</label>
              <div class="inline">
                <select class="select" id="discType" data-f="discType" style="width:150px">
                  <option value="%"${f.discType === '%' ? ' selected' : ''}>Porcentagem (%)</option>
                  <option value="$"${f.discType === '$' ? ' selected' : ''}>Valor fixo</option>
                </select>
                <input class="input" id="discount" data-f="discount" inputmode="decimal"
                       style="flex:1;min-width:120px" placeholder="0" value="${esc(f.discount)}">
              </div>
            </div>
            <div class="field">
              <label for="shipping">Frete (opcional)</label>
              <input class="input" id="shipping" data-f="shipping" inputmode="decimal"
                     placeholder="0,00" value="${esc(f.shipping)}">
            </div>
          </div>
          <div class="stats" id="totals"></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('message', 14)} Fechamento</div>
        <div class="panel__body stack">
          <div class="field">
            <label for="notes">Observações</label>
            <textarea class="textarea" id="notes" data-f="notes" rows="3"
              placeholder="Informações adicionais, formas de pagamento, etc.">${esc(f.notes)}</textarea>
          </div>
          <div class="btn-row">
            <button class="btn btn--primary" type="button" id="do-print">
              ${icon('printer', 16)} Gerar PDF</button>
            <button class="btn" type="button" id="do-whats">
              ${icon('message', 16)} Enviar WhatsApp</button>
          </div>
          <p class="small faint">O PDF sai pelo diálogo de impressão do navegador:
            escolha <strong>Salvar como PDF</strong> no campo de destino.</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('clock', 14)} Últimos orçamentos</div>
        <div class="panel__body stack stack--sm" id="history">${historyMarkup()}</div>
      </div>
    </div>`;

  /* ---------- Atualizações pontuais ---------- */

  const paintTotals = () => {
    const { subtotal, discount, shipping, total } = totals();
    const slot = qs('#totals', container);
    if (!slot) return;
    slot.innerHTML = `
      <div class="stat"><div class="stat__value">${esc(formatMoney(subtotal))}</div>
        <div class="stat__label">Subtotal</div></div>
      <div class="stat"><div class="stat__value">- ${esc(formatMoney(discount))}</div>
        <div class="stat__label">Desconto</div></div>
      <div class="stat"><div class="stat__value">${esc(formatMoney(shipping))}</div>
        <div class="stat__label">Frete</div></div>
      <div class="stat"><div class="stat__value" style="color:var(--accent)">${esc(formatMoney(total))}</div>
        <div class="stat__label">Total</div></div>`;
  };

  const paintItems = () => {
    qs('#items', container).innerHTML = f.items.map(itemRow).join('');
    paintTotals();
  };

  const paintHistory = () => {
    qs('#history', container).innerHTML = historyMarkup();
  };

  const render = () => {
    container.innerHTML = markup();
    paintTotals();
  };

  /* ---------- Documento de impressão ---------- */

  /* Fica fora de `#view` porque print.css esconde `#view > *` ao imprimir. */
  const printSlot = document.createElement('div');
  printSlot.id = PRINT_ID;
  document.body.appendChild(printSlot);

  const buildPrintDoc = () => {
    const { subtotal, discount, shipping, total } = totals();
    const current = getSettings();
    const rows = f.items.filter((it) => it.name.trim()).map((it) => `
      <tr>
        <td>${esc(it.name)}</td>
        <td class="p-desc">${esc(it.desc || '—')}</td>
        <td class="p-num">${esc(it.qty)}</td>
        <td class="p-num">${esc(formatMoney(num(it.price)))}</td>
        <td class="p-num">${it.disc ? `${esc(it.disc)}%` : '—'}</td>
        <td class="p-num">${esc(formatMoney(lineTotal(it)))}</td>
      </tr>`).join('');

    printSlot.innerHTML = `
      <div class="p-sheet">
        <header class="p-head">
          <div class="p-brand">
            ${f.logo ? `<img class="p-logo" src="${esc(f.logo)}" alt="">` : ''}
            <div>
              <div class="p-seller">${esc(f.seller)}</div>
              ${f.sellerPhone ? `<div class="p-faint">${esc(f.sellerPhone)}</div>` : ''}
            </div>
          </div>
          <div class="p-meta">
            <h1>ORÇAMENTO</h1>
            ${f.number ? `<div>Nº ${esc(f.number)}</div>` : ''}
            <div>${esc(formatDate(new Date().toISOString()))}</div>
            <div>Validade: ${esc(f.validity)} dias</div>
          </div>
        </header>

        <section class="p-party">
          <div>
            <h2>Cliente</h2>
            <div>${esc(f.client)}</div>
            ${f.doc ? `<div>${esc(f.doc)}</div>` : ''}
            ${f.email ? `<div>${esc(f.email)}</div>` : ''}
            ${f.phone ? `<div>${esc(f.ddi)} ${esc(f.phone)}</div>` : ''}
          </div>
          <div>
            <h2>Vendedor</h2>
            <div>${esc(f.seller)}</div>
            ${f.sellerPhone ? `<div>${esc(f.sellerPhone)}</div>` : ''}
          </div>
        </section>

        <table class="p-items">
          <thead>
            <tr><th>Item</th><th>Descrição</th><th class="p-num">Qtd</th>
              <th class="p-num">Unitário</th><th class="p-num">Desconto</th><th class="p-num">Total</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <table class="p-totals">
          <tr><td>Subtotal</td><td class="p-num">${esc(formatMoney(subtotal))}</td></tr>
          ${discount > 0 ? `<tr><td>Desconto</td><td class="p-num">- ${esc(formatMoney(discount))}</td></tr>` : ''}
          ${shipping > 0 ? `<tr><td>Frete</td><td class="p-num">${esc(formatMoney(shipping))}</td></tr>` : ''}
          <tr class="p-grand"><td>Total</td><td class="p-num">${esc(formatMoney(total))}</td></tr>
        </table>

        <footer class="p-foot">
          ${f.delivery && f.delivery !== 'Sem prazo' ? `<div>Prazo de entrega: ${esc(f.delivery)}</div>` : ''}
          ${current.pix ? `<div>Chave PIX: ${esc(current.pix)}</div>` : ''}
          ${f.notes ? `<div class="p-notes">${esc(f.notes)}</div>` : ''}
        </footer>
      </div>`;
  };

  /* ---------- Validação e ações ---------- */

  const validate = () => {
    if (!f.seller.trim()) {
      toast('Informe o nome da empresa/vendedor.', { type: 'error' });
      return false;
    }
    if (!f.client.trim()) {
      toast('Informe o nome do cliente.', { type: 'error' });
      return false;
    }
    if (!f.items.some((it) => it.name.trim())) {
      toast('Adicione ao menos um item com nome.', { type: 'error' });
      return false;
    }
    return true;
  };

  const saveToHistory = () => {
    const { total } = totals();
    /* A logo é pesada em base64 e já vive na chave própria; fora do histórico. */
    const { logo, ...rest } = f;
    const record = { ...rest, items: f.items.map((it) => ({ ...it })), total, date: new Date().toISOString() };
    store.set(HISTORY_KEY, [record, ...history()].slice(0, HISTORY_MAX));
    paintHistory();
  };

  const doPrint = () => {
    if (!validate()) return;
    buildPrintDoc();
    saveToHistory();
    window.print();
  };

  const doWhatsApp = () => {
    if (!validate()) return;
    const { total } = totals();
    const current = getSettings();
    const lines = f.items.filter((it) => it.name.trim())
      .map((it) => `• ${it.qty}x ${it.name} — ${formatMoney(lineTotal(it))}`).join('\n');
    const msg = `Olá ${f.client}! Segue seu orçamento${f.number ? ` ${f.number}` : ''}:\n\n${lines}`
      + `\n\n*Total: ${formatMoney(total)}*\nValidade: ${f.validity} dias.`
      + (current.pix ? `\nPIX: ${current.pix}` : '');
    const phone = onlyDigits(f.ddi) + onlyDigits(f.phone);
    if (!phone) {
      toast('Informe o WhatsApp do cliente.', { type: 'error' });
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  };

  /* ---------- Eventos (delegados no container, sobrevivem ao re-render) ---------- */

  on(container, '[data-f]', 'input', (_ev, el) => {
    f[el.dataset.f] = el.value;
    paintTotals();
  });
  on(container, '[data-f]', 'change', (_ev, el) => {
    f[el.dataset.f] = el.value;
    paintTotals();
  });

  on(container, '[data-item] [data-key]', 'input', (_ev, el) => {
    const box = el.closest('[data-item]');
    const index = Number(box.dataset.item);
    f.items[index][el.dataset.key] = el.value;
    const slot = qs('[data-line-total]', box);
    if (slot) slot.textContent = formatMoney(lineTotal(f.items[index]));
    paintTotals();
  });

  on(container, '[data-remove-item]', 'click', (_ev, el) => {
    if (f.items.length <= 1) return;
    f.items.splice(Number(el.closest('[data-item]').dataset.item), 1);
    paintItems();
  });

  on(container, '#add-item', 'click', () => {
    f.items.push(emptyItem());
    paintItems();
  });

  on(container, '#logo', 'change', (_ev, el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      f.logo = String(reader.result || '');
      store.set(LOGO_KEY, f.logo);
      render();
      toast('Logo carregada.', { type: 'success', timeout: 2200 });
    };
    reader.onerror = () => toast('Não foi possível ler a imagem.', { type: 'error' });
    reader.readAsDataURL(file);
  });

  on(container, '#logo-clear', 'click', () => {
    f.logo = '';
    store.remove(LOGO_KEY);
    render();
  });

  on(container, '#import-stock', 'click', async () => {
    const stock = products();
    const chosen = await openModal((close) => `
      <div class="modal__head"><h2>Importar do estoque</h2>
        <button class="btn btn--ghost btn--icon" type="button" data-close="">${icon('x', 18)}</button></div>
      <div class="modal__body">
        ${stock.length ? stock.map((p) => `
          <button class="row" type="button" data-close="${esc(p.id)}" style="width:100%;text-align:left">
            <span class="row__main">
              <span class="row__title">${esc(p.name)}</span>
              <span class="row__sub">${esc(formatMoney(num(p.price)))}</span>
            </span>
            ${icon('plus', 15)}
          </button>`).join('')
        : '<p class="muted small">Nenhum produto no estoque.</p>'}
      </div>`);
    if (!chosen) return;
    const product = stock.find((p) => p.id === chosen);
    if (!product) return;
    /* Linha vazia inicial dá lugar ao produto importado. */
    f.items = f.items.filter((it) => it.name.trim());
    f.items.push({
      name: product.name,
      qty: 1,
      desc: product.notes || '',
      price: String(num(product.price) || ''),
      disc: '',
    });
    paintItems();
  });

  on(container, '[data-load-quote]', 'click', (_ev, el) => {
    const record = history()[Number(el.dataset.loadQuote)];
    if (!record) return;
    Object.assign(f, blankForm(getSettings()), record, {
      logo: f.logo,
      items: (record.items || []).map((it) => ({ ...emptyItem(), ...it })),
    });
    if (!f.items.length) f.items = [emptyItem()];
    render();
    toast('Orçamento recarregado no formulário.', { type: 'info', timeout: 2400 });
  });

  on(container, '#do-print', 'click', doPrint);
  on(container, '#do-whats', 'click', doWhatsApp);

  render();

  return () => printSlot.remove();
}
