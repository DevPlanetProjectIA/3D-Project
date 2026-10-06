# 3D Library

Biblioteca compartilhada de modelos 3D (`.stl` e `.3mf`) publicada como site estático no GitHub Pages.
Tela de login com criação de conta, catálogo com busca e etiquetas, visualizador 3D integrado e
upload que grava os arquivos no próprio repositório.

Sem backend, sem build e sem dependências: `index.html` mais módulos ES nativos.

---

## 1. Publicar o site

1. Faça o push deste repositório para o GitHub.
2. Abra **Settings → Pages**.
3. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
4. Em **Branch**, selecione `main` e a pasta `/ (root)`. Salve.
5. Aguarde um minuto. O site responde em `https://<owner>.github.io/<repo>/`.

O arquivo `.nojekyll` na raiz impede que o Jekyll reprocesse o conteúdo.

## 2. Primeiro acesso

1. Abra o site. A tela inicial é o login.
2. Clique em **Criar conta**. A primeira conta é marcada como mantenedora.
3. As contas ficam no `localStorage` do navegador — veja [Modelo de segurança](#modelo-de-seguranca).

## 3. Habilitar o envio de modelos

A leitura é pública e não exige nada. Para **publicar** ou **remover** modelos é preciso um token,
porque essas ações criam commits via API do GitHub.

1. Gere um [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
2. Em **Repository access**, selecione apenas este repositório.
3. Em **Permissions → Repository permissions**, marque **Contents: Read and write**.
4. No site, vá em **Configurações → Token do GitHub**, cole o token e clique em **Validar e salvar**.

O token fica no `localStorage` deste navegador e só é enviado para `api.github.com`.
Use validade curta e remova-o em computadores compartilhados.

---

## Como funciona

| Camada | Implementação |
|---|---|
| Hospedagem | GitHub Pages servindo a raiz do repositório |
| Roteamento | Hash router (`#/biblioteca`, `#/modelo/:id`, …), sem necessidade de fallback 404 |
| Catálogo | `data/catalog.json` versionado; lido por `fetch` relativo, sem consumir cota de API |
| Arquivos | `models/<id>/<id>.stl` ou `.3mf`, mais `thumb.png` gerada no navegador |
| Leitura | `fetch` direto no site publicado |
| Escrita | API de conteúdo do GitHub (`PUT /repos/:owner/:repo/contents/:path`) |
| Contas | `localStorage` + PBKDF2-SHA256 (150 000 iterações) via WebCrypto |
| Visualizador | WebGL puro — shaders, controle de órbita e grade escritos à mão |
| Parsers | STL binário e ASCII; 3MF via leitor ZIP próprio + `DecompressionStream('deflate-raw')` |

### Estrutura

```
index.html              Casca da aplicação
config.js               Owner, repo, branch, limites — único arquivo a ajustar
.nojekyll               Desliga o Jekyll no Pages
data/catalog.json       Índice dos modelos
models/                 Arquivos publicados
assets/css/styles.css   Folha de estilo única, com tema claro e escuro
assets/js/
  app.js                Roteador, casca, tema, guarda de acesso
  auth.js               Contas locais, sessão, favoritos, token
  store.js              localStorage/sessionStorage tolerante a falhas
  github.js             Cliente da API de conteúdo
  catalog.js            Carga, consulta e publicação do catálogo
  viewer.js             Renderizador WebGL e gerador de miniaturas
  math3d.js             mat4/vec3 mínimos
  parsers/
    index.js            Despacho de formato e medidas
    stl.js              STL binário e ASCII
    threemf.js          3MF (OPC/XML)
    zip.js              Leitor de ZIP com suporte a ZIP64
  views/                login, library, model, upload, profile, settings
```

### Configuração

`config.js` detecta `owner` e `repo` pela URL do Pages. Ajuste manualmente se usar domínio próprio:

```js
owner: 'DevPlanetProjectIA',
repo: '3D-Project',
branch: 'main',
upload: { maxBytes: 25 * 1024 * 1024 },
allowGuestBrowsing: true,
```

---

## Modelo de segurança

Leia antes de usar com conteúdo sensível.

- **O repositório é a fonte dos arquivos.** Se ele for público, todo modelo enviado é público,
  independente do login. Para acervo restrito, use um repositório privado — nesse caso o Pages
  exige plano pago e a leitura passa a precisar de token.
- **O login é um controle de interface.** Não existe servidor para validar credenciais: as contas
  vivem no `localStorage` do navegador. A senha nunca é guardada em texto claro (PBKDF2-SHA256),
  o que protege a senha em si, mas não impede que alguém com acesso ao navegador limpe o
  armazenamento e crie outra conta.
- **Contas não são compartilhadas entre navegadores.** Cada pessoa cria a sua no próprio dispositivo.
  O que é compartilhado é o acervo — ele vem do repositório.
- **O token do GitHub é a credencial real.** Quem tem token grava no repositório; quem não tem,
  apenas lê. Trate o token como senha: escopo mínimo, validade curta, remoção após o uso.

## Limites

| Item | Limite |
|---|---|
| Tamanho por arquivo | 25 MB por padrão (`config.js`); a API do GitHub aceita até 100 MB |
| Tamanho do repositório | Recomendação do GitHub: abaixo de 1 GB |
| Escrita na API | 5 000 requisições/hora por token |
| Propagação do Pages | Cerca de um minuto após o commit |
| Malha de arame | Desativada acima de 800 000 triângulos |

## Desenvolvimento local

Módulos ES não carregam via `file://`. Sirva o diretório:

```bash
python3 -m http.server 8080
# abra http://localhost:8080
```

## Compatibilidade

Chrome/Edge 103+, Firefox 113+, Safari 16.4+. Requer WebGL (visualizador) e
`DecompressionStream` (arquivos 3MF comprimidos). STL funciona sem ambos — apenas sem a
pré-visualização, se faltar WebGL.
