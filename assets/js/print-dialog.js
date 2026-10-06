/*
 * Diálogo "Imprimir": debita do estoque o filamento que a peça consome.
 *
 * Não emite orçamento nem grava histórico — a ação é só essa, a pedido: tirar
 * as gramas do rolo. O custo do material aparece como informação, para conferir
 * antes de confirmar.
 */

import { planPrint, registerPrint } from './production.js';
import { formatMoney } from './costing.js';
import { esc, icon, qs, openModal, toast } from './util.js';

const g = (value) => `${Number(value || 0).toFixed(1)} g`;

/** Bolinha com a cor do filamento. */
const dot = (hex) => `<i style="display:inline-block;width:12px;height:12px;border-radius:50%;
  border:1px solid var(--border);background:${esc(hex || '#ffffff')};flex:none"></i>`;

function renderRows(plano) {
  return plano.linhas.map((linha) => {
    const falta = linha.falta > 0.01;
    return `
      <div class="row">
        <div class="row__thumb" style="display:flex;align-items:center;justify-content:center">
          ${dot(linha.filament.hex)}
        </div>
        <div class="row__main">
          <div class="row__title">${esc(linha.filament.name)}</div>
          <div class="row__sub">${esc(linha.material)} · em estoque ${g(linha.disponivel)}</div>
        </div>
        <div style="text-align:right">
          <div class="mono" style="font-weight:600${falta ? ';color:var(--danger)' : ''}">
            −${g(linha.grams)}</div>
          <div class="small faint">${falta
            ? `faltam ${g(linha.falta)}`
            : `fica com ${g(linha.disponivel - linha.grams)}`}</div>
        </div>
      </div>`;
  }).join('');
}

const renderFoot = (plano) => `Saem do estoque <strong>${g(plano.totalGrams)}</strong>
  · material ${esc(formatMoney(plano.custo))}`;

/**
 * Abre o diálogo. Resolve o resultado de `registerPrint` quando confirmado,
 * ou `null` quando cancelado ou quando nada da peça está no estoque.
 */
export async function openPrintDialog(analysis, { title = 'Imprimir' } = {}) {
  let plano = planPrint(analysis, { copies: 1 });

  if (!plano.linhas.length) {
    toast('Nenhum filamento desta peça está no estoque. Cadastre o rolo para poder debitar.', {
      type: 'warn', title: 'Sem filamento', timeout: 6000,
    });
    return null;
  }

  const confirmado = await openModal((close) => `
    <div class="modal__head"><h2>${esc(title)}</h2>
      <button class="btn btn--ghost btn--icon" type="button" data-close="">${icon('x', 18)}</button></div>
    <div class="modal__body stack">
      <p class="muted small">Confirmar apenas baixa o filamento do estoque. Nada mais é alterado.</p>

      <div class="field" style="max-width:150px">
        <label for="print-copies">Cópias</label>
        <input class="input mono" id="print-copies" type="number" min="1" step="1" value="1" autofocus>
      </div>

      <div id="print-rows" class="stack stack--sm">${renderRows(plano)}</div>

      ${analysis.purgeGrams > 0 ? `<p class="small faint">
        Inclui ${g(analysis.purgeGrams)} de purga/troca de cor, rateada pela proporção de
        gramas de cada filamento.</p>` : ''}

      <div id="print-warn" class="banner banner--warn" style="margin:0" hidden>${icon('alert', 18)}
        <div class="small" id="print-warn-text"></div>
      </div>

      <p class="small" id="print-total">${renderFoot(plano)}</p>
    </div>
    <div class="modal__foot">
      <button class="btn" type="button" data-close="">Cancelar</button>
      <button class="btn btn--primary" type="button" data-close="yes" id="print-confirm">
        ${icon('printer', 16)} Debitar do estoque</button>
    </div>`, {
    wide: true,
    ready: (box) => {
      const input = qs('#print-copies', box);
      input.addEventListener('input', () => {
        plano = planPrint(analysis, { copies: input.value });
        qs('#print-rows', box).innerHTML = renderRows(plano);
        qs('#print-total', box).innerHTML = renderFoot(plano);
        const warn = qs('#print-warn', box);
        warn.hidden = plano.ok;
        if (!plano.ok) {
          qs('#print-warn-text', box).textContent =
            `${plano.error} Confirmar zera o saldo desses rolos.`;
        }
        const confirm = qs('#print-confirm', box);
        confirm.innerHTML = `${icon('printer', 16)} ${plano.ok ? 'Debitar do estoque' : 'Debitar mesmo assim'}`;
      });
    },
  });

  if (confirmado !== 'yes') return null;

  // `force` porque o aviso já foi dado na tela: o usuário decide imprimir com
  // o rolo no limite.
  const result = registerPrint(analysis, { copies: plano.copies, force: true });
  if (!result.ok) {
    toast(result.error || 'Não foi possível debitar o estoque.', { type: 'error', title: 'Erro' });
    return null;
  }

  const resumo = result.linhas.map((l) => `${l.filament.name} −${g(l.grams)}`).join(', ');
  toast(`${result.copies > 1 ? `${result.copies} cópias · ` : ''}${resumo}.`, {
    type: result.forced ? 'warn' : 'success',
    title: result.forced ? 'Impressão registrada, estoque no limite' : 'Impressão registrada',
    timeout: 6000,
  });
  return result;
}

export default openPrintDialog;
