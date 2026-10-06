-- =====================================================================
-- 3D Library — schema do Supabase
--
-- Cole este arquivo inteiro em SQL Editor -> New query e clique em Run.
-- Ele é idempotente: rodar duas (ou dez) vezes não dá erro e não duplica
-- nada. Use-o também para atualizar um projeto já criado.
--
-- SOBRE A CHAVE `anon`
-- A chave `anon public` que vai em `config.js` é pública por natureza:
-- ela viaja no JavaScript do site e qualquer visitante pode lê-la. Isso é
-- esperado. Quem protege os dados NÃO é a chave, é o RLS (Row Level
-- Security) definido aqui: cada política amarra a linha ao `auth.uid()`
-- do dono, então a chave anônima sozinha não lê nem escreve nada de
-- ninguém. A chave `service_role` ignora RLS — ela nunca deve aparecer
-- no site, só em um servidor.
--
-- Os nomes de tabela abaixo são os mesmos usados em
-- `assets/js/supabase.js` (ex.: `select('filaments', ...)`). Renomear uma
-- tabela aqui quebra o cliente.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Extensões
--
-- `gen_random_uuid()` vem da pgcrypto. Em projetos novos do Supabase ela
-- já está ativa; o `if not exists` cobre os antigos.
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
-- 1. Função de `updated_at`
--
-- Um gatilho por tabela chama esta função antes de cada UPDATE e repõe o
-- carimbo de tempo. Evita depender do cliente mandar o campo certo.
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. profiles — dados de perfil que o app mostra
--
-- Chaveada pelo próprio `id` do usuário em `auth.users`: um perfil por
-- conta, sem coluna `user_id` redundante. Os campos espelham o usuário
-- local de `assets/js/auth.js` (username, bio, color, favorites, role).
-- `favorites` guarda ids de modelos do catálogo.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text,
  bio         text,
  color       text,
  favorites   text[]      default '{}',
  role        text        default 'member',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);


-- ---------------------------------------------------------------------
-- 3. filaments — estoque de filamento
--
-- Uma coluna por campo de `normalize()` em `assets/js/inventory.js`, com
-- os nomes em snake_case (PostgREST devolve exatamente estes nomes).
-- `spool_weight`/`spool_price` são por rolo; `remaining` é o saldo em
-- gramas; `density` em g/cm³.
-- ---------------------------------------------------------------------
create table if not exists public.filaments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  material     text,
  hex          text,
  color_label  text,
  brand        text,
  nickname     text,
  spools       numeric,
  spool_weight numeric,
  spool_price  numeric,
  remaining    numeric,
  density      numeric,
  name         text,
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);


-- ---------------------------------------------------------------------
-- 4. supplies — insumos (cola, embalagem, imã, parafuso…)
--
-- `qty` na unidade de `unit`; `unit_price` é o preço de uma unidade.
-- ---------------------------------------------------------------------
create table if not exists public.supplies (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text,
  qty        numeric,
  unit       text,
  unit_price numeric,
  notes      text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- ---------------------------------------------------------------------
-- 5. products — produtos prontos
--
-- `cost` é o custo apurado e `price` o preço de venda. `weight` em gramas
-- e `print_hours` em horas servem para recalcular o custo na calculadora.
-- `model_id` liga o produto a um modelo do `data/catalog.json`.
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text,
  qty         numeric,
  unit        text,
  cost        numeric,
  price       numeric,
  weight      numeric,
  print_hours numeric,
  model_id    text,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);


-- ---------------------------------------------------------------------
-- 6. clients — carteira de clientes usada nos orçamentos
-- `doc` é CPF ou CNPJ, guardado como texto (zeros à esquerda importam).
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text,
  phone      text,
  email      text,
  doc        text,
  notes      text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- ---------------------------------------------------------------------
-- 7. quotes — histórico de orçamentos
--
-- Substitui a chave `quotes` do localStorage (ver `saveToHistory()` em
-- `assets/js/views/quote.js`). As colunas soltas são só para listar e
-- buscar; o formulário inteiro (itens, descontos, frete, validade,
-- observações) vai em `payload` jsonb, que aceita mudanças de formato sem
-- migração. A logo continua fora: ela é base64 pesado e vive na chave
-- própria do navegador.
-- ---------------------------------------------------------------------
create table if not exists public.quotes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  number      text,
  client_name text,
  total       numeric,
  currency    text,
  payload     jsonb,
  quote_date  date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);


