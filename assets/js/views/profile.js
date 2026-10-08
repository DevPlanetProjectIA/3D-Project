/* Perfil: identidade, estatísticas, bio e troca de senha. */

import * as auth from '../auth.js';
import * as catalog from '../catalog.js';
import {
  esc, icon, qs, qsa, toast, setBusy, formatNumber, formatBytes, formatDate, confirmDialog,
} from '../util.js';
import { initials } from '../util.js';

export default async function profileView(container, ctx) {
  const user = auth.currentUser();
  if (!user) {
    container.innerHTML = `
      <div class="empty">${icon('user', 40)}
        <h3>Nenhuma conta ativa</h3>
        <p>Você está navegando como visitante.</p>
        <a class="btn btn--primary" href="#/entrar">${icon('login', 17)} Entrar</a>
      </div>`;
    return;
  }

  const { models } = await catalog.load();
  const mine = models.filter((m) => m.author === user.username);
  // Quem entrou pelo Google não tem senha aqui para trocar: a autenticação é do
  // provedor, e o painel só ofereceria um formulário que sempre recusa.
  const temSenha = user.provider !== 'google';
  const favorites = models.filter((m) => (user.favorites || []).includes(m.id));
  const totalTriangles = mine.reduce((sum, m) => sum + m.triangles, 0);
  const totalBytes = mine.reduce((sum, m) => sum + m.size, 0);

  container.innerHTML = `
    <div class="profile-head">
      <span class="avatar avatar--lg" style="--av:${esc(user.color)}">${esc(initials(user.username))}</span>
      <div class="profile-head__main">
        <h1>${esc(user.username)}</h1>
        <p>${esc(user.email)} · conta criada em ${esc(formatDate(user.createdAt))}
          ${user.role === 'owner' ? ' · <span class="chip chip--static">mantenedor</span>' : ''}</p>
      </div>
      <a class="btn" href="#/config">${icon('settings', 17)} Configurações</a>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat__value">${formatNumber(mine.length)}</div>
        <div class="stat__label">Modelos enviados</div></div>
      <div class="stat"><div class="stat__value">${formatNumber(favorites.length)}</div>
        <div class="stat__label">Favoritos</div></div>
      <div class="stat"><div class="stat__value">${formatNumber(totalTriangles)}</div>
        <div class="stat__label">Triângulos</div></div>
      <div class="stat"><div class="stat__value">${formatBytes(totalBytes)}</div>
        <div class="stat__label">Volume de arquivos</div></div>
    </div>

    <div class="settings stack">
      <div class="panel">
        <div class="panel__head">${icon('user', 14)} Dados da conta</div>
        <div class="panel__body">
          <form class="form" id="form-profile" novalidate>
            <div class="field" data-field="email">
              <label for="email">E-mail</label>
              <input class="input" type="email" id="email" value="${esc(user.email)}" required>
              <p class="field__error" hidden></p>
            </div>
            <div class="field">
              <label for="bio">Sobre você</label>
              <textarea class="textarea" id="bio" maxlength="400"
                placeholder="Impressora, materiais preferidos, área de atuação…">${esc(user.bio || '')}</textarea>
            </div>
            <div class="btn-row">
              <button class="btn btn--primary" type="submit">${icon('check', 16)} Salvar</button>
            </div>
          </form>
        </div>
      </div>

      ${temSenha ? `
      <div class="panel">
        <div class="panel__head">${icon('key', 14)} Senha</div>
        <div class="panel__body">
          <form class="form" id="form-password" novalidate>
            <div class="field" data-field="current">
              <label for="current">Senha atual</label>
              <input class="input" type="password" id="current" autocomplete="current-password" required>
              <p class="field__error" hidden></p>
            </div>
            <div class="field" data-field="next">
              <label for="next">Nova senha</label>
              <input class="input" type="password" id="next" autocomplete="new-password" required>
              <p class="field__error" hidden></p>
            </div>
            <div class="field" data-field="confirm">
              <label for="confirm">Confirmar nova senha</label>
              <input class="input" type="password" id="confirm" autocomplete="new-password" required>
              <p class="field__error" hidden></p>
            </div>
            <div class="btn-row">
              <button class="btn btn--primary" type="submit">${icon('check', 16)} Alterar senha</button>
            </div>
          </form>
        </div>
      </div>` : ''}

      ${mine.length ? `
      <div class="panel">
        <div class="panel__head">${icon('upload', 14)} Seus envios</div>
        <div class="panel__body">
          ${mine.slice(0, 8).map((m) => `
            <a class="row" href="#/modelo/${encodeURIComponent(m.id)}">
              <span class="row__main">
                <span class="row__title">${esc(m.name)}</span>
                <span class="row__sub">${esc(m.format.toUpperCase())} · ${formatBytes(m.size)}</span>
              </span>
              ${icon('external', 15)}
            </a>`).join('')}
          ${mine.length > 8 ? `<a class="btn btn--sm" href="#/meus-envios">Ver todos os ${mine.length}</a>` : ''}
        </div>
      </div>` : ''}

      <div class="panel">
        <div class="panel__head">${icon('alert', 14)} Encerrar conta</div>
        <div class="panel__body">
          <p class="small faint">${auth.isCloud()
            ? 'Apagar aqui encerra a sessão e remove seus dados deste navegador. A conta em si '
              + 'continua no Supabase: para removê-la de vez, quem administra o projeto precisa '
              + 'apagá-la no painel.'
            : 'A conta existe apenas neste navegador. Apagá-la remove suas preferências e favoritos.'}
            Em nenhum dos casos os modelos já publicados no acervo são removidos.</p>
          <button class="btn btn--danger" type="button" id="delete-account">
            ${icon('trash', 16)} Apagar minha conta
          </button>
        </div>
      </div>
    </div>`;

  function fieldError(form, key, message) {
    qsa('[data-field]', form).forEach((field) => {
      field.classList.remove('field--invalid');
      const slot = qs('.field__error', field);
      if (slot) { slot.hidden = true; slot.textContent = ''; }
    });
    if (!key) return;
    const field = qs(`[data-field="${key}"]`, form);
    if (!field) return;
    field.classList.add('field--invalid');
    const slot = qs('.field__error', field);
    if (slot) { slot.textContent = message; slot.hidden = false; }
  }

  const profileForm = qs('#form-profile', container);
  profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = qs('#email', container).value.trim();
    const bio = qs('#bio', container).value.trim();
    const updated = auth.updateProfile({ email, bio });
    if (!updated) {
      fieldError(profileForm, 'email', 'E-mail inválido.');
      return;
    }
    fieldError(profileForm, null);
    ctx.refreshShell();
    toast('Perfil atualizado.', { type: 'success', timeout: 2400 });
  });

  const passwordForm = qs('#form-password', container);
  passwordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = qs('button[type="submit"]', passwordForm);
    setBusy(submit, true);
    try {
      const result = await auth.changePassword({
        current: qs('#current', container).value,
        next: qs('#next', container).value,
        confirm: qs('#confirm', container).value,
      });
      if (!result.ok) {
        const [key, message] = Object.entries(result.errors)[0];
        fieldError(passwordForm, key, message);
        return;
      }
      fieldError(passwordForm, null);
      passwordForm.reset();
      toast('Senha alterada.', { type: 'success' });
    } finally {
      setBusy(submit, false);
    }
  });

  qs('#delete-account', container).addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Apagar conta',
      message: `A conta "${user.username}" e suas preferências serão removidas deste navegador.`,
      confirmLabel: 'Apagar conta',
      danger: true,
    });
    if (!confirmed) return;
    auth.deleteAccount();
    toast('Conta apagada.', { type: 'info' });
    ctx.navigate('/entrar');
  });
}
