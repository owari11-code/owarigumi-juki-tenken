-- =====================================================================
-- GENBA ONE by OWR　ログインできないときの救済
--
-- 使い方：Supabase の管理画面 → SQL Editor に、必要な部分だけ貼って Run。
--         この操作ができるのは、Supabase にログインできる人だけです。
--         アプリ側（インターネット側）からは、ここの関数は一切呼べません。
--
--   ① IDが分からない          → 「１．登録されているアカウントを見る」
--   ② パスワードが分からない  → 「２．仮パスワードを発行する」
--   ③ 管理者権限が無くなった  → 「３．管理者に戻す」
--   ④ アカウントが1つも無い    → 「４．初期設定をやり直す」
--
-- ※パスワードは暗号化して保存しており、元の文字に戻すことはできません。
--   「思い出す」のではなく「新しいものに作り直す」形になります。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 準備：仮パスワードを発行する関数（1回だけ実行すれば、以後は使い回せます）
--   ・呼び出せるのは、この SQL Editor（postgres）だけ
--   ・アプリのサーバー処理（service_role）からも呼べないようにしています
-- ---------------------------------------------------------------------
create or replace function public.maruten_reset_password(p_login text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  u    public.maruten_users%rowtype;
  temp text;
begin
  select * into u
    from public.maruten_users
   where login_id = lower(trim(coalesce(p_login, '')));

  if not found then
    return 'そのIDはありません：' || coalesce(p_login, '(空)') ||
           '　／　登録されているID：' ||
           coalesce((select string_agg(login_id, ' , ' order by created_at)
                       from public.maruten_users), 'なし');
  end if;

  -- 読み間違えない文字だけ（0〜9 と A〜F）で作る
  temp := upper(encode(extensions.gen_random_bytes(3), 'hex')) || '-' ||
          upper(encode(extensions.gen_random_bytes(3), 'hex')) || '-' ||
          upper(encode(extensions.gen_random_bytes(3), 'hex'));

  update public.maruten_users
     set pw_hash         = crypt(temp, gen_salt('bf', 10)),
         must_change     = true,          -- 次のログインで本人に決め直してもらう
         active          = true,          -- 無効にしていた場合は有効に戻す
         fail_count      = 0,
         locked_until    = null,          -- ロックも解除する
         session_version = session_version + 1,  -- 他の端末のログインは切る
         updated_at      = now()
   where id = u.id;

  return 'ID：' || u.login_id || '（' || u.name || '）' ||
         '　仮パスワード：' || temp ||
         '　←　このパスワードでログインし、画面の案内どおり新しいパスワードを決めてください';
end
$$;

revoke all on function public.maruten_reset_password(text) from public;
revoke all on function public.maruten_reset_password(text) from anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- １．登録されているアカウントを見る（IDを忘れたとき）
-- ---------------------------------------------------------------------
select login_id                                        as "ID",
       name                                            as "氏名",
       case when role = 'admin' then '管理者' else '社員' end as "権限",
       case when active then '有効' else '無効' end     as "状態",
       case when locked_until > now()
            then to_char(locked_until, 'HH24:MI') || ' までロック中'
            else '' end                                as "ロック",
       to_char(last_login_at, 'YYYY/MM/DD HH24:MI')    as "最終ログイン"
  from public.maruten_users
 order by created_at;


-- ---------------------------------------------------------------------
-- ２．仮パスワードを発行する（パスワードを忘れたとき）
--     'owari11' の部分を、自分のIDに書き換えて実行してください。
-- ---------------------------------------------------------------------
-- select public.maruten_reset_password('owari11') as "結果";


-- ---------------------------------------------------------------------
-- ３．管理者に戻す（管理者が1人もいなくなったとき）
--     'owari11' の部分を、管理者にしたい人のIDに書き換えて実行してください。
-- ---------------------------------------------------------------------
-- update public.maruten_users
--    set role = 'admin', active = true,
--        session_version = session_version + 1, updated_at = now()
--  where login_id = 'owari11';


-- ---------------------------------------------------------------------
-- ４．初期設定をやり直す（アカウントが1つも無いとき）
--     最初の管理者を作り直すための「初期設定コード」を出します。
--     アカウントが1つでも残っている場合、初期設定の画面は使えません。
--     その場合は ２．で仮パスワードを発行してください。
-- ---------------------------------------------------------------------
-- delete from public.maruten_setup where code is not null;
-- insert into public.maruten_setup (code)
-- select upper(encode(extensions.gen_random_bytes(6), 'hex'))
--  where not exists (select 1 from public.maruten_users);
-- select coalesce((select code from public.maruten_setup order by created_at desc limit 1),
--                 'アカウントが残っているため、初期設定はできません（２．をお使いください）') as "初期設定コード";
