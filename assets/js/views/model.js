/* Detalhe do modelo: visualizador 3D, metadados e ações. */

import * as catalog from '../catalog.js';
import * as auth from '../auth.js';
import * as gh from '../github.js';
import { parseModel, measure } from '../parsers/index.js';
import { analyze } from '../production.js';
import { printerLabel, getPrinter } from '../printers.js';
import { formatMoney, formatHours } from '../costing.js';
import { Viewer } from '../viewer.js';
import {
  esc, icon, qs, qsa, on, toast, formatBytes, formatNumber, formatDate, formatMm,
  confirmDialog, copyText,
} from '../util.js';

/** Baixa o arquivo reportando progresso quando o servidor informa o tamanho. */
async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Não foi possível baixar o arquivo (HTTP ${response.status}).`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) {
    onProgress(null);
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes.buffer;
}

const TOOLS = [
  ['autoRotate', 'rotate', 'Rotação automática'],
  ['showColors', 'palette', 'Cores do arquivo'],
  ['wireframe', 'triangle', 'Malha de arame'],
  ['showGrid', 'grid', 'Grade de referência'],
  ['boundingBox', 'box', 'Caixa envolvente'],
];

const ANGLES = [
  ['iso', 'Isométrica', 'ISO'],
  ['front', 'Vista frontal', 'Frente'],
  ['side', 'Vista lateral', 'Lado'],
  ['top', 'Vista de topo', 'Topo'],
];

function detailPanel(model, user) {
  const canDelete = !!user && (user.username === model.author || user.role === 'owner');
  const dims = model.dimensions;
  const hasDims = dims.x || dims.y || dims.z;
  const print = model.print;
  const hasPrint = print.material || print.layerHeight || print.infill || print.supports || print.notes;

  return `
    <div>
      <div class="panel">
        <div class="panel__body">
          <a class="btn btn--primary btn--block" href="${esc(catalog.fileUrl(model))}"
             download="${esc(model.id)}.${esc(model.format)}">
            ${icon('download', 18)} Baixar ${esc(model.format.toUpperCase())} · ${formatBytes(model.size)}
          </a>
          <div class="btn-row">
            <button class="btn btn--sm" type="button" id="fav">
              ${icon('star', 15)} <span>Favorito</span>
            </button>
            <button class="btn btn--sm" type="button" id="share">${icon('copy', 15)} Link</button>
            ${model.storage === 'git' ? `
              <a class="btn btn--sm" href="${esc(gh.links.tree(model.file))}" target="_blank" rel="noopener">
                ${icon('github', 15)} Git
              </a>` : ''}
          </div>
        </div>
      </div>

      ${model.description ? `
      <div class="panel">
        <div class="panel__head">${icon('file', 14)} Descrição</div>
        <div class="panel__body"><p class="prose">${esc(model.description)}</p></div>
      </div>` : ''}

      <div class="panel">
        <div class="panel__head">${icon('sliders', 14)} Informações</div>
        <div class="panel__body">
          <dl class="dl">
            <div class="dl__row"><dt>Autor</dt><dd>${esc(model.author)}</dd></div>
            <div class="dl__row"><dt>Formato</dt><dd>${esc(model.format.toUpperCase())}</dd></div>
            <div class="dl__row"><dt>Triângulos</dt><dd id="tri-count">${formatNumber(model.triangles) || '—'}</dd></div>
            ${hasDims ? `<div class="dl__row"><dt>Dimensões</dt>
              <dd class="mono" id="dim-text">${formatMm(dims.x)} × ${formatMm(dims.y)} × ${formatMm(dims.z)}</dd></div>` : ''}
            <div class="dl__row"><dt>Tamanho</dt><dd>${formatBytes(model.size)}</dd></div>
            <div class="dl__row"><dt>Publicado</dt><dd>${esc(formatDate(model.createdAt))}</dd></div>
          </dl>
        </div>
      </div>

      ${hasPrint ? `
      <div class="panel">
        <div class="panel__head">${icon('layers', 14)} Impressão sugerida</div>
        <div class="panel__body">
          <dl class="dl">
            ${print.material ? `<div class="dl__row"><dt>Material</dt><dd>${esc(print.material)}</dd></div>` : ''}
            ${print.layerHeight ? `<div class="dl__row"><dt>Camada</dt><dd>${esc(print.layerHeight)}</dd></div>` : ''}
            ${print.infill ? `<div class="dl__row"><dt>Preenchimento</dt><dd>${esc(print.infill)}</dd></div>` : ''}
            <div class="dl__row"><dt>Suportes</dt><dd>${print.supports ? 'Sim' : 'Não'}</dd></div>
          </dl>
          ${print.notes ? `<p class="prose">${esc(print.notes)}</p>` : ''}
        </div>
      </div>` : ''}

      ${model.tags.length ? `
      <div class="panel">
        <div class="panel__head">${icon('tag', 14)} Etiquetas</div>
        <div class="panel__body">
          <div class="inline">${model.tags.map((t) =>
            `<a class="chip" href="#/biblioteca?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
        </div>
      </div>` : ''}

      ${canDelete ? `
      <div class="panel">
        <div class="panel__head">${icon('trash', 14)} Administração</div>
        <div class="panel__body">
          <p class="small faint">${model.storage === 'storage'
            ? 'Remove o registro do catálogo e apaga os arquivos do acervo. Só o autor pode remover.'
            : 'Remove o registro do catálogo e apaga os arquivos do repositório Git, em commits. '
              + 'Requer credencial de escrita.'}</p>
          <button class="btn btn--danger btn--block" type="button" id="delete">
            ${icon('trash', 16)} Remover modelo
          </button>
        </div>
      </div>` : ''}
    </div>`;
}

