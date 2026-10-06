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

## 2. Contas compartilhadas

O site funciona em dois modos, escolhidos pelo `config.js`.

| | Modo local (padrão) | Modo nuvem (Supabase) |
|---|---|---|
| Login | e-mail e senha, só neste navegador | Google ou e-mail e senha |
| Quem valida | ninguém — não há servidor | o Supabase, no servidor |
| Mesma conta em outro PC | **não** | sim |
| Estoque, orçamentos, clientes | presos a cada navegador | sincronizados |
| Configuração | nenhuma | um projeto gratuito + 2 chaves |

**O modo local não serve para mais de um computador.** A conta criada em uma
máquina não existe na outra, e o custo de fabricação sai zerado no segundo PC
porque o filamento cadastrado também ficou para trás.

Para ativar o modo nuvem, siga **[docs/SUPABASE.md](docs/SUPABASE.md)**: criar o
projeto, rodar `supabase/schema.sql`, ligar o provedor Google e preencher
`config.js`:

```js
supabase: {
  url: 'https://SEU-PROJETO.supabase.co',
  anonKey: 'eyJhbGci...',
},
```

A `anonKey` é pública por projeto — quem protege os dados são as políticas de
RLS do schema, que amarram cada linha ao seu dono. Nunca coloque a chave
`service_role` aqui.

### Primeiro acesso

1. Abra o site. A tela inicial é o login.
2. No modo nuvem, clique em **Entrar com Google**. No modo local, em **Criar conta**.
3. Em **Configurações → Contas e sincronização** você vê em que modo está, se o
   projeto responde e se o schema foi aplicado.

## 3. Habilitar o envio de modelos

Há dois caminhos, e eles resolvem problemas diferentes.

| | Função no Supabase | Token por pessoa |
|---|---|---|
| Quem configura | só o dono, uma vez | cada pessoa, em cada PC |
| Onde o token fica | segredo do servidor | `localStorage` do navegador |
| Autoria no commit | e-mail na mensagem | identidade real no Git |
| Instalação | exige a CLI do Supabase | nenhuma |

**Equipe:** use a função — ninguém precisa de token. Passo a passo em
**[docs/PUBLICACAO.md](docs/PUBLICACAO.md)**.

**Uso individual:** o token pessoal é mais simples e tem precedência quando
cadastrado. Siga abaixo.

> Não existe uma terceira via: um token compartilhado dentro do `config.js` é
> servido ao público junto com o site, e o secret scanning do GitHub o revoga
> em minutos.

### Token pessoal

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
| Contas | Supabase Auth (Google ou e-mail), ou `localStorage` + PBKDF2 no modo local |
| Dados de produção | Supabase/PostgREST no modo nuvem, `localStorage` no modo local |
| Roteamento | Hash router (`#/biblioteca`, `#/modelo/:id`, …), sem necessidade de fallback 404 |
| Catálogo | `data/catalog.json` versionado; lido por `fetch` relativo, sem consumir cota de API |
| Arquivos | `models/<id>/<id>.stl` ou `.3mf`, mais `thumb.png` gerada no navegador |
| Leitura | `fetch` direto no site publicado |
| Escrita | API de conteúdo do GitHub (`PUT /repos/:owner/:repo/contents/:path`) |
| Cliente Supabase | `fetch` direto em `/auth/v1` e `/rest/v1` — sem SDK e sem CDN |
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
supabase/schema.sql     Tabelas, RLS e gatilhos (rodar no editor SQL)
docs/SUPABASE.md        Passo a passo da configuração
assets/js/
  app.js                Roteador, casca, tema, guarda de acesso
  supabase.js           Cliente REST de auth e dados, sem SDK
  inventory.js          Estoque com cache em memória e escrita atrasada
  costing.js            Motor de custo e preço
  production.js         Cruza o arquivo enviado com o estoque
  printers.js           Catálogo de impressoras
  filaments.js          Materiais, densidades e paleta
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
- **No modo local, o login é um controle de interface.** Não existe servidor para validar
  credenciais: as contas vivem no `localStorage`. A senha nunca é guardada em texto claro
  (PBKDF2-SHA256), o que protege a senha em si, mas não impede que alguém com acesso ao
  navegador limpe o armazenamento e crie outra conta. E a conta não existe em outro PC.
- **No modo nuvem, o login é verificação real.** O Supabase valida a credencial no servidor e
  as políticas de RLS impedem que um usuário leia os dados de outro. É o modo recomendado
  para mais de uma pessoa ou mais de um computador.
- **Em nenhum dos modos o login autoriza escrita no Git.** Publicar e remover modelos continua
  exigindo o token do GitHub — é ele a credencial que o GitHub reconhece.
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
