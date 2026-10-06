# Publicar sem token por pessoa

Por padrão, cada pessoa precisa cadastrar um token do GitHub para enviar modelos.
Este guia troca isso por **uma função no servidor**: o token fica guardado como
segredo do projeto Supabase, ninguém o manuseia, e qualquer pessoa autenticada
publica normalmente.

Reserve 15 minutos. É preciso instalar uma ferramenta de linha de comando.

---

## Por que não basta colocar o token no `config.js`

Porque o `config.js` é servido ao público: ele chega ao navegador de quem abre o
site. Um token ali é lido por qualquer pessoa pelo código-fonte da página.

E não é só questão de disciplina — o **secret scanning do GitHub** varre
repositórios públicos, encontra o token e o **revoga automaticamente**, em
minutos. A abordagem não é arriscada; ela simplesmente não funciona.

A função resolve isso porque o token nunca sai do servidor. O navegador manda o
arquivo e a sessão de quem está logado; a função confere a sessão e fala com o
GitHub por conta própria.

---

## 1. Pré-requisitos

- O Supabase já configurado no site (ver [SUPABASE.md](SUPABASE.md)).
- Um token do GitHub com permissão de escrita no repositório — **um só**, do
  dono do acervo. Crie em
  [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens/new):
  - *Repository access*: somente este repositório
  - *Permissions → Repository permissions → Contents*: **Read and write**
  - Validade: a maior que sua política permitir, já que a troca exige mexer no servidor

## 2. Instalar a CLI do Supabase

Escolha um:

```bash
# macOS / Linux com Homebrew
brew install supabase/tap/supabase

# Windows com Scoop
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# qualquer sistema, via npx (sem instalar)
npx supabase --version
```

## 3. Entrar e vincular o projeto

```bash
supabase login
```

O navegador abre para autorizar. Depois, na raiz deste repositório:

```bash
supabase link --project-ref eqhxwpgpzseprcmiuaww
```

O *project ref* é a parte da URL do seu projeto antes de `.supabase.co`. Ele
pede a senha do banco, definida quando o projeto foi criado.

## 4. Gravar os segredos

Nenhum destes valores vai para o repositório.

```bash
supabase secrets set \
  GITHUB_TOKEN=github_pat_COLE_O_SEU_AQUI \
  GITHUB_OWNER=DevPlanetProjectIA \
  GITHUB_REPO=3D-Project \
  GITHUB_BRANCH=main
```

Confira com `supabase secrets list` — ele mostra os nomes e um resumo, nunca os
valores.

## 5. Publicar a função

```bash
supabase functions deploy publish
```

Saída esperada: `Deployed Function publish`. A função fica em
`https://<project-ref>.supabase.co/functions/v1/publish`.

## 6. Testar

1. Abra o site e entre na sua conta.
2. Vá em **Configurações → Como a publicação acontece**. Deve aparecer
   *Função de publicação no Supabase — em uso*.
3. Se você tiver um token pessoal cadastrado, **remova-o** para testar a função:
   o token pessoal tem precedência de propósito.
4. Envie um modelo. Em **Enviar modelo** aparece o aviso de que o token não passa
   pelo navegador.
5. Confira o commit no GitHub: a mensagem termina com
   `Publicado por seu@email pela 3D Library.`

---

## O que a função aceita, e o que recusa

O token compartilhado pode escrever em todo o repositório — inclusive no código
do site. A função é a fronteira que impede isso: ela só grava em

| Caminho | Extensões |
|---|---|
| `models/<id>/<arquivo>` | `.stl`, `.3mf`, `.png` |
| `data/catalog.json` | — |

Qualquer outro caminho é recusado com 403, assim como `..`, caminho absoluto e
barra invertida. O teto por arquivo é 45 MB.

## Autoria

Com um token compartilhado, o GitHub atribui todo commit à identidade do dono do
token. Para não perder a trilha, a função acrescenta à mensagem de commit o
e-mail de quem publicou. Se autoria por commit no GitHub for requisito para
você, prefira o token por pessoa.

## Rodando localmente

```bash
supabase functions serve publish --env-file supabase/functions/.env.local
```

Crie o `.env.local` com as mesmas variáveis do passo 4. **Não versione esse
arquivo** — o `.gitignore` do projeto já o ignora.

## Problemas comuns

| Mensagem | Causa | Solução |
|---|---|---|
| *A função de publicação não está implantada* | 404 na URL da função | Rode o passo 5 |
| *Função sem configuração* | Faltam segredos | Rode o passo 4 e reimplante |
| *Entre na sua conta para publicar* | Sessão ausente ou expirada | Entre novamente no site |
| *Caminho não permitido* | Gravação fora de `models/` ou do catálogo | Esperado: é a proteção funcionando |
| *Bad credentials* | Token do GitHub inválido ou revogado | Gere outro e repita o passo 4 |

## Voltar atrás

Para desativar a função sem apagá-la, basta o token pessoal: ele tem
precedência. Para removê-la de vez:

```bash
supabase functions delete publish
supabase secrets unset GITHUB_TOKEN GITHUB_OWNER GITHUB_REPO GITHUB_BRANCH
```
