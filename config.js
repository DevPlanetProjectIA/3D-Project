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

  /** Limites de upload. 100 MB é o teto da API de conteúdo do GitHub; 25 MB é o limite prático. */
  upload: {
    maxBytes: 25 * 1024 * 1024,
    accept: ['.stl', '.3mf'],
  },

  /** Permite navegar e baixar sem autenticação. */
  allowGuestBrowsing: true,

  /** Tamanho em px da miniatura gerada no upload. */
  thumbnailSize: 512,

  /** Política de senha para contas locais. */
  password: { minLength: 8, iterations: 150000 },
};

export default CONFIG;
