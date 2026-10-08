/* Tela de entrada: login e criação de conta na mesma superfície. */

import CONFIG from '../../../config.js';
import * as auth from '../auth.js';
import { esc, icon, qs, qsa, toast, setBusy } from '../util.js';
import { Viewer } from '../viewer.js';

const BRAND_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 22 7.5v9L12 22 2 16.5v-9z"/><path d="M2 7.5 12 13l10-5.5M12 13v9"/></svg>`;

/* Marca do Google em SVG inline: o site não carrega imagem de terceiros. */
const GOOGLE_MARK = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z"/>
  <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.3v3.1A12 12 0 0 0 12 24z"/>
  <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"/>
  <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"/>
</svg>`;

/* ---------- Geometria decorativa ---------- */

/** Nó tórico procedural usado como ilustração animada do painel lateral. */
function torusKnot({ radius = 1, tube = 0.3, segments = 160, sides = 20, p = 2, q = 3 } = {}) {
  const positions = [];
  const normals = [];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  const curve = (t) => {
    const u = t * p * Math.PI * 2;
    const v = t * q * Math.PI * 2;
    const r = radius * (2 + Math.cos(v));
    return [r * Math.cos(u) / 2, r * Math.sin(u) / 2, radius * Math.sin(v) / 2];
  };

  const grid = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve(t);
    const next = curve((i + 1) / segments);
    const prev = curve((i - 1 + segments) / segments);

    const tangent = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
    const tl = Math.hypot(...tangent) || 1;
    const T = tangent.map((c) => c / tl);
    let N = [T[1], -T[0], 0];
    if (Math.hypot(...N) < 1e-6) N = [1, 0, 0];
    const nl = Math.hypot(...N) || 1;
    N = N.map((c) => c / nl);
    const B = [
      T[1] * N[2] - T[2] * N[1],
      T[2] * N[0] - T[0] * N[2],
      T[0] * N[1] - T[1] * N[0],
    ];

    const ring = [];
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const normal = [
        N[0] * cos + B[0] * sin,
        N[1] * cos + B[1] * sin,
        N[2] * cos + B[2] * sin,
      ];
      ring.push({
        position: [
          point[0] + tube * normal[0],
          point[1] + tube * normal[1],
          point[2] + tube * normal[2],
        ],
        normal,
      });
    }
    grid.push(ring);
  }

  const push = (vertex) => {
    positions.push(...vertex.position);
    normals.push(...vertex.normal);
    for (let k = 0; k < 3; k++) {
      if (vertex.position[k] < bounds.min[k]) bounds.min[k] = vertex.position[k];
      if (vertex.position[k] > bounds.max[k]) bounds.max[k] = vertex.position[k];
    }
  };

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
      push(a); push(b); push(c);
      push(a); push(c); push(d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    triangles: positions.length / 9,
    bounds,
  };
}

/* ---------- Markup ---------- */

const FEATURES = [
  ['box', 'Visualizador 3D integrado para .stl e .3mf, direto no navegador.'],
  ['layers', 'Arquivos versionados no repositório Git — histórico completo de cada modelo.'],
  ['tag', 'Busca, etiquetas e favoritos para encontrar o modelo certo em segundos.'],
  ['shield', 'Hospedagem estática no GitHub Pages: sem servidor para manter.'],
];

function asideMarkup() {
  return `
    <aside class="auth__aside">
      <canvas id="auth-art" aria-hidden="true"></canvas>
      <div class="auth__brand">${BRAND_MARK}<span>${esc(CONFIG.siteName)}</span></div>
      <div class="auth__pitch">
        <h2>Biblioteca compartilhada de modelos 3D</h2>
        <p>Um acervo único para a equipe: envie, visualize e baixe peças prontas para impressão sem sair do navegador.</p>
        <ul class="auth__features">
          ${FEATURES.map(([ico, text]) => `<li>${icon(ico, 17)}<span>${esc(text)}</span></li>`).join('')}
        </ul>
      </div>
      <p class="small faint">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</p>
    </aside>`;
}

function passwordField({ id, label, hint = '', autocomplete = 'current-password' }) {
  return `
    <div class="field" data-field="${esc(id)}">
      <label for="${esc(id)}">${esc(label)}</label>
      <div class="input-group">
        <input class="input" type="password" id="${esc(id)}" name="${esc(id)}"
               autocomplete="${esc(autocomplete)}" required>
        <button class="input-group__btn" type="button" data-toggle-password="${esc(id)}"
                aria-label="Mostrar senha">${icon('eye', 17)}</button>
      </div>
      ${hint ? `<p class="field__hint">${esc(hint)}</p>` : ''}
      <p class="field__error" hidden></p>
    </div>`;
}

function loginMarkup() {
  return `
    <form class="form" id="form-login" novalidate>
      <div class="field" data-field="identifier">
        <label for="identifier">${auth.isCloud() ? 'E-mail' : 'Usuário ou e-mail'}</label>
        <input class="input" type="${auth.isCloud() ? 'email' : 'text'}" id="identifier" name="identifier"
               autocomplete="${auth.isCloud() ? 'email' : 'username'}"
               autocapitalize="none" spellcheck="false" required autofocus>
        <p class="field__error" hidden></p>
      </div>
      ${passwordField({ id: 'password', label: 'Senha' })}
      <label class="check">
        <input type="checkbox" name="remember" checked>
        <span>Manter sessão neste navegador</span>
      </label>
      <p class="field__error" data-form-error hidden></p>
      <button class="btn btn--primary btn--lg btn--block" type="submit">
        ${icon('login', 18)} Entrar
      </button>
    </form>`;
}

function signupMarkup() {
  return `
    <form class="form" id="form-signup" novalidate>
      <div id="signup-notice"></div>
      <div class="field" data-field="username">
        <label for="username">Nome de usuário</label>
        <input class="input" type="text" id="username" name="username" autocomplete="username"
               autocapitalize="none" spellcheck="false" placeholder="ex.: bruno.toledo" required autofocus>
        <p class="field__hint">3 a 24 caracteres. Letras, números, ponto, hífen ou sublinhado.</p>
        <p class="field__error" hidden></p>
      </div>
      <div class="field" data-field="email">
        <label for="email">E-mail</label>
        <input class="input" type="email" id="email" name="email" autocomplete="email"
               autocapitalize="none" spellcheck="false" required>
        <p class="field__error" hidden></p>
      </div>
      <div class="field" data-field="password">
        <label for="password">Senha</label>
        <div class="input-group">
          <input class="input" type="password" id="password" name="password" autocomplete="new-password" required>
          <button class="input-group__btn" type="button" data-toggle-password="password"
                  aria-label="Mostrar senha">${icon('eye', 17)}</button>
        </div>
        <div class="meter" id="strength">
          <div class="meter__track">
            ${[0, 1, 2, 3].map(() => '<i class="meter__seg"></i>').join('')}
          </div>
          <span class="meter__label">Mínimo de ${CONFIG.password.minLength} caracteres.</span>
        </div>
        <p class="field__error" hidden></p>
      </div>
      <div class="field" data-field="confirm">
        <label for="confirm">Confirmar senha</label>
        <div class="input-group">
          <input class="input" type="password" id="confirm" name="confirm" autocomplete="new-password" required>
          <button class="input-group__btn" type="button" data-toggle-password="confirm"
                  aria-label="Mostrar senha">${icon('eye', 17)}</button>
        </div>
        <p class="field__error" hidden></p>
      </div>
      <p class="field__error" data-form-error hidden></p>
      <button class="btn btn--primary btn--lg btn--block" type="submit">
        ${icon('user', 18)} Criar conta
      </button>
      <p class="small faint center">
        ${auth.isCloud()
          ? 'Os arquivos enviados são públicos no repositório.'
          : 'As contas ficam neste navegador. Os arquivos enviados são públicos no repositório.'}
      </p>
    </form>`;
}

/**
 * Bloco do Google: botão quando o provedor está ligado, explicação quando não.
 *
 * Com `null` (nada em cache ainda) mostra o botão — o caso normal é o provedor
 * estar ligado, e a correção chega em milissegundos se não estiver.
 */
function googleSlotMarkup(settings, { soGoogle = false } = {}) {
  if (settings && settings.google === false) {
    // Sem separador: o bloco seguinte já traz o seu, e dois "ou" seguidos ficam estranhos.
    return `
      <div class="banner banner--warn" style="margin:16px 0 0">
        ${icon('alert', 18)}
        <div class="small">
          <strong>Entrada pelo Google ainda não habilitada</strong>
          <div>Quem administra o projeto precisa ligar o provedor em
            <span class="mono">Authentication → Sign In / Providers → Google</span> no painel do
            Supabase, com o Client ID e o Client Secret do Google Cloud. O passo a passo está em
            <span class="mono">docs/SUPABASE.md</span>.</div>
          <div style="margin-top:6px">${soGoogle
            ? 'Enquanto isso o acesso por e-mail e senha volta a aparecer acima, para ninguém '
              + 'ficar sem entrar.'
            : 'Por enquanto, use e-mail e senha acima — funciona em qualquer computador do mesmo '
              + 'jeito.'}</div>
        </div>
      </div>`;
  }

  return `
    ${soGoogle ? '' : '<div class="auth__divider">ou</div>'}
    <button class="btn btn--primary btn--block btn--lg" type="button" id="google">
      ${GOOGLE_MARK} Entrar com Google
    </button>
    <p class="small faint center" style="margin-top:8px">
      ${soGoogle
        ? 'Sem senha para lembrar: a conta é a do seu Google, e abre em qualquer computador com '
          + 'estoque e orçamentos sincronizados.'
        : 'Sua conta abre em qualquer computador, com estoque e orçamentos sincronizados.'}
    </p>`;
}

/* ---------- Comportamento ---------- */

const SEG_COLORS = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--success)', 'var(--success)'];

function showErrors(root, errors) {
  qsa('[data-field]', root).forEach((field) => {
    field.classList.remove('field--invalid');
    const slot = qs('.field__error', field);
    if (slot) { slot.hidden = true; slot.textContent = ''; }
  });
  const formSlot = qs('[data-form-error]', root);
  if (formSlot) { formSlot.hidden = true; formSlot.textContent = ''; }

  let firstInvalid = null;
  for (const [key, message] of Object.entries(errors || {})) {
    if (key === 'form') {
      if (formSlot) { formSlot.textContent = message; formSlot.hidden = false; }
      continue;
    }
    const field = qs(`[data-field="${key}"]`, root);
    if (!field) continue;
    field.classList.add('field--invalid');
    const slot = qs('.field__error', field);
    if (slot) { slot.textContent = message; slot.hidden = false; }
    firstInvalid = firstInvalid || qs('input', field);
  }
  firstInvalid?.focus();
}

function wirePasswordToggles(root) {
  qsa('[data-toggle-password]', root).forEach((button) => {
    button.addEventListener('click', () => {
      const input = qs(`#${button.dataset.togglePassword}`, root);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.innerHTML = icon(show ? 'eyeOff' : 'eye', 17);
      button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    });
  });
}

