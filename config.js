/**
 * Configuração do site. Editável sem rebuild.
 *
 * `owner` / `repo` / `branch` apontam para o repositório que hospeda os arquivos.
 * Quando deixados em branco, são deduzidos da URL do GitHub Pages
 * (ex.: https://devplanetprojectia.github.io/3D-Project/ -> owner=DevPlanetProjectIA, repo=3D-Project).
 */
const detected = (() => {
  const host = location.hostname || '';
  const m = host.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return { owner: '', repo: '' };
  const seg = location.pathname.split('/').filter(Boolean);
  // Em user.github.io/<repo>/ o primeiro segmento é o repositório.
  // Em user.github.io/ (Pages de usuário) o repositório é <user>.github.io.
  return { owner: m[1], repo: seg.length ? seg[0] : `${m[1]}.github.io` };
})();

export const CONFIG = {
  /** Nome exibido no cabeçalho. */
  siteName: '3D Library',

  /** Dono do repositório no GitHub. Vazio = detectar pela URL. */
  owner: detected.owner || 'DevPlanetProjectIA',

  /** Nome do repositório. Vazio = detectar pela URL. */
  repo: detected.repo || '3D-Project',

  /** Branch onde os arquivos são gravados e de onde o Pages publica. */
  branch: 'main',

  /** Caminhos dentro do repositório. */
  paths: {
    catalog: 'data/catalog.json',
    models: 'models',
  },

  /**
   * Limites de upload. A API de conteúdo do GitHub aceita até 100 MB, mas o
   * corpo vai em base64 (+33%), então o limite prático fica bem abaixo disso.
   */
  upload: {
    maxBytes: 45 * 1024 * 1024,
    accept: ['.stl', '.3mf'],
  },

  /** Permite navegar e baixar sem autenticação. */
  allowGuestBrowsing: true,

  /**
   * Formas de entrar.
   *
   * Desligar `emailPassword` esconde o formulário e o "Criar conta", deixando só
   * o Google. Vale apenas no modo nuvem: sem projeto Supabase o e-mail e senha
   * é o único caminho, e desligá-lo trancaria a porta.
   *
   * A tela ainda devolve o formulário se o Supabase informar que o provedor do
   * Google está desligado — do contrário um Client Secret errado no painel
   * deixaria todo mundo de fora, sem alternativa.
   */
  signIn: {
    google: true,
    emailPassword: false,
  },

  /** Tamanho em px da miniatura gerada no upload. */
  thumbnailSize: 512,

  /** Política de senha para contas locais. */
  password: { minLength: 8, iterations: 150000 },

  /**
   * Supabase — contas e dados compartilhados entre computadores.
   *
   * Deixe os dois campos vazios para o modo local (contas e estoque apenas no
   * navegador, como antes). Preenchidos, o login passa a ser do Supabase
   * (Google ou e-mail/senha) e o estoque, orçamentos e clientes sincronizam
   * entre todos os PCs.
   *
   * A `anonKey` é pública por projeto: ela só dá acesso ao que as políticas de
   * RLS permitirem, e o schema em `supabase/schema.sql` restringe cada linha ao
   * seu dono. Nunca coloque aqui a `service_role`.
   *
   * Passo a passo em README.md, seção "Contas compartilhadas".
   */
  supabase: {
    url: 'https://eqhxwpgpzseprcmiuaww.supabase.co',
    anonKey: 'sb_publishable_P_uamf5YKN2AFGyTJP3QTA_VrijCGgw',
  },

  /**
   * Onde os arquivos de modelo são gravados.
   *
   * `'auto'`  usa o Supabase Storage quando há projeto e sessão, e cai no Git
   *           quando não há. É o padrão: publicar não pede token nem espera.
   * `'storage'` força o Storage.
   * `'git'`   força o repositório, com o histórico de versões que ele dá.
   *
   * As duas fontes são lidas sempre: trocar isto não esconde o que já existe.
   */
  acervo: 'auto',
};

export default CONFIG;