-- ---------------------------------------------------------------------
-- 8. cost_settings — uma linha por usuário
--
-- Equivale a `DEFAULTS` + `getSettings()` de `assets/js/costing.js`. Fica
-- em jsonb de propósito: a lista de parâmetros (kwhPrice, watts, markup,
-- failureRate, purgeRate, channel, studioName, pix…) muda com o tempo e
-- não vale uma coluna cada. O padrão `{}` faz o cliente cair nos
-- `DEFAULTS` do JavaScript quando o campo está vazio.
-- ---------------------------------------------------------------------
create table if not exists public.cost_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  settings   jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- ---------------------------------------------------------------------
-- 9. Índices
--
-- Toda consulta do app filtra por dono (`?user_id=eq.<uuid>`), e o RLS
-- acrescenta o mesmo filtro por conta própria. Um índice por `user_id`
-- resolve as duas coisas. `profiles` e `cost_settings` não entram: a
-- chave primária já é o usuário.
-- ---------------------------------------------------------------------
create index if not exists filaments_user_id_idx on public.filaments (user_id);
create index if not exists supplies_user_id_idx  on public.supplies  (user_id);
create index if not exists products_user_id_idx  on public.products  (user_id);
create index if not exists clients_user_id_idx   on public.clients   (user_id);
create index if not exists quotes_user_id_idx    on public.quotes    (user_id);

-- Ordenações mais comuns das listas.
create index if not exists quotes_user_date_idx on public.quotes (user_id, quote_date desc);


-- ---------------------------------------------------------------------
-- 10. Gatilhos de `updated_at`
--
-- `drop trigger if exists` antes de cada `create trigger` é o que torna
-- este bloco repetível — não existe `create trigger if not exists`.
-- ---------------------------------------------------------------------
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists filaments_set_updated_at on public.filaments;
create trigger filaments_set_updated_at
  before update on public.filaments
  for each row execute function public.set_updated_at();

drop trigger if exists supplies_set_updated_at on public.supplies;
create trigger supplies_set_updated_at
  before update on public.supplies
  for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

drop trigger if exists cost_settings_set_updated_at on public.cost_settings;
create trigger cost_settings_set_updated_at
  before update on public.cost_settings
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 11. Perfil automático para cada novo usuário
--
-- Dispara em qualquer entrada nova em `auth.users`, venha do Google ou do
-- cadastro por e-mail/senha. O `username` sai, nessa ordem, de:
--   1. `raw_user_meta_data->>'username'`  (cadastro por e-mail do site)
--   2. `raw_user_meta_data->>'full_name'` (nome que o Google devolve)
--   3. a parte antes do @ do e-mail
--
-- `color` é derivada de forma estável do nome: o mesmo nome gera sempre a
-- mesma cor, no formato `hsl(H 58% 48%)` que a interface já usa
-- (`colorFor()` em `assets/js/util.js`). A matiz vem dos 4 primeiros
-- dígitos hexadecimais do md5, módulo 360.
--
-- `security definer` + `search_path` fixo: a função precisa escrever em
-- `public.profiles` rodando no contexto de `auth`, e o caminho travado
-- evita que um objeto plantado em outro schema seja chamado no lugar.
--
-- `on conflict do nothing` deixa a função segura para reexecução.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_username text;
  hue               int;
begin
  resolved_username := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'usuario'
  );

  hue := ('x' || substr(md5(resolved_username), 1, 4))::bit(16)::int % 360;

  insert into public.profiles (id, username, bio, color, favorites, role)
  values (
    new.id,
    resolved_username,
    '',
    format('hsl(%s 58%% 48%%)', hue),
    '{}',
    'member'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Preenche o perfil de quem já tinha conta antes deste schema rodar.
insert into public.profiles (id, username, bio, color, favorites, role)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'username'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'usuario'
  ),
  '',
  format(
    'hsl(%s 58%% 48%%)',
    ('x' || substr(md5(coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'username'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'usuario'
    )), 1, 4))::bit(16)::int % 360
  ),
  '{}',
  'member'
from auth.users u
on conflict (id) do nothing;


-- =====================================================================
-- 12. RLS — Row Level Security
--
-- Sem isto, a chave `anon` leria o banco inteiro. Com isto, cada
-- requisição só alcança as linhas cujo dono é o usuário do token.
--
-- São quatro políticas por tabela (select, insert, update, delete) em vez
-- de uma única `for all`: assim fica explícito o que cada operação
-- permite, e dá para afrouxar uma sem mexer nas outras.
--
-- `using` filtra as linhas que a operação enxerga; `with check` valida as
-- linhas que ela grava — é o `with check` que impede alguém de inserir
-- uma linha com o `user_id` de outra pessoa.
--
-- `to authenticated` restringe as políticas a quem tem sessão: visitante
-- anônimo não entra em nenhuma delas.
--
-- `drop policy if exists` antes de cada `create policy` mantém o bloco
-- repetível (não existe `create policy if not exists`).
-- =====================================================================