function wireStrengthMeter(root) {
  const input = qs('#password', root);
  const meter = qs('#strength', root);
  if (!input || !meter) return;
  const segments = qsa('.meter__seg', meter);
  const label = qs('.meter__label', meter);
  input.addEventListener('input', () => {
    const value = input.value;
    if (!value) {
      segments.forEach((s) => { s.classList.remove('is-on'); s.style.removeProperty('--level'); });
      label.textContent = `Mínimo de ${CONFIG.password.minLength} caracteres.`;
      return;
    }
    const { score, label: text, hints } = auth.passwordStrength(value);
    segments.forEach((segment, i) => {
      const on = i < score;
      segment.classList.toggle('is-on', on);
      segment.style.setProperty('--level', SEG_COLORS[score]);
    });
    label.textContent = hints.length ? `${text} — ${hints[0]}.` : `${text}.`;
  });
}

function mountArt(root) {
  const canvas = qs('#auth-art', root);
  if (!canvas) return null;
  try {
    const viewer = new Viewer(canvas, { autoRotate: true, showGrid: false, color: [0.42, 0.52, 0.95] });
    viewer.setGeometry(torusKnot());
    viewer.view.radius *= 1.1;
    viewer.invalidate();
    return viewer;
  } catch {
    canvas.remove();
    return null;
  }
}