/** Dados de produção: peso, purga, filamentos e custo com o estoque atual. */
function renderProduction(geometry, model, container) {
  const slot = qs('#production', container);
  if (!slot) return;

  const analysis = analyze(geometry, {
    printerId: model.printerId || '',
    material: model.print?.material,
    infillPercent: parseFloat(model.print?.infill) || 20,
    hours: model.printSeconds ? model.printSeconds / 3600 : 0,
  });

  const measured = analysis.measured;
  const printer = getPrinter(model.printerId);
  const palette = analysis.usage.filter((row) => row.color);

  slot.innerHTML = `
    <div>
      <div class="panel">
        <div class="panel__head">${icon('coins', 14)} Produção
          <span class="toolbar__spacer"></span>
          <span class="chip chip--static">${
            analysis.source === 'gcode' ? 'medido no G-code'
            : analysis.source === 'fatiador' ? 'medido pelo fatiador'
            : 'estimado pelo volume'}</span>
        </div>
        <div class="panel__body">
          <div class="stats" style="margin:0">
            <div class="stat"><div class="stat__value">${analysis.totalGrams.toFixed(0)} g</div>
              <div class="stat__label">Filamento total</div></div>
            ${analysis.purgeGrams > 0 ? `<div class="stat">
              <div class="stat__value">${analysis.purgeGrams.toFixed(0)} g</div>
              <div class="stat__label">Purga / troca</div></div>` : ''}
            ${analysis.hours > 0 ? `<div class="stat">
              <div class="stat__value" style="font-size:19px">${esc(formatHours(analysis.hours))}</div>
              <div class="stat__label">Tempo</div></div>` : ''}
            <div class="stat"><div class="stat__value" style="font-size:19px">${esc(formatMoney(analysis.cost.production))}</div>
              <div class="stat__label">Custo de fabricação</div></div>
            <div class="stat"><div class="stat__value" style="font-size:19px;color:var(--success)">${esc(formatMoney(analysis.cost.price))}</div>
              <div class="stat__label">Preço sugerido</div></div>
          </div>

          ${analysis.blockers.noFilamentRegistered ? `
            <div class="banner banner--warn" style="margin:0">${icon('alert', 18)}
              <div class="small">Nenhum filamento cadastrado no estoque: o custo acima não inclui material.</div>
              <div class="banner__actions"><a class="btn btn--sm btn--primary" href="#/estoque">Cadastrar</a></div>
            </div>` : ''}

          ${palette.length ? `
            <div class="stack stack--sm">
              <p class="small faint">Filamentos</p>
              <div class="inline">
                ${palette.map((row) => `
                  <span class="chip chip--static">
                    <i style="display:inline-block;width:11px;height:11px;border-radius:50%;border:1px solid var(--border);background:${esc(row.color)}"></i>
                    ${esc(row.material)} · ${row.grams.toFixed(1)} g
                  </span>`).join('')}
              </div>
            </div>` : ''}

          <div class="btn-row">
            <a class="btn btn--sm" href="#/calculadora">${icon('calculator', 15)} Calculadora</a>
            <a class="btn btn--sm" href="#/orcamento">${icon('fileText', 15)} Gerar orçamento</a>
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="panel">
        <div class="panel__head">${icon('printer', 14)} Impressão</div>
        <div class="panel__body">
          <dl class="dl">
            ${printer ? `<div class="dl__row"><dt>Ajustado para</dt>
              <dd>${esc(printerLabel(printer))}</dd></div>` : ''}
            ${analysis.slicer ? `<div class="dl__row"><dt>Fatiador</dt>
              <dd>${esc(analysis.slicer)}</dd></div>` : ''}
            ${analysis.nozzle ? `<div class="dl__row"><dt>Bico</dt>
              <dd class="mono">${esc(analysis.nozzle)} mm</dd></div>` : ''}
            ${analysis.layerHeight ? `<div class="dl__row"><dt>Camada</dt>
              <dd class="mono">${esc(analysis.layerHeight)} mm</dd></div>` : ''}
            <div class="dl__row"><dt>Preenchimento</dt>
              <dd class="mono">${esc(String(analysis.infill))}%</dd></div>
            <div class="dl__row"><dt>Volume da malha</dt>
              <dd class="mono">${analysis.volumeCm3.toFixed(1)} cm³</dd></div>
            <div class="dl__row"><dt>Filamentos</dt><dd>${analysis.filamentCount}</dd></div>
          </dl>
        </div>
      </div>
    </div>`;
}

