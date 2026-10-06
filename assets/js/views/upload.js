/* Envio de modelo: leitura local, pré-visualização, metadados e publicação. */

import CONFIG from '../../../config.js';
import * as catalog from '../catalog.js';
import * as auth from '../auth.js';
import * as gh from '../github.js';
import { parseModel, measure, formatOf } from '../parsers/index.js';
import { Viewer, renderThumbnail } from '../viewer.js';
import { esc, icon, qs, qsa, on, toast, formatBytes, formatNumber, formatMm, setBusy } from '../util.js';

const LICENSES = [
  'CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC0 1.0 (domínio público)',
  'MIT', 'Uso interno', 'Não especificada',
];

const MATERIALS = ['', 'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Resina', 'Nylon'];

const STEPS = [
  ['file', 'Enviando arquivo do modelo'],
  ['thumb', 'Enviando miniatura'],
  ['catalog', 'Atualizando catálogo'],
];

function tokenBanner() {
  return `
    <div class="banner banner--warn">${icon('key', 18)}
      <div>
        <strong>Token do GitHub necessário</strong>
        <div class="small">Publicar grava arquivos no repositório
          <span class="mono">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</span>, e isso exige um token pessoal
          com permissão de escrita em conteúdo.</div>
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

    ${auth.hasToken() ? '' : tokenBanner()}

    <div class="upload">
      <div class="stack">
        <div class="dropzone" id="dropzone" tabindex="0" role="button"
             aria-label="Selecionar arquivo de modelo">
          ${icon('upload', 32)}
          <strong>Arraste um arquivo ou clique para escolher</strong>
          <small>.stl ou .3mf — até ${formatBytes(CONFIG.upload.maxBytes)}</small>
        </div>
        <input type="file" id="file" accept=".stl,.3mf,model/stl,model/3mf" hidden>

        <div id="preview" hidden>
          <div class="viewer" id="preview-stage"></div>
          <div class="panel" style="margin-top:12px">
            <div class="panel__body">
              <div id="file-pill"></div>
              <dl class="dl" id="measures"></dl>
            </div>
          </div>
        </div>

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

        <div class="grid-2">
          <div class="field">
            <label for="license">Licença</label>
            <select class="select" id="license" name="license">
              ${LICENSES.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="material">Material sugerido</label>
            <select class="select" id="material" name="material">
              ${MATERIALS.map((m) => `<option value="${esc(m)}">${m ? esc(m) : '—'}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="layerHeight">Altura de camada</label>
            <input class="input" type="text" id="layerHeight" name="layerHeight" placeholder="0.2 mm">
          </div>
          <div class="field">
            <label for="infill">Preenchimento</label>
            <input class="input" type="text" id="infill" name="infill" placeholder="20%">
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
      publishButton.disabled = false;
      dropzone.innerHTML = `${icon('refresh', 28)}<strong>Trocar arquivo</strong>
        <small>${esc(file.name)} — ${formatBytes(file.size)}</small>`;
    } catch (error) {
      state.file = null;
      state.geometry = null;
      publishButton.disabled = true;
      preview.hidden = true;
      dropzone.innerHTML = `${icon('upload', 32)}<strong>Arraste um arquivo ou clique para escolher</strong>
        <small>.stl ou .3mf — até ${formatBytes(CONFIG.upload.maxBytes)}</small>`;
      setFormError(error?.message || 'Não foi possível interpretar o arquivo.');
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
    if (!auth.hasToken()) {
      setFormError('Configure um token do GitHub em Configurações antes de publicar.');
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
        license: qs('#license', container).value,
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

  renderTags();
  return () => viewer?.dispose();
}