/* ---------- Entrada da view ---------- */

export default async function loginView(container, ctx) {
  let atual = null;
  await pintar(container, ctx, (viewer) => { atual = viewer; });
  return () => atual?.dispose();
}

async function pintar(container, ctx, guardarViewer) {
  // Em /criar-conta o cache vazio não serve: a decisão ali é mandar a pessoa
  // embora, e fazer isso sem saber se o Google está ligado tiraria do ar a
  // única entrada que resta quando ele está desligado.
  const settings = ctx.route === '/criar-conta' && auth.isCloud() && !auth.cachedAuthSettings()
    ? await auth.authSettings().catch(() => null)
    : auth.cachedAuthSettings();

  // Com o Google como única entrada não há conta para criar: o provedor cria a
  // do usuário no primeiro acesso. A rota vira a de entrar.
  const comFormulario = auth.emailPasswordEnabled(settings);
  const comGoogle = auth.googleEnabled();
  const soGoogle = comGoogle && !comFormulario;

  if (soGoogle && ctx.route === '/criar-conta') {
    ctx.navigate('/entrar');
    return;
  }


  const mode = ctx.route === '/criar-conta' ? 'signup' : 'login';
  const isSignup = mode === 'signup';
  const firstAccount = !auth.usersExist();

  container.innerHTML = `
    <div class="auth">
      ${asideMarkup()}
      <main class="auth__main">
        <div class="auth__card">
          <div class="auth__mobile-brand">${BRAND_MARK}<span>${esc(CONFIG.siteName)}</span></div>
          <header>
            <h1>${isSignup ? 'Criar conta' : 'Entrar'}</h1>
            <p>${isSignup
              ? (firstAccount
                ? 'Esta será a primeira conta da biblioteca.'
                : 'Preencha os dados para começar a usar a biblioteca.')
              : soGoogle
                ? 'Entre com sua conta do Google para usar a biblioteca compartilhada de modelos 3D.'
                : 'Acesse a biblioteca compartilhada de modelos 3D.'}</p>
          </header>
          ${comFormulario ? (isSignup ? signupMarkup() : loginMarkup()) : ''}
          ${comFormulario ? `
            <p class="auth__switch">
              ${isSignup
                ? `Já tem uma conta? <a href="#/entrar">Entrar</a>`
                : `Ainda não tem conta? <a href="#/criar-conta">Criar conta</a>`}
            </p>` : ''}
          ${comGoogle ? `<div id="google-slot">${
            googleSlotMarkup(settings, { soGoogle })}</div>` : ''}

          ${CONFIG.allowGuestBrowsing ? `
            <div class="auth__divider">ou</div>
            <button class="btn btn--block" type="button" id="guest">
              ${icon('eye', 18)} Entrar como visitante
            </button>
            <p class="small faint center" style="margin-top:8px">
              Visitantes navegam e baixam, mas não enviam modelos.
            </p>` : ''}
        </div>
      </main>
    </div>`;

  const viewer = mountArt(container);
  guardarViewer(viewer);
  wirePasswordToggles(container);
  if (isSignup) wireStrengthMeter(container);

  qs('#guest', container)?.addEventListener('click', () => {
    auth.enterAsGuest();
    ctx.navigate('/biblioteca');
  });

  // O botão do Google só vale se o provedor estiver habilitado no projeto.
  // A primeira pintura usa o cache; a confirmação chega da rede e corrige.
  if (comGoogle) {
    const slot = qs('#google-slot', container);
    const wireGoogle = () => {
      qs('#google', slot)?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        setBusy(button, true);
        try {
          // Sai da página: o retorno é tratado em app.js, antes do roteador.
          await auth.signInWithGoogle();
        } catch (error) {
          setBusy(button, false);
          slot.innerHTML = googleSlotMarkup({ google: false }, { soGoogle });
          toast(error.message, { type: 'error', title: 'Google indisponível' });
        }
      });
    };
    wireGoogle();

    auth.authSettings().then((settings) => {
      if (!settings || !slot.isConnected) return;
      // A rede desmentiu o cache: o Google está desligado no projeto e a tela
      // não tem formulário. Redesenha inteira, para o e-mail e senha voltar --
      // um aviso sozinho deixaria a pessoa sem nenhuma forma de entrar.
      if (soGoogle && auth.emailPasswordEnabled(settings)) {
        viewer?.dispose();
        pintar(container, ctx, guardarViewer);
        return;
      }
      slot.innerHTML = googleSlotMarkup(settings, { soGoogle });
      wireGoogle();
    });
  }

  // Confirmação de e-mail é opção do projeto; avisar antes evita a pessoa
  // criar a conta, tentar entrar e não entender por que foi recusada.
  if (isSignup && auth.isCloud()) {
    const notice = qs('#signup-notice', container);
    const render = (settings) => {
      if (!settings || !notice?.isConnected) return;
      if (!settings.signupEnabled) {
        notice.innerHTML = `
          <div class="banner banner--warn" style="margin:0">${icon('alert', 18)}
            <div class="small">O cadastro por e-mail está desativado neste projeto. Peça a quem
              administra para liberá-lo em <span class="mono">Authentication → Sign In /
              Providers → Email</span>, ou entre pelo Google.</div>
          </div>`;
        return;
      }
      if (!settings.autoConfirm) {
        notice.innerHTML = `
          <div class="banner banner--info" style="margin:0">${icon('info', 18)}
            <div class="small">Depois de criar a conta, o Supabase envia um e-mail de confirmação.
              É preciso clicar no link antes do primeiro acesso.</div>
          </div>`;
      }
    };
    render(auth.cachedAuthSettings());
    auth.authSettings().then(render);
  }

  const form = qs('form', container);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = qs('button[type="submit"]', form);
    const data = Object.fromEntries(new FormData(form).entries());
    setBusy(submit, true);
    try {
      const result = isSignup
        ? await auth.signUp({
            username: data.username,
            email: data.email,
            password: data.password,
            confirm: data.confirm,
          })
        : await auth.signIn({
            identifier: data.identifier,
            password: data.password,
            remember: 'remember' in data,
          });

      if (!result.ok) {
        showErrors(form, result.errors);
        return;
      }
      auth.leaveGuest();
      toast(isSignup ? `Conta criada. Bem-vindo, ${result.user.username}.` : `Olá, ${result.user.username}.`,
        { type: 'success' });
      ctx.navigate('/biblioteca');
    } catch (error) {
      showErrors(form, { form: error?.message || 'Falha inesperada. Tente novamente.' });
    } finally {
      setBusy(submit, false);
    }
  });

}
