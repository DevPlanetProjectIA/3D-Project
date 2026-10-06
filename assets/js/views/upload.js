/* Envio de modelo: leitura local, pré-visualização, metadados e publicação. */

import CONFIG from '../../../config.js';
import * as catalog from '../catalog.js';
import * as auth from '../auth.js';
import * as gh from '../github.js';
import { parseModel, measure, formatOf } from '../parsers/index.js';
import { Viewer, renderThumbnail } from '../viewer.js';
import { analyze, toCatalogFields } from '../production.js';
import { parseSlicedFile, isSlicedFilename } from '../parsers/gcode.js';
import { printersByBrand, getPrinter, printerLabel, exceedsBed } from '../printers.js';
import { MATERIALS } from '../filaments.js';
import { filaments as stockFilaments } from '../inventory.js';
import { formatMoney, formatHours, getSettings } from '../costing.js';
import { esc, icon, qs, qsa, on, toast, formatBytes, formatNumber, formatMm, setBusy } from '../util.js';

const STEPS = [
  ['file', 'Enviando arquivo do modelo'],
  ['thumb', 'Enviando miniatura'],
  ['catalog', 'Atualizando catálogo'],
];

/** Aviso de como a publicação vai (ou não vai) acontecer. */
function writeBanner() {
  const mode = catalog.publishMode() === 'storage' ? 'storage' : gh.writeMode();

  if (mode === 'storage') {
    return `
      <div class="banner banner--info">${icon('shield', 18)}
        <div class="small">Publicação no acervo do Supabase: sem token, sem espera. O arquivo vai
          direto do seu navegador para o projeto, na sua conta.</div>
      </div>`;
  }
  if (mode === 'funcao') {
    return `
      <div class="banner banner--info">${icon('shield', 18)}
        <div class="small">Publicação pela função do servidor: o token do GitHub não passa por este
          navegador. O commit registra o seu e-mail como autor da publicação.</div>
      </div>`;
  }
  if (mode === 'token') return '';

  return `
    <div class="banner banner--warn">${icon('key', 18)}
      <div>
        <strong>Falta uma credencial para publicar</strong>
        <div class="small">Gravar em <span class="mono">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</span>
          exige a função de publicação implantada no Supabase — e aí ninguém precisa de token — ou um
          token pessoal do GitHub neste navegador.</div>
      </div>
      <div class="banner__actions">
        <a class="btn btn--sm btn--primary" href="#/config">${icon('settings', 15)} Configurar</a>
      </div>
    </div>`;
}

