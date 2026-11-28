-- ============================================================
-- Lingua Reader: база данных для Supabase
-- Supabase → SQL Editor → New query → вставить ВЕСЬ файл → Run
-- Можно запускать повторно: ничего не сломается.
-- ============================================================

-- ---------- Данные пользователя (книги, слова, заметки, закладки, настройки) ----------
create table if not exists public.items (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('book','word','note','mark','set','day')),
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
-- вид 'day' (статистика по дням) появился позже: обновляем проверку и в уже созданной таблице
alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check check (kind in ('book','word','note','mark','set','day'));
alter table public.items enable row level security;
grant select, insert, update, delete on public.items to authenticated;
revoke all on public.items from anon;
drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- время изменения ставит сервер: устройства с неточными часами не путают синхронизацию
create or replace function public.items_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items for each row execute function public.items_touch();
-- сайт забирает только изменённое с прошлого раза
create index if not exists items_user_updated on public.items (user_id, updated_at);

-- ---------- Журнал ошибок: сайт только записывает, читать можно в панели Supabase (Table Editor → errors) ----------
create table if not exists public.errors (
  id      bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  ver     int, place text, msg text, stack text, ua text, screen text
);
alter table public.errors enable row level security;
revoke all on public.errors from anon, authenticated;
grant insert on public.errors to authenticated;
drop policy if exists "errors insert own" on public.errors;
create policy "errors insert own" on public.errors for insert to authenticated with check (user_id = (select auth.uid()));

-- ---------- Ключи API: браузер не может их прочитать ----------
create table if not exists public.user_secrets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  api_key    text not null,
  updated_at timestamptz not null default now()
);
alter table public.user_secrets enable row level security;
revoke all on public.user_secrets from anon, authenticated;

-- ---------- Счётчик запросов в день ----------
create table if not exists public.usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default current_date,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.usage enable row level security;
revoke all on public.usage from anon, authenticated;

-- ---------- Функции для ключа: записать, узнать последние 4 символа, удалить ----------
create or replace function public.set_api_key(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_key is null or length(trim(p_key)) < 10 then raise exception 'bad key'; end if;
  insert into public.user_secrets(user_id, api_key) values (auth.uid(), trim(p_key))
  on conflict (user_id) do update set api_key = excluded.api_key, updated_at = now();
end $$;

create or replace function public.get_key_status()
returns table(last4 text) language sql security definer set search_path = public as $$
  select right(api_key, 4) from public.user_secrets where user_id = auth.uid();
$$;

create or replace function public.delete_api_key()
returns void language sql security definer set search_path = public as $$
  delete from public.user_secrets where user_id = auth.uid();
$$;

revoke all on function public.set_api_key(text)  from public, anon;
revoke all on function public.get_key_status()   from public, anon;
revoke all on function public.delete_api_key()   from public, anon;
grant execute on function public.set_api_key(text) to authenticated;
grant execute on function public.get_key_status()  to authenticated;
grant execute on function public.delete_api_key()  to authenticated;

create or replace function public.bump_usage(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into public.usage(user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.usage.count + 1
  returning count into c;
  return c;
end $$;
revoke all on function public.bump_usage(uuid) from public, anon, authenticated;
grant execute on function public.bump_usage(uuid) to service_role;

-- ---------- Хранилище файлов книг: приватное, у каждого своя папка ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('books', 'books', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "books read own"   on storage.objects;
drop policy if exists "books insert own" on storage.objects;
drop policy if exists "books update own" on storage.objects;
drop policy if exists "books delete own" on storage.objects;
create policy "books read own"   on storage.objects for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "books insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "books update own" on storage.objects for update to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "books delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
