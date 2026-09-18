-- =====================================================================
-- マル点クラウド　データベースの準備（事務所ログイン）
--
-- Supabase の SQL Editor に全文を貼り付けて Run してください。
-- 何度実行しても壊れません（既にあるものはそのまま残ります）。
--
-- ここで作るもの
--   ・maruten_users   … 事務所アカウント（パスワードは bcrypt で暗号化して保管）
--   ・maruten_setup   … 最初の管理者を登録するための、使い捨ての初期設定コード
--   ・maruten_* 関数  … パスワードの照合や変更。照合はデータベースの中だけで行い、
--                       暗号化したパスワードも外へは一切出さない
--
-- ブラウザ用の鍵（anon / authenticated）からは、テーブルも関数も一切触れません。
-- 使えるのは Cloudflare 側のサーバー処理（service_role の鍵）だけです。
--
-- 最後に表示される「初期設定コード」を控えてください（24時間有効・1回限り）。
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 事務所アカウント
-- ---------------------------------------------------------------------
create table if not exists public.maruten_users (
  id              uuid primary key default gen_random_uuid(),
  login_id        text not null unique,
  name            text not null,
  role            text not null default 'staff',
  pw_hash         text not null,
  active          boolean not null default true,
  must_change     boolean not null default false,
  fail_count      integer not null default 0,
  locked_until    timestamptz,
  session_version integer not null default 1,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint maruten_users_role_chk check (role in ('admin', 'staff')),
  constraint maruten_users_login_chk check (login_id ~ '^[a-z0-9._-]{3,40}$')
);

