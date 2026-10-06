/* Configurações: aparência, token do GitHub e informações do repositório. */

import CONFIG from '../../../config.js';
import * as auth from '../auth.js';
import * as gh from '../github.js';
import * as catalog from '../catalog.js';
import * as sb from '../supabase.js';
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

/**
 * Estado das contas e da sincronização.
 *
 * Em modo local, explica a limitação de frente: a conta não existe em outro
 * computador. Em modo nuvem, mostra a saúde do projeto — a causa mais comum de
 * falha é o schema não ter sido aplicado, e vale dizer isso em vez de deixar a
 * pessoa adivinhar.
 */
async function renderCloudPanel(container) {
  const slot = qs('#cloud-panel', container);
  if (!slot) return;

  if (!auth.isCloud()) {
    slot.innerHTML = `
      <div class="banner banner--warn" style="margin:0">${icon('alert', 18)}
        <div>
          <strong>Modo local: a conta vale só neste navegador</strong>
          <div class="small">Não há servidor para validar credenciais, então a mesma conta
            não abre em outro computador, e o estoque também fica preso aqui.</div>
        </div>
      </div>
      <dl class="dl">
        <div class="dl__row"><dt>Contas</dt><dd>${listUsersCount()} neste navegador</dd></div>
        <div class="dl__row"><dt>Senhas</dt><dd>PBKDF2-SHA256, nunca em texto claro</dd></div>
      </dl>
      ${connectFormMarkup()}`;
    wireConnectForm(container);
    return;
  }

  const user = auth.currentUser();
  slot.innerHTML = `
    <dl class="dl">
      <div class="dl__row"><dt>Modo</dt><dd>Supabase (nuvem)</dd></div>
      ${user ? `
        <div class="dl__row"><dt>Conta</dt><dd>${esc(user.email || user.username)}</dd></div>
        <div class="dl__row"><dt>Entrou por</dt>
          <dd>${user.provider === 'google' ? 'Google' : 'e-mail e senha'}</dd></div>` : `
        <div class="dl__row"><dt>Sessão</dt><dd>nenhuma</dd></div>`}
      <div class="dl__row"><dt>Projeto</dt>
        <dd class="mono small break-all">${esc(projectRef())}</dd></div>
      <div class="dl__row"><dt>Credenciais</dt>
        <dd>${sb.credentialSource() === 'config'
          ? 'config.js (valem para todos)'
          : 'salvas neste navegador'}</dd></div>
      <div class="dl__row"><dt>Estado</dt><dd id="cloud-health">verificando…</dd></div>
      <div class="dl__row"><dt>Pendentes de envio</dt><dd id="cloud-pending">—</dd></div>
    </dl>
    <div id="cloud-alert"></div>
    <div class="btn-row">
      <button class="btn btn--sm" type="button" id="cloud-recheck">${icon('refresh', 15)} Reverificar</button>
      <button class="btn btn--sm" type="button" id="cloud-sync">${icon('upload', 15)} Sincronizar agora</button>
      ${sb.credentialSource() === 'navegador'
        ? `<button class="btn btn--sm btn--danger" type="button" id="cloud-forget">
             ${icon('trash', 15)} Desconectar projeto</button>`
        : ''}
    </div>

    ${sb.credentialSource() === 'navegador' ? `
      <div class="banner banner--info" style="margin:0">${icon('info', 18)}
        <div class="small">Esta conexão está salva <strong>apenas neste navegador</strong>. Para que
          todo computador que abrir o site já venha conectado, os mesmos dois valores precisam estar
          no <span class="mono">config.js</span> do repositório.</div>
      </div>` : ''}`;

  const check = async () => {
    const health = qs('#cloud-health', container);
    const alert = qs('#cloud-alert', container);
    if (health) health.textContent = 'verificando…';
    const result = await sb.healthCheck();

    if (health) {
      health.textContent = !result.reachable ? 'projeto inacessível'
        : !result.schema ? 'schema ausente'
        : 'conectado';
      health.style.color = result.reachable && result.schema ? 'var(--success)' : 'var(--danger)';
    }
    if (alert) {
      alert.innerHTML = result.reachable && result.schema ? '' : `
        <div class="banner banner--danger">${icon('alert', 18)}
          <div class="small">${esc(result.error || 'Falha ao consultar o projeto.')}
            ${!result.schema && result.reachable
              ? ' Rode <span class="mono">supabase/schema.sql</span> no editor SQL do projeto.'
              : ''}</div>
        </div>`;
    }
    await updatePending(container);
  };

  qs('#cloud-recheck', container)?.addEventListener('click', check);

  qs('#cloud-forget', container)?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Desconectar projeto',
      message: 'Este navegador volta ao modo local. A conta e os dados continuam no Supabase; só esta máquina para de usá-los.',
      confirmLabel: 'Desconectar',
      danger: true,
    });
    if (!confirmed) return;
    auth.signOut();
    sb.setConnection(null);
    location.reload();
  });
  qs('#cloud-sync', container)?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try {
      const inventory = await import('../inventory.js');
      const costing = await import('../costing.js');
      await Promise.allSettled([
        inventory.flush?.(),
        inventory.hydrate?.(),
        costing.hydrateSettings?.(),
      ]);
      await updatePending(container);
      toast('Sincronização concluída.', { type: 'success', timeout: 2400 });
    } catch (error) {
      toast(error?.message || 'Falha ao sincronizar.', { type: 'error' });
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  check();
}

