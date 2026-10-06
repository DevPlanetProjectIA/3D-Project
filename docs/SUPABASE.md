# Configurar o Supabase

Guia de uma passada só, na ordem. No fim, o login do site passa a ser do Supabase
(Google ou e-mail/senha) e o estoque, orçamentos e clientes ficam iguais em todos os
computadores.

Enquanto `config.js` tiver `supabase.url` e `supabase.anonKey` vazios, o site continua
no modo local — contas e estoque só no `localStorage` do navegador. Nada quebra se você
parar no meio deste guia.

Reserve 20 minutos. O passo 3 (Google Cloud) é o mais longo; se não quiser login pelo
Google, pule-o e use só e-mail/senha.

| Passo | Onde | O que sai dele |
|---|---|---|
| 1 | supabase.com | `Project URL` e chave `anon public` |
| 2 | Supabase → SQL Editor | tabelas e políticas de RLS |
| 3 | Google Cloud Console | `Client ID` e `Client Secret` |
| 4 | Supabase → Authentication | provedor Google ligado |
| 5 | Supabase → Authentication | URLs de retorno aceitas |
| 6 | `config.js` do repositório | site apontando para o projeto |
| 7 | o site publicado | teste de ponta a ponta |

---

## 1. Criar o projeto e pegar as credenciais

1. Entre em <https://supabase.com/dashboard> e clique em **New project**.
2. Escolha a organização, dê um nome (ex.: `3d-library`), defina a **Database Password**
   (guarde-a; ela é do banco, não do site) e escolha a região mais próxima —
   `South America (São Paulo)` se você estiver no Brasil.
3. Clique em **Create new project** e espere o provisionamento terminar.
4. Com o projeto aberto, clique em **Connect**, no topo da tela: ele já mostra a URL e a
   chave pública prontas para copiar. O caminho completo, com todas as chaves, é
   **Settings → API Keys**.
   - **Project URL** — algo como `https://abcdefghijklmno.supabase.co`.
   - **anon public** — a chave longa que começa com `eyJ...`. Em projetos novos ela
     aparece na aba **Legacy API keys**, ao lado da chave `publishable` mais recente;
     o cliente deste site usa a `anon`/`publishable`, as duas funcionam no lugar dela.
5. Anote os dois valores. A parte `abcdefghijklmno` da URL é o **project ref** — ele
   reaparece no passo 3.

Não copie a chave **service_role**. Ela ignora o RLS e daria acesso total ao banco a
qualquer visitante do site.

> A chave `anon` é pública de propósito: ela vai no JavaScript e qualquer pessoa pode
> lê-la. O que protege os dados são as políticas de RLS criadas no passo 2.

## 2. Rodar o `schema.sql`

1. No menu da esquerda, abra **SQL Editor**.
2. Clique em **New query**.
3. Cole o conteúdo inteiro de [`supabase/schema.sql`](../supabase/schema.sql).
4. Clique em **Run** (ou `Ctrl`/`Cmd` + `Enter`).

A resposta esperada é **Success. No rows returned**. O arquivo é idempotente: pode rodar
de novo sem erro, e é assim que você aplica atualizações do schema depois.

O que ele cria:

| Tabela | Conteúdo |
|---|---|
| `profiles` | nome, bio, cor, favoritos e papel de cada conta |
| `filaments` | estoque de filamento (material, cor, rolos, saldo, preço) |
| `supplies` | insumos (cola, embalagem, imã…) |
| `products` | produtos prontos, com custo e preço |
| `clients` | carteira de clientes dos orçamentos |
| `quotes` | histórico de orçamentos |
| `cost_settings` | uma linha por usuário com os parâmetros da calculadora |

Para conferir, abra **Table Editor**: as sete tabelas devem aparecer, e nenhuma delas
com o aviso de RLS desabilitado.

## 3. Criar as credenciais OAuth no Google Cloud

Só é necessário para o botão "Entrar com Google".

### 3.1 Projeto

1. Entre em <https://console.cloud.google.com/>.
2. No seletor de projetos, no topo, clique em **New project**, dê um nome
   (ex.: `3D Library Login`) e confirme em **Create**.
3. Confira no seletor que o projeto novo é o que está ativo antes de continuar.