alter table public.profiles      enable row level security;
alter table public.filaments     enable row level security;
alter table public.supplies      enable row level security;
alter table public.products      enable row level security;
alter table public.clients       enable row level security;
alter table public.quotes        enable row level security;
alter table public.cost_settings enable row level security;


-- ---------------------------------------------------------------------
-- 12.1 profiles — a identidade é o próprio `id`, então o teste é
-- `auth.uid() = id`. Não há política de delete: o perfil morre junto com
-- a conta, pelo `on delete cascade`.
-- ---------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated
  using (auth.uid() = id);


-- ---------------------------------------------------------------------
-- 12.2 filaments
-- ---------------------------------------------------------------------
drop policy if exists "filaments_select_own" on public.filaments;
create policy "filaments_select_own" on public.filaments
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "filaments_insert_own" on public.filaments;
create policy "filaments_insert_own" on public.filaments
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "filaments_update_own" on public.filaments;
create policy "filaments_update_own" on public.filaments
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "filaments_delete_own" on public.filaments;
create policy "filaments_delete_own" on public.filaments
  for delete to authenticated
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 12.3 supplies
-- ---------------------------------------------------------------------
drop policy if exists "supplies_select_own" on public.supplies;
create policy "supplies_select_own" on public.supplies
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "supplies_insert_own" on public.supplies;
create policy "supplies_insert_own" on public.supplies
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "supplies_update_own" on public.supplies;
create policy "supplies_update_own" on public.supplies
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "supplies_delete_own" on public.supplies;
create policy "supplies_delete_own" on public.supplies
  for delete to authenticated
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 12.4 products
-- ---------------------------------------------------------------------
drop policy if exists "products_select_own" on public.products;
create policy "products_select_own" on public.products
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own" on public.products
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "products_update_own" on public.products;
create policy "products_update_own" on public.products
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own" on public.products
  for delete to authenticated
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 12.5 clients
-- ---------------------------------------------------------------------
drop policy if exists "clients_select_own" on public.clients;
create policy "clients_select_own" on public.clients
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "clients_insert_own" on public.clients;
create policy "clients_insert_own" on public.clients
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "clients_update_own" on public.clients;
create policy "clients_update_own" on public.clients
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "clients_delete_own" on public.clients;
create policy "clients_delete_own" on public.clients
  for delete to authenticated
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 12.6 quotes
-- ---------------------------------------------------------------------
drop policy if exists "quotes_select_own" on public.quotes;
create policy "quotes_select_own" on public.quotes
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "quotes_insert_own" on public.quotes;
create policy "quotes_insert_own" on public.quotes
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "quotes_update_own" on public.quotes;
create policy "quotes_update_own" on public.quotes
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "quotes_delete_own" on public.quotes;
create policy "quotes_delete_own" on public.quotes
  for delete to authenticated
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 12.7 cost_settings — a chave primária é o usuário, então o teste é
-- `auth.uid() = user_id` sobre a própria PK. O cliente grava com upsert
-- em `user_id`, o que exige as políticas de insert e update juntas.
-- ---------------------------------------------------------------------
drop policy if exists "cost_settings_select_own" on public.cost_settings;
create policy "cost_settings_select_own" on public.cost_settings
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "cost_settings_insert_own" on public.cost_settings;
create policy "cost_settings_insert_own" on public.cost_settings
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "cost_settings_update_own" on public.cost_settings;
create policy "cost_settings_update_own" on public.cost_settings
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cost_settings_delete_own" on public.cost_settings;
create policy "cost_settings_delete_own" on public.cost_settings
  for delete to authenticated
  using (auth.uid() = user_id);


-- =====================================================================
-- 13. Conferência rápida
--
-- Depois do Run, as duas consultas abaixo devem listar as 7 tabelas com
-- `rowsecurity = true` e as políticas criadas. Se alguma tabela aparecer
-- com RLS desligado, não publique a `anonKey` antes de resolver.
--
--   select tablename, rowsecurity
--     from pg_tables where schemaname = 'public' order by tablename;
--
--   select tablename, policyname, cmd
--     from pg_policies where schemaname = 'public' order by tablename, cmd;
-- =====================================================================