export default async function uploadView(container, ctx) {
  const user = auth.currentUser();
  if (!user) {
    container.innerHTML = `
      <div class="empty">${icon('login', 40)}
        <h3>Entre para enviar modelos</h3>
        <p>Visitantes podem navegar e baixar, mas o envio exige uma conta.</p>
        <a class="btn btn--primary" href="#/entrar">${icon('login', 17)} Entrar</a>
      </div>`;
    return;
  }

  const state = {
    file: null,
    bytes: null,
    geometry: null,
    metrics: null,
    tags: [],
    thumb: null,
    /** Fatiamento medido, quando um G-code é enviado junto. */
    slice: null,
    sliceName: '',
  };
  let viewer = null;

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Enviar modelo</h1>
        <p>O arquivo é lido no navegador, pré-visualizado e então gravado no repositório.</p>
      </div>
      <a class="btn" href="#/biblioteca">${icon('library', 17)} Biblioteca</a>
    </div>

    ${writeBanner()}

    <div class="upload">
      <div class="stack">
        <div class="dropzone" id="dropzone" tabindex="0" role="button"
             aria-label="Selecionar arquivo de modelo">
          ${icon('upload', 32)}
          <strong>Arraste um arquivo ou clique para escolher</strong>
          <small>.stl ou .3mf — até ${formatBytes(CONFIG.upload.maxBytes)}</small>
          <small class="faint">G-code cai automaticamente em “Dados do fatiamento”.</small>
        </div>
        <input type="file" id="file" accept=".stl,.3mf,.gcode,.gco,.g,model/stl,model/3mf" hidden>

        <div class="panel" id="sliced-panel">
          <div class="panel__head">${icon('layers', 14)} Dados do fatiamento
            <span class="toolbar__spacer"></span>
            <span class="chip chip--static">opcional</span>
          </div>
          <div class="panel__body">
            <p class="small faint">Envie também o <strong>G-code fatiado</strong> e o peso, o tempo
              e a purga passam a ser os <strong>medidos pelo seu fatiador</strong>, não estimados.
              Aceita <span class="mono">.gcode</span>, <span class="mono">.gcode.3mf</span> e
              projeto já fatiado. O arquivo só é lido aqui — não vai para o repositório.</p>
            <input type="file" id="sliced-file" accept=".gcode,.gco,.g,.3mf" hidden>
            <div class="btn-row">
              <button class="btn btn--sm" type="button" id="pick-sliced">
                ${icon('upload', 15)} Escolher G-code
              </button>
              <button class="btn btn--sm" type="button" id="clear-sliced" hidden>
                ${icon('x', 15)} Remover
              </button>
            </div>
            <div id="sliced-status"></div>
          </div>
        </div>

        <div id="preview" hidden>
          <div class="viewer" id="preview-stage"></div>
          <div class="panel" style="margin-top:12px">
            <div class="panel__body">
              <div id="file-pill"></div>
              <dl class="dl" id="measures"></dl>
            </div>
          </div>
        </div>

        <div id="production"></div>

        <div class="panel" id="progress-panel" hidden>
          <div class="panel__head">${icon('github', 14)} Publicação</div>
          <div class="panel__body">
            <div class="steps" id="steps">
              ${STEPS.map(([key, label], i) => `
                <div class="step" data-step="${key}">
                  <span class="step__dot">${i + 1}</span><span>${esc(label)}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <form class="form" id="meta" novalidate>
        <div class="field" data-field="name">
          <label for="name">Nome do modelo</label>
          <input class="input" type="text" id="name" name="name" maxlength="90" required
                 placeholder="ex.: Suporte de bancada para chave Allen">
          <p class="field__error" hidden></p>
        </div>

        <div class="field">
          <label for="description">Descrição</label>
          <textarea class="textarea" id="description" name="description" maxlength="2000"
                    placeholder="Para que serve, como montar, tolerâncias, variações…"></textarea>
        </div>

        <div class="field">
          <label for="tag-text">Etiquetas</label>
          <div class="tag-input" id="tag-input">
            <input type="text" id="tag-text" placeholder="Enter para adicionar" aria-label="Nova etiqueta">
          </div>
          <p class="field__hint">Até 10 etiquetas. Elas alimentam a busca e os filtros.</p>
        </div>

        <div class="field">
          <label for="printer">Ajustado para</label>
          <select class="select" id="printer" name="printer">
            <option value="">Nenhuma impressora específica</option>
            ${printersByBrand().map(([brand, list]) => `
              <optgroup label="${esc(brand)}">
                ${list.map((p) => `<option value="${esc(p.id)}">${esc(p.brand)} ${esc(p.model)} — ${p.bed[0]}×${p.bed[1]}×${p.bed[2]} mm${p.ams ? ` · ${esc(p.ams)}` : ''}</option>`).join('')}
              </optgroup>`).join('')}
          </select>
          <p class="field__hint">A impressora define a potência usada no custo de energia e avisa se a peça não cabe na mesa.</p>
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="material">Material</label>
            <select class="select" id="material" name="material">
              ${MATERIALS.map((m) => `<option value="${esc(m.id)}"${m.id === 'PLA' ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="layerHeight">Altura de camada</label>
            <input class="input" type="text" id="layerHeight" name="layerHeight" placeholder="0.2 mm">
          </div>
          <div class="field">
            <label for="infill">Preenchimento (%)</label>
            <input class="input" type="number" id="infill" name="infill" min="0" max="100" placeholder="20">
            <p class="field__hint">Usado só quando o arquivo não traz o consumo real.</p>
          </div>
          <div class="field">
            <label for="printTime">Tempo de impressão</label>
            <div class="inline">
              <input class="input" type="number" id="printHours" min="0" placeholder="h" style="width:72px">
              <input class="input" type="number" id="printMinutes" min="0" max="59" placeholder="min" style="width:80px">
            </div>
          </div>
        </div>

        <label class="check">
          <input type="checkbox" id="supports" name="supports">
          <span>Requer suportes</span>
        </label>

        <div class="field">
          <label for="notes">Observações de impressão</label>
          <textarea class="textarea" id="notes" name="notes" maxlength="600"
                    placeholder="Orientação da peça, velocidade, pós-processamento…"></textarea>
        </div>

        <label class="check">
          <input type="checkbox" id="makeThumb" checked>
          <span>Gerar miniatura a partir da pré-visualização</span>
        </label>

        <p class="field__error" data-form-error hidden></p>

        <button class="btn btn--primary btn--lg btn--block" type="submit" id="publish" disabled>
          ${icon('upload', 18)} Publicar no repositório
        </button>
        <p class="small faint center">
          Publicar cria commits em <span class="mono">${esc(CONFIG.branch)}</span>. O GitHub Pages
          republica o site em até cerca de um minuto.
        </p>
      </form>
    </div>`;

  /* ---------- Etiquetas ---------- */

  const tagInput = qs('#tag-input', container);
  const tagText = qs('#tag-text', container);

  function renderTags() {
    qsa('.chip', tagInput).forEach((chip) => chip.remove());
    state.tags.forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${esc(tag)}<button type="button" data-remove-tag="${esc(tag)}" aria-label="Remover ${esc(tag)}">${icon('x', 11)}</button>`;
      tagInput.insertBefore(chip, tagText);
    });
  }

  function addTag(raw) {
    const value = String(raw || '').trim().replace(/^#/, '').slice(0, 28);
    if (!value || state.tags.includes(value) || state.tags.length >= 10) return;
    state.tags.push(value);
    renderTags();
  }

  tagText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(tagText.value);
      tagText.value = '';
    } else if (event.key === 'Backspace' && !tagText.value && state.tags.length) {
      state.tags.pop();
      renderTags();
    }
  });
  tagText.addEventListener('blur', () => { addTag(tagText.value); tagText.value = ''; });
  on(tagInput, '[data-remove-tag]', 'click', (_ev, button) => {
    state.tags = state.tags.filter((t) => t !== button.dataset.removeTag);
    renderTags();
  });

  /* ---------- Seleção de arquivo ---------- */

  const dropzone = qs('#dropzone', container);
  const fileInput = qs('#file', container);
  const preview = qs('#preview', container);
  const publishButton = qs('#publish', container);
  const nameInput = qs('#name', container);
  const formError = qs('[data-form-error]', container);

  const setFormError = (message) => {
    formError.textContent = message || '';
    formError.hidden = !message;
  };

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, () => dropzone.classList.remove('is-over')));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
  });

  async function handleFile(file) {
    setFormError('');

    // Arquivo fatiado no campo do modelo: em vez de recusar, encaminha para o
    // campo certo. Saber em qual caixa cada arquivo vai é problema da interface.
    if (isSlicedFilename(file.name)) {
      await adoptSlicedFile(file, 'pelo nome do arquivo');
      return;
    }

    const format = formatOf(file.name);
    if (!format) {
      setFormError('Extensão não suportada. Envie um arquivo .stl ou .3mf.');
      return;
    }
    if (file.size > CONFIG.upload.maxBytes) {
      setFormError(`Arquivo de ${formatBytes(file.size)} excede o limite de ${formatBytes(CONFIG.upload.maxBytes)}.`);
      return;
    }

    dropzone.innerHTML = `${icon('refresh', 28)}<strong>Lendo ${esc(file.name)}…</strong>`;
    try {
      const buffer = await file.arrayBuffer();
      const geometry = await parseModel(buffer, format);
      const metrics = measure(geometry);

      state.file = file;
      state.bytes = new Uint8Array(buffer);
      state.geometry = geometry;
      state.metrics = metrics;
      // O formato vem do conteúdo, não da extensão: arquivos renomeados são
      // publicados com a extensão correta.
      state.format = geometry.format;

      if (!nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.(stl|3mf)$/i, '').replace(/[_-]+/g, ' ').trim();
      }

      renderPreview();
      renderProduction();
      publishButton.disabled = false;
      dropzone.innerHTML = `${icon('refresh', 28)}<strong>Trocar arquivo</strong>
        <small>${esc(file.name)} — ${formatBytes(file.size)}</small>`;
    } catch (error) {
      resetDropzone();

      // O parser reconheceu um G-code ou um 3MF fatiado: aproveita o arquivo.
      if (error?.isSlicedFile) {
        await adoptSlicedFile(file, 'pelo conteúdo');
        return;
      }

      setFormError(error?.message || 'Não foi possível interpretar o arquivo.');
    }
  }

  function resetDropzone() {
    state.file = null;
    state.geometry = null;
    publishButton.disabled = true;
    preview.hidden = true;
    dropzone.innerHTML = `${icon('upload', 32)}<strong>Arraste um arquivo ou clique para escolher</strong>
      <small>.stl ou .3mf — até ${formatBytes(CONFIG.upload.maxBytes)}</small>`;
  }

  /** Aceita um arquivo fatiado que chegou pelo campo do modelo. */
  async function adoptSlicedFile(file, motivo) {
    resetDropzone();
    try {
      const slice = await parseSlicedFile(file);
      if (!slice.sliced) {
        throw new Error('O arquivo não traz consumo nem tempo declarados.');
      }
      state.slice = slice;
      state.sliceName = file.name;
      renderSlicedStatus();
      renderProduction();
      setFormError('');
      qs('#sliced-panel', container)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(
        `${file.name} é um arquivo fatiado (reconhecido ${motivo}) e foi usado como dados de `
        + `fatiamento: ${slice.grams.toFixed(1)} g medidos. Envie também o modelo .stl ou .3mf `
        + 'para a biblioteca.',
        { type: 'info', title: 'Arquivo no campo certo', timeout: 9000 },
      );
    } catch (error) {
      setFormError(
        `${file.name} parece ser um arquivo fatiado, mas não foi possível aproveitá-lo: `
        + `${error?.message || 'formato não reconhecido'}`,
      );
    }
  }

  function renderPreview() {
    preview.hidden = false;
    qs('#file-pill', container).innerHTML = `
      <div class="file-pill">
        <span class="file-pill__ico">${icon('file', 18)}</span>
        <span class="file-pill__main">
          <strong>${esc(state.file.name)}</strong>
          <small>${esc(state.format.toUpperCase())} · ${formatBytes(state.file.size)}</small>
        </span>
      </div>`;

    const { size } = state.metrics;
    qs('#measures', container).innerHTML = `
      <div class="dl__row"><dt>Triângulos</dt><dd>${formatNumber(state.geometry.triangles)}</dd></div>
      <div class="dl__row"><dt>Largura (X)</dt><dd class="mono">${formatMm(size.x)}</dd></div>
      <div class="dl__row"><dt>Profundidade (Y)</dt><dd class="mono">${formatMm(size.y)}</dd></div>
      <div class="dl__row"><dt>Altura (Z)</dt><dd class="mono">${formatMm(size.z)}</dd></div>`;

    // Canvas novo a cada arquivo: um contexto WebGL não pode ser recriado
    // no mesmo elemento depois de descartado.
    viewer?.dispose();
    viewer = null;
    const stage = qs('#preview-stage', container);
    stage.innerHTML = '<canvas></canvas>';
    try {
      viewer = new Viewer(qs('canvas', stage), { autoRotate: true });
      viewer.setGeometry(state.geometry);
    } catch {
      viewer = null;
      stage.innerHTML = `<div class="viewer__overlay">${icon('alert', 24)}
        <span>WebGL indisponível neste navegador: a pré-visualização foi desativada.
        O envio continua funcionando.</span></div>`;
    }
  }

  /* ---------- Produção e custo ---------- */

  const productionSlot = qs('#production', container);

  /** Linha de filamento: o que o arquivo pede × o que existe no estoque. */
  function usageRow(row) {
    const swatch = row.color
      ? `<i style="display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid var(--border);background:${esc(row.color)}"></i>`
      : icon('palette', 14);

    const stock = row.filament
      ? `<span class="small">${esc(row.filament.name)}${row.exactMaterial ? '' : ` <span class="chip chip--static" style="color:var(--warning)">material difere</span>`}</span>`
      : `<span class="small" style="color:var(--danger)">sem filamento no estoque</span>`;

    return `
      <div class="row" style="align-items:flex-start">
        <span class="row__thumb" style="width:34px;height:34px;display:grid;place-items:center;background:none">${swatch}</span>
        <span class="row__main">
          <span class="row__title">${esc(row.material)}${row.colorLabel ? ` · ${esc(row.colorLabel)}` : ''}</span>
          <span class="row__sub">${row.grams.toFixed(1)} g${row.meters ? ` · ${row.meters.toFixed(2)} m` : ''} · ${stock}</span>
          ${row.shortage > 0 ? `<span class="row__sub" style="color:var(--warning)">faltam ${row.shortage.toFixed(0)} g no estoque</span>` : ''}
        </span>
        <span class="nowrap mono small">${row.cost > 0 ? esc(formatMoney(row.cost)) : '—'}</span>
      </div>`;
  }

  function renderProduction() {
    if (!state.geometry) { productionSlot.innerHTML = ''; return; }

    const printerId = qs('#printer', container)?.value || '';
    const analysis = analyze(state.geometry, {
      printerId,
      material: qs('#material', container)?.value,
      infillPercent: qs('#infill', container)?.value,
      hours: qs('#printHours', container)?.value,
      minutes: qs('#printMinutes', container)?.value,
      slice: state.slice,
    });
    state.analysis = analysis;

    const { cost, blockers } = analysis;
    const measured = analysis.measured;
    const printer = getPrinter(printerId);
    const tooBig = printer && exceedsBed(printer, analysis.metrics.size);

    const avisos = [];
    if (blockers.noFilamentRegistered) {
      avisos.push(`
        <div class="banner banner--warn">${icon('alert', 18)}
          <div><strong>Nenhum filamento cadastrado</strong>
            <div class="small">Sem filamento no estoque não há preço por grama, e o custo de fabricação
              fica zerado. Cadastre o filamento que você usa para este modelo.</div></div>
          <div class="banner__actions"><a class="btn btn--sm btn--primary" href="#/estoque">
            ${icon('package', 15)} Cadastrar</a></div>
        </div>`);
    } else if (blockers.missing.length) {
      avisos.push(`
        <div class="banner banner--warn">${icon('alert', 18)}
          <div class="small">${blockers.missing.length} filamento(s) do arquivo não têm equivalente no
            estoque. O custo abaixo cobre apenas os que foram encontrados.</div>
          <div class="banner__actions"><a class="btn btn--sm" href="#/estoque">Abrir estoque</a></div>
        </div>`);
    }
    if (blockers.shortages.length) {
      avisos.push(`
        <div class="banner banner--warn">${icon('alert', 18)}
          <div class="small">Saldo insuficiente em
            ${esc(blockers.shortages.map((r) => r.filament.name).join(', '))}.</div>
        </div>`);
    }
    if (tooBig) {
      avisos.push(`
        <div class="banner banner--danger">${icon('alert', 18)}
          <div class="small">A peça (${analysis.metrics.size.x.toFixed(0)}×${analysis.metrics.size.y.toFixed(0)}×${analysis.metrics.size.z.toFixed(0)} mm)
            não cabe na mesa da ${esc(printerLabel(printer))}
            (${printer.bed.join('×')} mm).</div>
        </div>`);
    }
    if (!measured) {
      avisos.push(`
        <div class="banner banner--info">${icon('info', 18)}
          <div>
            <strong>Peso estimado</strong>, não medido
            <div class="small">Calculado pela geometria: ${analysis.volumeCm3.toFixed(1)} cm³ de
              volume, casca de ${analysis.shellCm3.toFixed(1)} cm³ e núcleo a
              ${esc(String(analysis.infill))}% — ${Math.round(analysis.solidRatio * 100)}% do volume
              vira material. Serve para ordem de grandeza, não para fechar preço.</div>
            <div class="small" style="margin-top:6px"><strong>Para ter o número exato:</strong>
              fatie no seu slicer, exporte o G-code e envie no campo
              <em>Dados do fatiamento</em> acima.</div>
          </div>
        </div>`);
    }

    productionSlot.innerHTML = `
      ${avisos.join('')}
      <div class="panel">
        <div class="panel__head">${icon('coins', 14)} Produção e custo
          <span class="toolbar__spacer"></span>
          <span class="chip chip--static">${
            analysis.source === 'gcode' ? 'medido no G-code'
            : analysis.source === 'fatiador' ? 'medido pelo fatiador'
            : 'estimado'}</span>
        </div>
        <div class="panel__body">
          <dl class="dl">
            <div class="dl__row"><dt>Filamento nas peças</dt>
              <dd class="mono">${analysis.partsGrams.toFixed(1)} g</dd></div>
            ${analysis.filamentCount > 1 ? `
              <div class="dl__row"><dt>Purga e troca de cor${analysis.purgeEstimated ? ' (estimada)' : ''}</dt>
                <dd class="mono">${analysis.purgeGrams.toFixed(1)} g</dd></div>` : ''}
            <div class="dl__row"><dt><strong>Total de filamento</strong></dt>
              <dd class="mono"><strong>${analysis.totalGrams.toFixed(1)} g</strong></dd></div>
            ${analysis.hours > 0 ? `
              <div class="dl__row"><dt>Tempo de impressão</dt>
                <dd>${esc(formatHours(analysis.hours))}</dd></div>` : ''}
            ${analysis.slicer ? `
              <div class="dl__row"><dt>Fatiado em</dt><dd>${esc(analysis.slicer)}</dd></div>` : ''}
            ${analysis.printerFromFile ? `
              <div class="dl__row"><dt>Perfil no arquivo</dt><dd>${esc(analysis.printerFromFile)}</dd></div>` : ''}
            ${analysis.plateCount > 1 ? `
              <div class="dl__row"><dt>Mesas no projeto</dt><dd>${analysis.plateCount}</dd></div>` : ''}
          </dl>

          ${analysis.usage.length ? `
            <div class="stack stack--sm">
              <p class="small faint">Filamentos ${measured ? 'usados' : 'previstos'} e correspondência no estoque</p>
              ${analysis.usage.map(usageRow).join('')}
            </div>` : ''}

          <dl class="dl" style="border-top:1px solid var(--border);padding-top:12px">
            <div class="dl__row"><dt>Material${analysis.purgeGrams > 0 ? ' + purga' : ''}</dt>
              <dd>${esc(formatMoney(analysis.materialCost))}</dd></div>
            <div class="dl__row"><dt>Energia</dt><dd>${esc(formatMoney(cost.energy))}</dd></div>
            ${cost.machine > 0 ? `<div class="dl__row"><dt>Máquina</dt>
              <dd>${esc(formatMoney(cost.machine))}</dd></div>` : ''}
            <div class="dl__row"><dt>Risco de falha</dt><dd>${esc(formatMoney(cost.risk))}</dd></div>
            <div class="dl__row"><dt><strong>Custo de fabricação</strong></dt>
              <dd><strong>${esc(formatMoney(cost.production))}</strong></dd></div>
            <div class="dl__row"><dt>Preço sugerido (markup ${esc(String(getSettings().markup))}%)</dt>
              <dd style="color:var(--success)"><strong>${esc(formatMoney(cost.price))}</strong></dd></div>
          </dl>

          <div class="btn-row">
            <a class="btn btn--sm" href="#/calculadora">${icon('calculator', 15)} Abrir na calculadora</a>
            <a class="btn btn--sm" href="#/config">${icon('settings', 15)} Ajustar parâmetros</a>
          </div>
        </div>
      </div>`;
  }

  /* ---------- Publicação ---------- */

  const progressPanel = qs('#progress-panel', container);

  function markStep(key, status) {
    const node = qs(`[data-step="${key}"]`, container);
    if (!node) return;
    node.classList.remove('is-active', 'is-done', 'is-error');
    if (status === 'active') node.classList.add('is-active');
    if (status === 'done') { node.classList.add('is-done'); qs('.step__dot', node).innerHTML = icon('check', 12); }
    if (status === 'error') { node.classList.add('is-error'); qs('.step__dot', node).innerHTML = icon('x', 12); }
  }

  qs('#meta', container).addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError('');

    const name = nameInput.value.trim();
    if (!name) { setFormError('Dê um nome ao modelo.'); nameInput.focus(); return; }
    if (!state.geometry) { setFormError('Escolha um arquivo .stl ou .3mf.'); return; }
    if (!catalog.publishMode()) {
      setFormError('Sem destino para publicar: entre na sua conta com o Supabase configurado '
        + '(acervo no Storage), ou cadastre um token do GitHub em Configurações.');
      return;
    }

    setBusy(publishButton, true);
    progressPanel.hidden = false;
    STEPS.forEach(([key]) => markStep(key, ''));

    try {
      let thumbBytes = null;
      if (qs('#makeThumb', container).checked) {
        try {
          thumbBytes = await renderThumbnail(state.geometry, CONFIG.thumbnailSize);
        } catch {
          toast('Não foi possível gerar a miniatura; o modelo será publicado sem ela.', { type: 'warn' });
        }
      }

      const id = catalog.makeId(name);
      const entry = {
        id,
        name,
        description: qs('#description', container).value.trim(),
        format: state.format,
        size: state.file.size,
        tags: state.tags,
        author: user.username,
        triangles: state.geometry.triangles,
        dimensions: {
          x: Number(state.metrics.size.x.toFixed(3)),
          y: Number(state.metrics.size.y.toFixed(3)),
          z: Number(state.metrics.size.z.toFixed(3)),
        },
        print: {
          material: qs('#material', container).value,
          layerHeight: qs('#layerHeight', container).value.trim(),
          infill: qs('#infill', container).value.trim(),
          supports: qs('#supports', container).checked,
          notes: qs('#notes', container).value.trim(),
        },
        ...(state.analysis ? toCatalogFields(state.analysis) : {}),
      };

      await catalog.publish({ entry, fileBytes: state.bytes, thumbBytes }, markStep);

      toast('Modelo publicado. O site é republicado pelo Pages em instantes.',
        { type: 'success', title: name });
      ctx.navigate(`/modelo/${encodeURIComponent(id)}`);
    } catch (error) {
      const detail = error instanceof gh.GitHubError && error.detail ? ` (${error.detail})` : '';
      setFormError(`${error?.message || 'Falha na publicação.'}${detail}`);
      toast(error?.message || 'Falha na publicação.', { type: 'error', title: 'Erro ao publicar' });
    } finally {
      setBusy(publishButton, false);
    }
  });

  /* ---------- Arquivo fatiado ---------- */

  const slicedInput = qs('#sliced-file', container);
  const slicedStatus = qs('#sliced-status', container);
  const clearSliced = qs('#clear-sliced', container);

  function renderSlicedStatus(error) {
    if (error) {
      slicedStatus.innerHTML = `<div class="banner banner--danger" style="margin:8px 0 0">
        ${icon('alert', 18)}<div class="small">${esc(error)}</div></div>`;
      clearSliced.hidden = true;
      return;
    }
    if (!state.slice) { slicedStatus.innerHTML = ''; clearSliced.hidden = true; return; }

    const s = state.slice;
    slicedStatus.innerHTML = `
      <div class="banner banner--info" style="margin:8px 0 0">${icon('checkCircle', 18)}
        <div class="small">
          <strong>${esc(state.sliceName)}</strong> lido${s.slicer ? ` (${esc(s.slicer)})` : ''}.
          ${s.grams ? `${s.grams.toFixed(1)} g` : 'sem peso declarado'}${
            s.seconds ? ` · ${esc(formatHours(s.seconds / 3600))}` : ''}${
            s.filaments.length > 1 ? ` · ${s.filaments.length} filamentos` : ''}${
            s.purge?.grams ? ` · purga ${s.purge.grams.toFixed(1)} g` : ''}
        </div>
      </div>`;
    clearSliced.hidden = false;
  }

  qs('#pick-sliced', container).addEventListener('click', () => slicedInput.click());

  slicedInput.addEventListener('change', async () => {
    const file = slicedInput.files?.[0];
    if (!file) return;
    slicedStatus.innerHTML = `<p class="small faint" style="margin-top:8px">Lendo ${esc(file.name)}…</p>`;
    try {
      const slice = await parseSlicedFile(file);
      if (!slice.sliced) {
        throw new Error('O arquivo não traz consumo nem tempo. Confirme que é o G-code gerado após '
          + 'fatiar, e não o projeto apenas salvo.');
      }
      state.slice = slice;
      state.sliceName = file.name;
      renderSlicedStatus();
      renderProduction();
      toast(`Fatiamento lido: ${slice.grams.toFixed(1)} g medidos.`, { type: 'success' });
    } catch (error) {
      state.slice = null;
      state.sliceName = '';
      renderSlicedStatus(error?.message || 'Não foi possível ler o arquivo.');
      renderProduction();
    }
  });

  clearSliced.addEventListener('click', () => {
    state.slice = null;
    state.sliceName = '';
    slicedInput.value = '';
    renderSlicedStatus();
    renderProduction();
  });

  // Arrastar um G-code sobre a área do arquivo também funciona.
  dropzone.addEventListener('drop', async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file && isSlicedFilename(file.name)) {
      event.preventDefault();
      event.stopPropagation();
      slicedInput.files = event.dataTransfer.files;
      slicedInput.dispatchEvent(new Event('change'));
    }
  }, true);

  // Qualquer parâmetro que entre no custo refaz a análise.
  ['#printer', '#material', '#infill', '#printHours', '#printMinutes'].forEach((selector) => {
    const field = qs(selector, container);
    field?.addEventListener('change', renderProduction);
    field?.addEventListener('input', renderProduction);
  });

  // Pré-seleciona a última impressora usada.
  const lastPrinter = ctx.store.get('lastPrinter', '');
  if (lastPrinter) {
    const select = qs('#printer', container);
    if (select && [...select.options].some((o) => o.value === lastPrinter)) select.value = lastPrinter;
  }
  qs('#printer', container)?.addEventListener('change', (event) => {
    ctx.store.set('lastPrinter', event.target.value);
  });

  if (!stockFilaments().length) {
    qs('#meta', container).insertAdjacentHTML('afterbegin', `
      <div class="banner banner--info">${icon('package', 18)}
        <div class="small">Seu estoque de filamentos está vazio. Cadastre ao menos um para que o
          custo de fabricação seja calculado no envio.</div>
        <div class="banner__actions"><a class="btn btn--sm" href="#/estoque">Cadastrar filamento</a></div>
      </div>`);
  }

  renderTags();
  return () => viewer?.dispose();
}
