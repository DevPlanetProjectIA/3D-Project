/* Configurações: aparência, token do GitHub e informações do repositório. */

import CONFIG from '../../../config.js';
import * as auth from '../auth.js';
import * as gh from '../github.js';
import * as catalog from '../catalog.js';
import { esc, icon, qs, toast, setBusy, confirmDialog, copyText } from '../util.js';

const TOKEN_HELP = `
  <ol class="stack stack--sm small faint" style="padding-left:18px;list-style:decimal">
    <li>Abra <a href="${gh.links.newToken()}" target="_blank" rel="noopener">Fine-grained personal access tokens</a> no GitHub.</li>
    <li>Em <em>Repository access</em>, escolha somente
      <span class="mono">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</span>.</li>
    <li>Em <em>Permissions → Repository permissions</em>, marque
      <strong>Contents: Read and write</strong>.</li>
    <li>Defina uma validade curta, gere o token e cole no campo acima.</li>
  </ol>`;

export default async function settingsView(container, ctx) {
  const user = auth.currentUser();
  const theme = ctx.getTheme();

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Configurações</h1>
        <p>Preferências locais, credenciais de escrita e dados do repositório.</p>
      </div>
    </div>

    <div class="settings stack">
      <div class="panel">
        <div class="panel__head">${icon('sun', 14)} Aparência</div>
        <div class="panel__body">
          <div class="inline">
            <div class="segmented" id="theme">
              <button type="button" data-theme="dark" class="${theme === 'dark' ? 'is-active' : ''}">
                ${icon('moon', 15)} Escuro</button>
              <button type="button" data-theme="light" class="${theme === 'light' ? 'is-active' : ''}">
                ${icon('sun', 15)} Claro</button>
              <button type="button" data-theme="auto" class="${theme === 'auto' ? 'is-active' : ''}">
                Sistema</button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('key', 14)} Token do GitHub</div>
        <div class="panel__body">
          <p class="small faint">
            A leitura da biblioteca é pública e não exige token. Ele é necessário apenas para
            <strong>publicar</strong> ou <strong>remover</strong> modelos, porque essas ações criam
            commits no repositório.
          </p>
          <div class="banner banner--warn">${icon('shield', 18)}
            <div class="small">O token fica no <span class="mono">localStorage</span> deste navegador e
            só é enviado para <span class="mono">api.github.com</span>. Em computador compartilhado,
            remova-o ao terminar e prefira validade curta.</div>
          </div>

          <form class="form" id="form-token" novalidate>
            <div class="field">
              <label for="token">Token pessoal</label>
              <input class="input mono" type="password" id="token" autocomplete="off"
                     spellcheck="false" placeholder="github_pat_… ou ghp_…"
                     value="${esc(auth.getToken())}">
              <p class="field__hint">Escopo mínimo: <span class="mono">Contents: Read and write</span>
                no repositório <span class="mono">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</span>.</p>
            </div>
            <div class="btn-row">
              <button class="btn btn--primary" type="submit">${icon('check', 16)} Validar e salvar</button>
              <button class="btn" type="button" id="clear-token">${icon('trash', 16)} Remover</button>
            </div>
          </form>

          <div id="token-status"></div>
          <details>
            <summary class="small" style="cursor:pointer">Como gerar o token</summary>
            ${TOKEN_HELP}
          </details>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('github', 14)} Repositório</div>
        <div class="panel__body">
          <dl class="dl">
            <div class="dl__row"><dt>Repositório</dt>
              <dd class="mono">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</dd></div>
            <div class="dl__row"><dt>Branch</dt><dd class="mono">${esc(CONFIG.branch)}</dd></div>
            <div class="dl__row"><dt>Catálogo</dt><dd class="mono">${esc(CONFIG.paths.catalog)}</dd></div>
            <div class="dl__row"><dt>Arquivos</dt><dd class="mono">${esc(CONFIG.paths.models)}/</dd></div>
            <div class="dl__row"><dt>Modelos no catálogo</dt><dd id="count">—</dd></div>
          </dl>
          <div class="btn-row">
            <a class="btn btn--sm" href="${gh.links.repo()}" target="_blank" rel="noopener">
              ${icon('external', 15)} Abrir no GitHub</a>
            <a class="btn btn--sm" href="${gh.links.commits()}" target="_blank" rel="noopener">
              ${icon('clock', 15)} Histórico</a>
            <button class="btn btn--sm" type="button" id="copy-url">${icon('copy', 15)} Copiar URL do site</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">${icon('info', 14)} Como o sistema funciona</div>
        <div class="panel__body">
          <p class="small faint">
            Site estático servido pelo GitHub Pages, sem backend. Os arquivos
            <span class="mono">.stl</span> e <span class="mono">.3mf</span> ficam versionados em
            <span class="mono">${esc(CONFIG.paths.models)}/</span> e o índice em
            <span class="mono">${esc(CONFIG.paths.catalog)}</span>. A leitura é feita direto pelo site;
            a escrita usa a API de conteúdo do GitHub com o seu token. As contas e os favoritos vivem
            no navegador — o conteúdo do repositório é público.
          </p>
        </div>
      </div>

      ${user ? `
      <div class="panel">
        <div class="panel__head">${icon('logout', 14)} Sessão</div>
        <div class="panel__body">
          <p class="small faint">Conectado como <strong>${esc(user.username)}</strong>.</p>
          <button class="btn" type="button" id="signout">${icon('logout', 16)} Sair</button>
        </div>
      </div>` : ''}
    </div>`;

  /* Tema */
  qs('#theme', container).addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme]');
    if (!button) return;
    ctx.setTheme(button.dataset.theme);
    qs('#theme', container).querySelectorAll('button')
      .forEach((b) => b.classList.toggle('is-active', b === button));
  });

  /* Token */
  const statusSlot = qs('#token-status', container);

  const renderStatus = (kind, html) => {
    statusSlot.innerHTML = html
      ? `<div class="banner banner--${kind}">${icon(kind === 'danger' ? 'alert' : 'checkCircle', 18)}<div class="small">${html}</div></div>`
      : '';
  };

  qs('#form-token', container).addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = qs('button[type="submit"]', event.currentTarget);
    const value = qs('#token', container).value.trim();
    if (!value) {
      auth.clearToken();
      renderStatus('danger', 'Nenhum token configurado: publicar e remover ficam indisponíveis.');
      return;
    }
    setBusy(submit, true);
    renderStatus('', '');
    try {
      const info = await gh.verifyToken(value);
      if (!info.repoFound) {
        renderStatus('danger', `Token válido para <strong>${esc(info.login)}</strong>, mas o repositório
          <span class="mono">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</span> não foi encontrado com ele.
          Confira o acesso concedido ao token.`);
        return;
      }
      if (!info.canWrite) {
        renderStatus('danger', `Token de <strong>${esc(info.login)}</strong> sem permissão de escrita neste
          repositório. Marque <span class="mono">Contents: Read and write</span>.`);
        return;
      }
      auth.setToken(value);
      renderStatus('info', `Token válido para <strong>${esc(info.login)}</strong> com permissão de escrita em
        <span class="mono">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</span>.`);
      toast('Token salvo. Você já pode publicar modelos.', { type: 'success' });
      ctx.refreshShell();
    } catch (error) {
      renderStatus('danger', esc(error?.message || 'Falha ao validar o token.'));
    } finally {
      setBusy(submit, false);
    }
  });

  qs('#clear-token', container).addEventListener('click', async () => {
    if (!auth.hasToken()) return;
    const confirmed = await confirmDialog({
      title: 'Remover token',
      message: 'O token será apagado deste navegador. Publicar e remover modelos deixarão de funcionar até configurar outro.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!confirmed) return;
    auth.clearToken();
    qs('#token', container).value = '';
    renderStatus('', '');
    ctx.refreshShell();
    toast('Token removido.', { type: 'info' });
  });

  qs('#copy-url', container).addEventListener('click', async () => {
    const ok = await copyText(catalog.BASE);
    toast(ok ? 'URL copiada.' : 'Não foi possível copiar.', { type: ok ? 'success' : 'error', timeout: 2200 });
  });

  qs('#signout', container)?.addEventListener('click', () => {
    auth.signOut();
    ctx.navigate('/entrar');
  });

  catalog.load().then(({ models }) => {
    const slot = qs('#count', container);
    if (slot) slot.textContent = String(models.length);
  });

  if (auth.hasToken()) {
    renderStatus('info', 'Um token está configurado neste navegador. Valide novamente se as permissões mudaram.');
  }
}