/**
 * Formulário de conexão.
 *
 * Existe para que dar o primeiro passo não exija editar o repositório: cola-se
 * a URL e a chave pública, o site testa contra o projeto de verdade e só então
 * salva. É o caminho para testar antes de tornar a conexão oficial no
 * `config.js`.
 */
function connectFormMarkup() {
  return `
    <form class="form" id="connect-form" novalidate style="border-top:1px solid var(--border);padding-top:16px">
      <div>
        <strong class="small">Conectar um projeto do Supabase</strong>
        <p class="small faint">Os dois valores estão no painel do projeto, no botão
          <strong>Connect</strong> ou em <strong>Settings → API Keys</strong>. O passo a passo
          completo está em <span class="mono">docs/SUPABASE.md</span>.</p>
      </div>
      <div class="field" data-field="url">
        <label for="sb-url">Project URL</label>
        <input class="input mono" type="url" id="sb-url" placeholder="https://seu-projeto.supabase.co"
               autocomplete="off" spellcheck="false">
        <p class="field__error" hidden></p>
      </div>
      <div class="field" data-field="key">
        <label for="sb-key">Chave pública (anon / publishable)</label>
        <textarea class="textarea mono" id="sb-key" rows="3" placeholder="eyJhbGciOi..."
                  autocomplete="off" spellcheck="false" style="min-height:70px;font-size:11px"></textarea>
        <p class="field__hint">Nunca use a chave <span class="mono">service_role</span>: ela ignora
          todas as políticas de segurança do banco.</p>
        <p class="field__error" hidden></p>
      </div>
      <div id="connect-result"></div>
      <div class="btn-row">
        <button class="btn btn--primary" type="submit">${icon('shield', 16)} Testar e conectar</button>
      </div>
    </form>`;
}

function wireConnectForm(container) {
  const form = qs('#connect-form', container);
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = qs('button[type="submit"]', form);
    const result = qs('#connect-result', form);
    const url = qs('#sb-url', form).value;
    const key = qs('#sb-key', form).value;

    setBusy(submit, true);
    result.innerHTML = '';
    try {
      const test = await sb.testConnection({ url, anonKey: key });
      if (!test.ok) {
        result.innerHTML = `<div class="banner banner--danger" style="margin:0">${icon('alert', 18)}
          <div class="small">${esc(test.error)}</div></div>`;
        return;
      }
      sb.setConnection({ url, anonKey: key });
      result.innerHTML = `<div class="banner banner--info" style="margin:0">${icon('checkCircle', 18)}
        <div class="small">Projeto <strong>${esc(test.projectRef)}</strong> conectado.
          Recarregando…</div></div>`;
      toast('Projeto conectado. O login agora é do Supabase.', { type: 'success' });
      setTimeout(() => location.reload(), 900);
    } finally {
      setBusy(submit, false);
    }
  });
}

async function updatePending(container) {
  const slot = qs('#cloud-pending', container);
  if (!slot) return;
  try {
    const inventory = await import('../inventory.js');
    const count = inventory.pendingCount?.() ?? 0;
    slot.textContent = count ? `${count} operação(ões)` : 'nenhuma';
    slot.style.color = count ? 'var(--warning)' : '';
  } catch {
    slot.textContent = '—';
  }
}

const listUsersCount = () => auth.listUsers().length;

/** Referência do projeto, extraída da URL — é o que identifica no painel. */
function projectRef() {
  try {
    return new URL(CONFIG.supabase.url).hostname;
  } catch {
    return CONFIG.supabase.url || '—';
  }
}

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
        <div class="panel__head">${icon('shield', 14)} Contas e sincronização</div>
        <div class="panel__body" id="cloud-panel">
          <p class="small faint">Carregando estado…</p>
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

  renderCloudPanel(container);

  catalog.load().then(({ models }) => {
    const slot = qs('#count', container);
    if (slot) slot.textContent = String(models.length);
  });

  if (auth.hasToken()) {
    renderStatus('info', 'Um token está configurado neste navegador. Valide novamente se as permissões mudaram.');
  }
}