-- 最初の管理者を登録するための使い捨てコード
create table if not exists public.maruten_setup (
  code       text primary key,
  attempts   integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.maruten_users enable row level security;
alter table public.maruten_setup enable row level security;
revoke all on table public.maruten_users from anon, authenticated;
revoke all on table public.maruten_setup from anon, authenticated;

-- ---------------------------------------------------------------------
-- 記録の置き場（既にあるときは何もしません。新しいSupabaseに移したとき用）
-- ---------------------------------------------------------------------
create table if not exists public.juki_records (
  id         text primary key,
  space      text not null default 'default',
  kind       text not null,
  data       jsonb not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 追加・変更のたびに、データベース側の時刻を打ち直す（差分の取りこぼしを防ぐ）
create or replace function public.juki_records_touch()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists juki_records_touch_trg on public.juki_records;
create trigger juki_records_touch_trg
  before insert or update on public.juki_records
  for each row execute function public.juki_records_touch();

alter table public.juki_records enable row level security;
revoke all on table public.juki_records from anon, authenticated;

-- 現場ごとの読み出しを速くする（記録が増えても遅くならないように）
create index if not exists juki_records_kind_idx
  on public.juki_records (space, kind, updated_at);
create index if not exists juki_records_site_idx
  on public.juki_records ((data->>'siteId'));

-- ---------------------------------------------------------------------
-- 入力の検査（関数の中で共通に使う）
-- ---------------------------------------------------------------------
create or replace function public.maruten_check_input(p_login text, p_name text, p_password text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_login is not null and lower(trim(p_login)) !~ '^[a-z0-9._-]{3,40}$' then
    return 'bad_login';
  end if;
  if p_name is not null and (length(trim(p_name)) = 0 or length(trim(p_name)) > 40) then
    return 'bad_name';
  end if;
  -- bcrypt は先頭72バイトまでしか使わないため、それを超える長さは受け付けない
  if p_password is not null and (length(p_password) < 10 or octet_length(p_password) > 72) then
    return 'bad_password';
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------
-- ログインの照合
--   5回続けて間違えると15分間ロック。存在しないIDでも同じだけ時間をかけ、
--   IDの有無を推測させない。無効化されたアカウントは、パスワードが
--   合っていた場合にだけ「無効」と返す（総当たりで状態を探らせない）。
-- ---------------------------------------------------------------------
create or replace function public.maruten_login(p_login text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  u public.maruten_users%rowtype;
begin
  select * into u from public.maruten_users where login_id = lower(trim(coalesce(p_login, '')));
  if not found then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if u.locked_until is not null and u.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', u.locked_until);
  end if;

  if u.pw_hash <> crypt(coalesce(p_password, ''), u.pw_hash) then
    update public.maruten_users
       set fail_count   = u.fail_count + 1,
           locked_until = case when u.fail_count + 1 >= 5 then now() + interval '15 minutes' else null end,
           updated_at   = now()
     where id = u.id;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if not u.active then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  update public.maruten_users
     set fail_count = 0, locked_until = null, last_login_at = now(), updated_at = now()
   where id = u.id;

  return jsonb_build_object('ok', true, 'user', jsonb_build_object(
    'id', u.id, 'loginId', u.login_id, 'name', u.name, 'role', u.role,
    'sv', u.session_version, 'mustChange', u.must_change));
end
$$;

-- ---------------------------------------------------------------------
-- ログイン中の確認（無効化・権限変更・パスワード変更を即座に反映するため）
-- ---------------------------------------------------------------------
create or replace function public.maruten_session_check(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'id', id, 'loginId', login_id, 'name', name, 'role', role,
    'active', active, 'sv', session_version, 'mustChange', must_change)
    from public.maruten_users
   where id = p_id;
$$;

-- ---------------------------------------------------------------------
-- 初期設定（最初の管理者の登録）
-- ---------------------------------------------------------------------
create or replace function public.maruten_setup_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object('needed', not exists (select 1 from public.maruten_users));
$$;

create or replace function public.maruten_setup_admin(p_code text, p_login text, p_name text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  s public.maruten_setup%rowtype;
  bad text;
  new_id uuid;
begin
  -- 同時に2人が登録しようとしても、管理者が2つできないように順番に処理する
  lock table public.maruten_setup in exclusive mode;

  if exists (select 1 from public.maruten_users) then
    return jsonb_build_object('ok', false, 'reason', 'done');
  end if;

  select * into s from public.maruten_setup order by created_at desc limit 1;
  if not found or s.created_at < now() - interval '24 hours' or s.attempts >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'no_code');
  end if;

  if upper(trim(coalesce(p_code, ''))) <> s.code then
    update public.maruten_setup set attempts = attempts + 1 where code = s.code;
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;

  bad := public.maruten_check_input(coalesce(p_login, ''), coalesce(p_name, ''), coalesce(p_password, ''));
  if bad is not null then
    return jsonb_build_object('ok', false, 'reason', bad);
  end if;

  insert into public.maruten_users (login_id, name, role, pw_hash, last_login_at)
  values (lower(trim(p_login)), trim(p_name), 'admin', crypt(p_password, gen_salt('bf', 10)), now())
  returning id into new_id;

  -- 使い終わったコードを消す。Supabase は WHERE の無い DELETE を禁止しているため、
  -- 必ず条件を付ける（この関数は PostgREST 経由で動くため）
  delete from public.maruten_setup where code = s.code;

  return jsonb_build_object('ok', true, 'user', jsonb_build_object(
    'id', new_id, 'loginId', lower(trim(p_login)), 'name', trim(p_name), 'role', 'admin',
    'sv', 1, 'mustChange', false));
end
$$;

-- ---------------------------------------------------------------------
-- アカウントの管理（管理者の操作。権限の確認はサーバー側で行ってから呼ぶ）
-- ---------------------------------------------------------------------
create or replace function public.maruten_users_list()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'loginId', login_id, 'name', name, 'role', role, 'active', active,
           'mustChange', must_change, 'locked', (locked_until is not null and locked_until > now()),
           'lastLoginAt', last_login_at, 'createdAt', created_at)
           order by created_at), '[]'::jsonb)
    from public.maruten_users;
$$;

create or replace function public.maruten_user_create(p_login text, p_name text, p_role text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  bad text;
  new_id uuid;
begin
  if p_role is null or p_role not in ('admin', 'staff') then
    return jsonb_build_object('ok', false, 'reason', 'bad_role');
  end if;
  bad := public.maruten_check_input(coalesce(p_login, ''), coalesce(p_name, ''), coalesce(p_password, ''));
  if bad is not null then
    return jsonb_build_object('ok', false, 'reason', bad);
  end if;

  begin
    insert into public.maruten_users (login_id, name, role, pw_hash, must_change)
    values (lower(trim(p_login)), trim(p_name), p_role, crypt(p_password, gen_salt('bf', 10)), true)
    returning id into new_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'exists');
  end;

  return jsonb_build_object('ok', true, 'id', new_id);
end
$$;

create or replace function public.maruten_user_update(p_id uuid, p_name text, p_role text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  u public.maruten_users%rowtype;
  bad text;
begin
  select * into u from public.maruten_users where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_role is not null and p_role not in ('admin', 'staff') then
    return jsonb_build_object('ok', false, 'reason', 'bad_role');
  end if;
  bad := public.maruten_check_input(null, p_name, null);
  if bad is not null then
    return jsonb_build_object('ok', false, 'reason', bad);
  end if;

  -- 有効な管理者が1人もいなくなる変更は受け付けない
  if u.role = 'admin' and u.active
     and ((p_role is not null and p_role <> 'admin') or (p_active is not null and not p_active))
     and not exists (select 1 from public.maruten_users
                      where role = 'admin' and active and id <> u.id) then
    return jsonb_build_object('ok', false, 'reason', 'last_admin');
  end if;

  update public.maruten_users
     set name   = coalesce(nullif(trim(p_name), ''), name),
         role   = coalesce(p_role, role),
         active = coalesce(p_active, active),
         -- 権限や有効状態が変わったら、その人のログイン中の端末をすべて締め出す
         session_version = case
           when (p_role is not null and p_role <> role) or (p_active is not null and p_active <> active)
           then session_version + 1 else session_version end,
         updated_at = now()
   where id = u.id;

  return jsonb_build_object('ok', true);
end
$$;

-- 管理者によるパスワードの再発行（次回ログイン時に変更を求める）
create or replace function public.maruten_user_set_password(p_id uuid, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  bad text;
begin
  bad := public.maruten_check_input(null, null, coalesce(p_password, ''));
  if bad is not null then
    return jsonb_build_object('ok', false, 'reason', bad);
  end if;
  update public.maruten_users
     set pw_hash = crypt(p_password, gen_salt('bf', 10)),
         must_change = true,
         fail_count = 0,
         locked_until = null,
         session_version = session_version + 1,
         updated_at = now()
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end
$$;

-- 本人によるパスワード変更（今のパスワードの確認が必要）
create or replace function public.maruten_change_password(p_id uuid, p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  u public.maruten_users%rowtype;
  bad text;
begin
  select * into u from public.maruten_users where id = p_id for update;
  if not found or not u.active then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if u.locked_until is not null and u.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', u.locked_until);
  end if;
  if u.pw_hash <> crypt(coalesce(p_current, ''), u.pw_hash) then
    update public.maruten_users
       set fail_count   = u.fail_count + 1,
           locked_until = case when u.fail_count + 1 >= 5 then now() + interval '15 minutes' else null end,
           updated_at   = now()
     where id = u.id;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  bad := public.maruten_check_input(null, null, coalesce(p_new, ''));
  if bad is not null then
    return jsonb_build_object('ok', false, 'reason', bad);
  end if;
  if p_new = p_current then
    return jsonb_build_object('ok', false, 'reason', 'same_password');
  end if;

  update public.maruten_users
     set pw_hash = crypt(p_new, gen_salt('bf', 10)),
         must_change = false,
         fail_count = 0,
         locked_until = null,
         session_version = session_version + 1,
         updated_at = now()
   where id = u.id;

  return jsonb_build_object('ok', true, 'sv', u.session_version + 1);
end
$$;

-- ---------------------------------------------------------------------
-- 関数を呼べるのはサーバー処理（service_role）だけにする
-- （Supabase は新しい関数を誰でも呼べる状態で作るため、必ず取り消す）
-- ---------------------------------------------------------------------
revoke all on function public.maruten_check_input(text, text, text)            from public, anon, authenticated;
revoke all on function public.maruten_login(text, text)                        from public, anon, authenticated;
revoke all on function public.maruten_session_check(uuid)                      from public, anon, authenticated;
revoke all on function public.maruten_setup_status()                           from public, anon, authenticated;
revoke all on function public.maruten_setup_admin(text, text, text, text)      from public, anon, authenticated;
revoke all on function public.maruten_users_list()                             from public, anon, authenticated;
revoke all on function public.maruten_user_create(text, text, text, text)      from public, anon, authenticated;
revoke all on function public.maruten_user_update(uuid, text, text, boolean)   from public, anon, authenticated;
revoke all on function public.maruten_user_set_password(uuid, text)            from public, anon, authenticated;
revoke all on function public.maruten_change_password(uuid, text, text)        from public, anon, authenticated;

grant execute on function public.maruten_check_input(text, text, text)          to service_role;
grant execute on function public.maruten_login(text, text)                      to service_role;
grant execute on function public.maruten_session_check(uuid)                    to service_role;
grant execute on function public.maruten_setup_status()                         to service_role;
grant execute on function public.maruten_setup_admin(text, text, text, text)    to service_role;
grant execute on function public.maruten_users_list()                           to service_role;
grant execute on function public.maruten_user_create(text, text, text, text)    to service_role;
grant execute on function public.maruten_user_update(uuid, text, text, boolean) to service_role;
grant execute on function public.maruten_user_set_password(uuid, text)          to service_role;
grant execute on function public.maruten_change_password(uuid, text, text)      to service_role;

-- ---------------------------------------------------------------------
-- 初期設定コードの発行（管理者がまだいない場合だけ）
-- ---------------------------------------------------------------------
delete from public.maruten_setup where created_at < now() - interval '24 hours' or attempts >= 10;

insert into public.maruten_setup (code)
select upper(encode(extensions.gen_random_bytes(6), 'hex'))
 where not exists (select 1 from public.maruten_users)
   and not exists (select 1 from public.maruten_setup);

-- 作った関数をすぐ使えるようにする
notify pgrst, 'reload schema';

select case
  when exists (select 1 from public.maruten_users)
    then '準備完了：管理者は登録済みです（初期設定コードは不要です）'
  else '準備完了：初期設定コード　' || (select code from public.maruten_setup order by created_at desc limit 1)
       || '　（24時間有効・1回限り）'
end as "結果";