export default async function modelView(container, ctx) {
  const id = decodeURIComponent(ctx.params.id || '');
  const model = await catalog.getById(id);

  if (!model) {
    container.innerHTML = `
      <div class="empty">${icon('alert', 40)}
        <h3>Modelo não encontrado</h3>
        <p>O identificador <span class="mono">${esc(id)}</span> não consta no catálogo.</p>
        <a class="btn btn--primary" href="#/biblioteca">${icon('library', 17)} Voltar à biblioteca</a>
      </div>`;
    return;
  }

  const user = auth.currentUser();

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>${esc(model.name)}</h1>
        <p>${esc(model.author)} · ${esc(model.format.toUpperCase())} · ${esc(formatDate(model.createdAt))}</p>
      </div>
      <a class="btn" href="#/biblioteca">${icon('library', 17)} Biblioteca</a>
    </div>

    <div class="detail">
      <div>
        <div class="viewer viewer--tall" id="viewer-box">
          <canvas id="viewer" aria-label="Visualização 3D de ${esc(model.name)}" role="img"></canvas>
          <div class="viewer__stats" id="stats" hidden></div>
          <div class="viewer__bar" id="tools" hidden>
            ${TOOLS.map(([key, ico, label]) =>
              `<button type="button" data-tool="${key}" title="${esc(label)}" aria-label="${esc(label)}">${icon(ico, 15)}</button>`).join('')}
            <span style="width:1px;background:var(--border);margin:2px 4px"></span>
            ${ANGLES.map(([key, label, short]) =>
              `<button type="button" data-angle="${key}" title="${esc(label)}" aria-label="${esc(label)}"
                style="width:auto;padding:0 8px;font-size:11px;font-weight:700">${esc(short)}</button>`).join('')}
            <button type="button" data-action="reset" title="Reenquadrar">${icon('maximize', 15)}</button>
          </div>
          <div class="viewer__overlay" id="overlay">
            <span>Carregando modelo…</span>
            <div class="progress"><i id="bar" style="width:0%"></i></div>
            <span class="small faint" id="phase">baixando arquivo</span>
          </div>
        </div>
        <p class="small faint" style="margin-top:8px">
          Arraste para girar · roda do mouse para aproximar · Shift+arraste para deslocar · R reenquadra
        </p>
      </div>
      ${detailPanel(model, user)}
    </div>
    <div id="production" class="detail" style="margin-top:24px"></div>`;

  /* ---------- Favorito / compartilhar ---------- */

  const favButton = qs('#fav', container);
  const syncFav = () => {
    const marked = auth.isFavorite(model.id);
    favButton?.classList.toggle('is-on', marked);
    if (favButton) {
      favButton.style.color = marked ? 'var(--warning)' : '';
      qs('span', favButton).textContent = marked ? 'Favoritado' : 'Favorito';
    }
  };
  syncFav();
  favButton?.addEventListener('click', () => {
    if (!auth.currentUser()) return toast('Entre com uma conta para salvar favoritos.', { type: 'warn' });
    auth.toggleFavorite(model.id);
    syncFav();
    ctx.refreshShell();
  });

  qs('#share', container)?.addEventListener('click', async () => {
    const ok = await copyText(location.href);
    toast(ok ? 'Link copiado.' : 'Não foi possível copiar o link.', { type: ok ? 'success' : 'error', timeout: 2200 });
  });

  /* ---------- Remoção ---------- */

  qs('#delete', container)?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (model.storage !== 'storage' && !gh.canWrite()) {
      const go = await confirmDialog({
        title: 'Falta credencial',
        message: 'Remover arquivos do repositório exige a função de publicação no Supabase ou um '
          + 'token do GitHub. Abrir as configurações?',
        confirmLabel: 'Abrir configurações',
      });
      if (go) ctx.navigate('/config');
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Remover modelo',
      message: model.storage === 'storage'
        ? `"${model.name}" será apagado do catálogo e do acervo. A ação não pode ser desfeita.`
        : `"${model.name}" será apagado do catálogo e do repositório. A ação cria commits e não pode ser desfeita pela interface.`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!confirmed) return;

    button.classList.add('is-loading');
    try {
      await catalog.remove(model);
      toast('Modelo removido. O GitHub Pages reflete a mudança em alguns instantes.', { type: 'success' });
      ctx.navigate('/biblioteca');
    } catch (error) {
      toast(error.message || 'Falha ao remover.', { type: 'error', title: 'Erro' });
      button.classList.remove('is-loading');
    }
  });

  /* ---------- Visualizador ---------- */

  const overlay = qs('#overlay', container);
  const bar = qs('#bar', container);
  const phase = qs('#phase', container);
  const tools = qs('#tools', container);
  const statsBox = qs('#stats', container);
  let viewer = null;

  const setProgress = (ratio) => {
    if (ratio === null) { bar.parentElement.hidden = true; return; }
    bar.style.width = `${Math.round(ratio * 100)}%`;
  };

  const fail = (message) => {
    overlay.innerHTML = `${icon('alert', 28)}<span>${esc(message)}</span>
      <a class="btn btn--sm" href="${esc(catalog.fileUrl(model))}" download>
        ${icon('download', 15)} Baixar arquivo</a>`;
  };

  try {
    const buffer = await fetchWithProgress(catalog.fileUrl(model), (ratio) => setProgress(ratio === null ? null : ratio * 0.6));
    phase.textContent = 'interpretando geometria';
    const geometry = await parseModel(buffer, model.format, (ratio) => setProgress(0.6 + ratio * 0.4));

    viewer = new Viewer(qs('#viewer', container), { showGrid: true });
    viewer.setGeometry(geometry);

    const metrics = measure(geometry);
    overlay.remove();
    tools.hidden = false;
    statsBox.hidden = false;
    statsBox.innerHTML = `
      <span>${formatNumber(geometry.triangles)} triângulos</span>
      <span>${metrics.size.x.toFixed(1)} × ${metrics.size.y.toFixed(1)} × ${metrics.size.z.toFixed(1)} mm</span>`;

    // Atualiza os metadados com o que foi medido de fato no arquivo.
    const triSlot = qs('#tri-count', container);
    if (triSlot) triSlot.textContent = formatNumber(geometry.triangles);
    const dimSlot = qs('#dim-text', container);
    if (dimSlot) dimSlot.textContent = `${formatMm(metrics.size.x)} × ${formatMm(metrics.size.y)} × ${formatMm(metrics.size.z)}`;

    const syncTools = () => {
      qsa('[data-tool]', tools).forEach((button) => {
        button.classList.toggle('is-active', !!viewer.options[button.dataset.tool]);
      });
    };
    // Sem cor no arquivo o botão não tem o que alternar.
    if (!viewer.hasVertexColor) qs('[data-tool="showColors"]', tools)?.remove();
    syncTools();

    on(tools, '[data-tool]', 'click', (_ev, button) => {
      const key = button.dataset.tool;
      const before = viewer.options[key];
      viewer.toggleOption(key);
      if (key === 'wireframe' && !before && !viewer.options.wireframe) {
        toast('Malha muito densa para exibir o arame.', { type: 'warn', timeout: 3000 });
      }
      syncTools();
    });
    on(tools, '[data-angle]', 'click', (_ev, button) => {
      viewer.options.autoRotate = false;
      viewer.setAngle(button.dataset.angle);
      syncTools();
    });
    on(tools, '[data-action="reset"]', 'click', () => viewer.resetView());

    renderProduction(geometry, model, container);
  } catch (error) {
    fail(error?.message || 'Não foi possível exibir este modelo.');
  }

  return () => viewer?.dispose();
}
