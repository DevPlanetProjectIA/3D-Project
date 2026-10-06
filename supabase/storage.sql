-- =============================================================================
-- 3D Library — acervo no Supabase Storage
--
-- Cole TUDO no SQL Editor do projeto e clique em Run. Pode rodar mais de uma
-- vez sem efeito colateral.
--
-- O que isto cria:
--   1. o bucket `modelos`, com leitura pública e teto de 50 MB por arquivo;
--   2. as políticas que deixam qualquer pessoa BAIXAR e só quem está
--      autenticado ENVIAR, cada um na sua pasta;
--   3. a tabela `models`, que é o catálogo da biblioteca.
--
-- Depois disto, enviar modelo não precisa de token do GitHub, nem de Edge
-- Function, nem de CLI. Basta estar logado no site.
--
-- A chave `anon` continua pública: quem protege os dados são estas políticas.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Bucket
--
-- `public = true` libera a leitura dos arquivos por URL direta, que é o que
-- permite ao visualizador 3D buscar os bytes e ao visitante baixar a peça sem
-- ter conta. O teto de 50 MB é o do plano gratuito.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('modelos', 'modelos', true, 52428800)
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800;


-- -----------------------------------------------------------------------------
-- 2. Políticas do bucket
--
-- A escrita é restrita à pasta de cada pessoa: o primeiro nível do caminho tem
-- de ser o id da conta. Isso é checado por `storage.foldername(name)`, e não
-- pela coluna de dono, cujo nome mudou entre versões do Supabase — depender
-- dela quebraria este script em metade dos projetos.
--
-- Resultado: ninguém sobrescreve nem apaga arquivo de outra pessoa.
-- -----------------------------------------------------------------------------

drop policy if exists "modelos: leitura publica" on storage.objects;
create policy "modelos: leitura publica"
  on storage.objects for select
  using (bucket_id = 'modelos');

drop policy if exists "modelos: envio na propria pasta" on storage.objects;
create policy "modelos: envio na propria pasta"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'modelos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "modelos: troca na propria pasta" on storage.objects;
create policy "modelos: troca na propria pasta"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'modelos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "modelos: remocao na propria pasta" on storage.objects;
create policy "modelos: remocao na propria pasta"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'modelos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- -----------------------------------------------------------------------------
-- 3. Catálogo
--
-- Substitui o `data/catalog.json` versionado no Git. Os modelos que já estiverem
-- no repositório continuam aparecendo: o site lê as duas fontes e junta.
-- -----------------------------------------------------------------------------

create table if not exists public.models (
  id             text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  author         text not null default '',

  name           text not null,
  description    text not null default '',
  format         text not null default 'stl',
  tags           text[] not null default '{}',

  -- Caminhos dentro do bucket `modelos`, não URLs: a URL é montada na hora e
  -- sobrevive a troca de domínio do projeto.
  file_path      text not null,
  thumb_path     text not null default '',
  size           bigint not null default 0,

  triangles      integer not null default 0,
  dim_x          numeric not null default 0,
  dim_y          numeric not null default 0,
  dim_z          numeric not null default 0,

  -- Produção, apurada no envio.
  printer_id     text not null default '',
  weight_grams   numeric not null default 0,
  purge_grams    numeric not null default 0,
  print_seconds  integer not null default 0,
  cost_brl       numeric not null default 0,
  price_brl      numeric not null default 0,
  weight_source  text not null default 'estimativa',
  filaments      jsonb not null default '[]'::jsonb,
  print_settings jsonb not null default '{}'::jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists models_user_id_idx    on public.models (user_id);
create index if not exists models_created_at_idx on public.models (created_at desc);
create index if not exists models_author_idx     on public.models (author);
create index if not exists models_tags_idx       on public.models using gin (tags);

alter table public.models enable row level security;

-- A biblioteca é compartilhada e o bucket é público: esconder a listagem não
-- protegeria nada e só quebraria o modo visitante.
drop policy if exists "models: leitura publica" on public.models;
create policy "models: leitura publica"
  on public.models for select
  using (true);

drop policy if exists "models: insercao do dono" on public.models;
create policy "models: insercao do dono"
  on public.models for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "models: alteracao do dono" on public.models;
create policy "models: alteracao do dono"
  on public.models for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "models: remocao do dono" on public.models;
create policy "models: remocao do dono"
  on public.models for delete
  to authenticated
  using (auth.uid() = user_id);

-- `updated_at` automático, reaproveitando o gatilho do schema principal quando
-- ele existir.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists models_set_updated_at on public.models;
    create trigger models_set_updated_at
      before update on public.models
      for each row execute function public.set_updated_at();
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Conferência — a consulta abaixo deve devolver uma linha com tudo `true`.
-- -----------------------------------------------------------------------------

select
  (select count(*) from storage.buckets where id = 'modelos' and public) = 1          as bucket_ok,
  (select count(*) from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'modelos:%') = 4                                           as politicas_bucket_ok,
  (select count(*) from pg_tables
     where schemaname = 'public' and tablename = 'models') = 1                        as tabela_ok,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'models') = 4                        as politicas_tabela_ok;