### 3.2 Tela de consentimento

1. Abra **APIs & Services → OAuth consent screen** (atalho:
   <https://console.cloud.google.com/apis/credentials/consent>).
2. Em **Audience**, escolha **External** — é o que permite que qualquer conta Google
   entre. "Internal" só existe em contas Workspace e limita o login ao seu domínio.
3. Preencha **Branding**: nome do aplicativo (aparece na tela de login do Google),
   e-mail de suporte e e-mail de contato do desenvolvedor.
4. Em **Data access → Add or remove scopes**, mantenha apenas `openid`,
   `.../auth/userinfo.email` e `.../auth/userinfo.profile`. Esses três não exigem
   verificação do Google.
5. Salve. O aplicativo fica em modo **Testing**, o que basta para uso próprio. Nesse modo
   só entram as contas listadas em **Audience → Test users** — adicione o seu e-mail ali.
   Para abrir a qualquer pessoa, use **Publish app**.

### 3.3 Cliente OAuth

1. Abra **APIs & Services → Credentials** (atalho:
   <https://console.cloud.google.com/auth/clients>).
2. Clique em **Create credentials → OAuth client ID**.
3. Em **Application type**, escolha **Web application**.
4. Em **Name**, algo reconhecível: `3D Library — Pages`.
5. Em **Authorized JavaScript origins**, clique em **Add URI** e informe a origem do site
   no Pages — só o esquema e o domínio, sem caminho:

   ```
   https://devplanetprojectia.github.io
   ```

6. Em **Authorized redirect URIs**, clique em **Add URI** e informe o endereço de callback
   do **Supabase**, não o do site:

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

   Troque `<project-ref>` pelo identificador do passo 1. Você não precisa montar esse
   valor de cabeça: o Supabase o exibe pronto, com um botão de copiar, na própria tela do
   provedor Google (passo 4) — abra-a em outra aba e copie de lá.

7. Clique em **Create**. O Google mostra **Client ID** e **Client secret**. Copie os dois
   agora; o secret pode ser recuperado depois na mesma tela, mas é mais rápido copiar já.

A divisão de papéis costuma confundir, e é ela que faz o fluxo funcionar:

| Campo | Valor | Por quê |
|---|---|---|
| Authorized redirect URI | `https://<project-ref>.supabase.co/auth/v1/callback` | O Google devolve o código para o **Supabase**, que é quem troca o código por um token |
| Authorized JavaScript origin | `https://devplanetprojectia.github.io` | É a origem da página que inicia o login |

## 4. Habilitar o provedor Google no Supabase

1. No painel do Supabase, abra **Authentication → Sign In / Providers** (em projetos mais
   antigos o item chama **Providers**) e clique em **Google** na lista.
2. Ligue a chave **Enable Sign in with Google**.
3. Cole o **Client ID** e o **Client Secret** do passo 3.3.
4. Confirme que o **Callback URL (for OAuth)** mostrado nessa tela é exatamente o que você
   cadastrou no Google. Se não for, corrija no Google Cloud.
5. Clique em **Save**.

## 5. Cadastrar as URLs de retorno

1. Abra **Authentication → URL Configuration**.
2. Em **Site URL**, informe:

   ```
   https://devplanetprojectia.github.io/3D-Project/
   ```

3. Em **Redirect URLs**, clique em **Add URL** e acrescente o mesmo endereço:

   ```
   https://devplanetprojectia.github.io/3D-Project/
   ```

4. Se você também testa na própria máquina, acrescente `http://localhost:8080/**`.
   O `**` casa com qualquer caminho abaixo daquele endereço.
5. Salve.

Este passo não é opcional. Ao iniciar o login, o site manda um `redirect_to` com a URL da
própria página. O Supabase compara esse valor com a lista de **Redirect URLs**: se não
casar, ele ignora o pedido e joga o navegador na **Site URL** — ou recusa com
`redirect_to not allowed`. Nos dois casos o login não se completa, porque os tokens
chegam numa página que não é a do aplicativo.

Use a URL com a barra no fim e com o mesmo uso de maiúsculas do repositório
(`3D-Project`, não `3d-project`): o caminho do GitHub Pages diferencia as duas coisas.

## 6. Preencher o `config.js`

Abra `config.js` na raiz do repositório e complete o bloco `supabase`:

```js
supabase: {
  url: 'https://abcdefghijklmno.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
},
```

Faça commit e push. O GitHub Pages republica em cerca de um minuto.

A partir daí o site entra em modo Supabase: a tela de login passa a autenticar no
projeto, e o estoque, os orçamentos e os clientes vão para o banco. Os dados que já
estavam no `localStorage` deste navegador continuam lá, mas não sobem sozinhos — refaça
os cadastros ou exporte e importe pelas telas do app.

## 7. Testar e entender os erros

Abra o site publicado, não o arquivo local, e acompanhe o console do navegador
(`F12 → Console`).

1. **Conexão e schema** — em **Configurações** o site faz uma verificação: ele precisa
   reportar o projeto alcançável e o schema aplicado. É o mesmo teste do `healthCheck()`,
   que consulta a tabela `filaments`.
2. **Cadastro por e-mail** — crie uma conta. Com a confirmação de e-mail ligada (padrão
   do Supabase), chega uma mensagem com o link; só depois de clicar nele o login
   funciona. Em **Authentication → Users** o usuário aparece com a data de confirmação.
3. **Login pelo Google** — clique no botão. O Google pede a escolha da conta, volta para
   `https://devplanetprojectia.github.io/3D-Project/` e o site já mostra você conectado.
4. **Perfil criado** — em **Table Editor → profiles** deve existir uma linha com o seu
   `username` e uma cor. Ela é criada pelo gatilho do schema, sem ação do site.
5. **Sincronização** — cadastre um filamento, abra o site em outro computador e entre com
   a mesma conta. O filamento tem de estar lá.

Erros comuns:

| Mensagem | Causa | Correção |
|---|---|---|
| `provider is not enabled` / "O provedor Google não está habilitado" | O provedor Google está desligado no projeto | Passo 4: ligue a chave e salve. Salvar sem o Client ID preenchido não habilita |
| `redirect_to not allowed` (ou o login volta para outra página, sem sessão) | A URL do site não está em **Redirect URLs** | Passo 5. Confira a barra final e as maiúsculas de `3D-Project` |
| `relation "public.filaments" does not exist` / "Tabela ausente no banco" | O `schema.sql` não rodou, ou rodou em outro projeto | Passo 2, no projeto cuja URL está no `config.js` |
| "Confirme o e-mail antes de entrar" | Conta criada, e-mail ainda não confirmado | Clique no link da mensagem. Se ela não chegou, reenvie em **Authentication → Users → … → Send confirmation**; para testes, desligue **Confirm email** em **Authentication → Sign In / Providers → Email** |
| `Error 400: redirect_uri_mismatch` (tela do Google) | O **Authorized redirect URI** no Google não é o callback do Supabase | Passo 3.3, item 6. Copie o valor da tela do provedor no Supabase |
| "Sem permissão para este dado" / `permission denied` | RLS ligado sem as políticas, ou linha gravada sem `user_id` | Rode o `schema.sql` de novo e confira em **Authentication → Policies** |
| `Invalid API key` | `anonKey` truncada ou de outro projeto | Recopie em **Settings → API Keys** |

## O que fica onde

| Conteúdo | Lugar | Observação |
|---|---|---|
| Contas, sessões e perfis | Supabase (`auth.users`, `profiles`) | É a fonte da verdade do login |
| Estoque, produtos, clientes, orçamentos, configurações de custo | Supabase | Uma linha por usuário dono, protegida por RLS |
| Arquivos `.stl` e `.3mf`, miniaturas, `data/catalog.json` | repositório Git, servido pelo Pages | Continua como antes: publicar um modelo é um commit |
| Token do GitHub, logo do orçamento, tema | `localStorage` do navegador | Por dispositivo, nunca sincronizado |

Os arquivos 3D não vão para o Supabase de propósito: o repositório já os versiona e os
entrega pelo CDN do Pages, sem cota de banco nem de banda.

Se o repositório for público, todo modelo publicado é público — o login do Supabase
protege os dados de produção (custos, clientes, orçamentos), não os arquivos.
