/*
 * auth.js - 事務所のログイン・ログアウト・パスワード変更・初期設定
 *
 * パスワードの照合と保管はデータベースの中（bcrypt）で行う。
 * このサーバー処理はパスワードを受け渡すだけで、覚えも記録もしない。
 */
import { json, fail, checkOrigin, readJson, setCookie, clearCookie, isPlainObject, str } from '../lib/http.js';
import { configured, rpc, dbFailure } from '../lib/db.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { ADMIN_COOKIE, adminFromRequest, issueAdminToken, forgetUser } from '../lib/session.js';

const REASONS = {
  invalid: [401, 'invalid_login', 'IDまたはパスワードが違います。'],
  locked: [423, 'locked', '続けて間違えたため、しばらくログインできません。15分ほど待ってからお試しください。'],
  inactive: [403, 'inactive', 'このアカウントは使えなくなっています。管理者にご確認ください。'],
  bad_login: [400, 'bad_login', 'IDは半角の英小文字・数字・記号（. _ -）で3〜40文字にしてください。'],
  bad_name: [400, 'bad_name', '氏名を入力してください（40文字まで）。'],
  bad_password: [400, 'bad_password', 'パスワードは10文字以上にしてください。'],
  same_password: [400, 'same_password', '今と同じパスワードは使えません。'],
  bad_code: [403, 'bad_code', '初期設定コードが違います。'],
  no_code: [403, 'no_code', '初期設定コードが無効です。SupabaseでSQLをもう一度実行して、新しいコードを発行してください。'],
  done: [409, 'setup_done', '管理者は登録済みです。ログインしてください。'],
  not_found: [404, 'not_found', 'アカウントが見つかりません。']
};

function reasonFail(reason) {
  const r = REASONS[reason] || [400, 'failed', '処理できませんでした。'];
  return fail(r[0], r[1], r[2]);
}

function ready(env) {
  if (!configured(env)) return fail(503, 'not_configured', 'サーバー側の接続設定が未完了です。');
  if (!env.SESSION_SECRET) return fail(503, 'no_session_secret', 'サーバー側の設定（SESSION_SECRET）が未完了です。');
  return null;
}

function userView(u) {
  return { id: u.id, loginId: u.loginId, name: u.name, role: u.role, mustChange: !!u.mustChange };
}

async function loggedIn(env, user, remember) {
  const { token, maxAge } = await issueAdminToken(env, user, remember);
  return json({ ok: true, user: userView(user) }, 200, { 'set-cookie': setCookie(ADMIN_COOKIE, token, maxAge) });
}

/* GET /api/auth/me */
export async function me({ request, env }) {
  const notReady = ready(env);
  if (notReady) return notReady;
  try {
    const user = await adminFromRequest(request, env);
    if (!user) return fail(401, 'no_login', 'ログインしていません。');
    return json({ user: userView(user) });
  } catch (e) {
    const f = dbFailure(e);
    return fail(f.status, f.code, f.message);
  }
}

/* POST /api/auth/login  { loginId, password, token, remember } */
export async function login({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const notReady = ready(env);
  if (notReady) return notReady;

  const { value: body, error } = await readJson(request, 4096);
  if (error) return error;
  if (!isPlainObject(body)) return fail(400, 'bad_shape', '形式が正しくありません。');
  const loginId = str(body.loginId, 64);
  const password = str(body.password, 200);
  if (!loginId || !password) return reasonFail('invalid');

  const ts = await verifyTurnstile(request, env, body.token);
  if (!ts.ok) return fail(403, ts.code, ts.message);

  try {
    const res = await rpc(env, 'maruten_login', { p_login: loginId, p_password: password });
    if (!res || !res.ok) return reasonFail(res && res.reason);
    forgetUser(res.user.id);
    return loggedIn(env, res.user, body.remember === true);
  } catch (e) {
    const f = dbFailure(e);
    return fail(f.status, f.code, f.message);
  }
}

/* POST /api/auth/logout */
export async function logout({ request }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  return json({ ok: true }, 200, { 'set-cookie': clearCookie(ADMIN_COOKIE) });
}

/* POST /api/auth/password  { current, next } */
export async function changePassword({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const notReady = ready(env);
  if (notReady) return notReady;

  const { value: body, error } = await readJson(request, 4096);
  if (error) return error;
  if (!isPlainObject(body)) return fail(400, 'bad_shape', '形式が正しくありません。');
  const current = str(body.current, 200);
  const next = str(body.next, 200);
  if (!current || !next) return reasonFail('invalid');

  try {
    const user = await adminFromRequest(request, env);
    if (!user) return fail(401, 'no_login', 'ログインしていません。');
    const res = await rpc(env, 'maruten_change_password', { p_id: user.id, p_current: current, p_new: next });
    if (!res || !res.ok) return reasonFail(res && res.reason);
    forgetUser(user.id);
    // パスワードを変えたら、ほかの端末のログインは切れる。この端末だけ入り直させる
    return loggedIn(env, { ...user, sv: res.sv, mustChange: false }, user.remember);
  } catch (e) {
    const f = dbFailure(e);
    return fail(f.status, f.code, f.message);
  }
}

/* GET /api/auth/setup */
export async function setupStatus({ env }) {
  const notReady = ready(env);
  if (notReady) return notReady;
  try {
    const res = await rpc(env, 'maruten_setup_status', {});
    return json({ needed: !!(res && res.needed) });
  } catch (e) {
    const f = dbFailure(e);
    return fail(f.status, f.code, f.message);
  }
}

/* POST /api/auth/setup  { code, loginId, name, password, token } */
export async function setup({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const notReady = ready(env);
  if (notReady) return notReady;

  const { value: body, error } = await readJson(request, 4096);
  if (error) return error;
  if (!isPlainObject(body)) return fail(400, 'bad_shape', '形式が正しくありません。');
  const code = str(body.code, 64);
  const loginId = str(body.loginId, 64);
  const name = str(body.name, 64);
  const password = str(body.password, 200);
  if (!code) return reasonFail('bad_code');
  if (!loginId) return reasonFail('bad_login');
  if (!name) return reasonFail('bad_name');
  if (!password) return reasonFail('bad_password');

  const ts = await verifyTurnstile(request, env, body.token);
  if (!ts.ok) return fail(403, ts.code, ts.message);

  try {
    const res = await rpc(env, 'maruten_setup_admin', {
      p_code: code, p_login: loginId, p_name: name, p_password: password
    });
    if (!res || !res.ok) return reasonFail(res && res.reason);
    return loggedIn(env, res.user, false);
  } catch (e) {
    const f = dbFailure(e);
    return fail(f.status, f.code, f.message);
  }
}
