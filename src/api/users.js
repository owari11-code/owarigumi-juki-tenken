/*
 * users.js - 事務所アカウントの管理（管理者だけ）
 */
import { json, fail, checkOrigin, readJson, isPlainObject, str } from '../lib/http.js';
import { rpc, dbFailure } from '../lib/db.js';
import { adminFromRequest, forgetUser } from '../lib/session.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASONS = {
  bad_login: [400, 'IDは半角の英小文字・数字・記号（. _ -）で3〜40文字にしてください。'],
  bad_name: [400, '氏名を入力してください（40文字まで）。'],
  bad_password: [400, 'パスワードは10文字以上にしてください。'],
  bad_role: [400, '権限の指定が正しくありません。'],
  exists: [409, 'そのIDは既に使われています。'],
  not_found: [404, 'アカウントが見つかりません。'],
  last_admin: [409, '有効な管理者が1人もいなくなるため、変更できません。']
};

function reasonFail(reason) {
  const r = REASONS[reason] || [400, '処理できませんでした。'];
  return fail(r[0], reason || 'failed', r[1]);
}

async function requireAdmin(request, env) {
  const user = await adminFromRequest(request, env);
  if (!user) return { error: fail(401, 'no_login', 'ログインしていません。') };
  if (user.mustChange) return { error: fail(403, 'must_change_password', '先にパスワードを変更してください。') };
  if (user.role !== 'admin') return { error: fail(403, 'not_admin', 'この操作は管理者だけができます。') };
  return { user };
}

/* GET /api/admin/users */
export async function listUsers({ request, env }) {
  try {
    const { error } = await requireAdmin(request, env);
    if (error) return error;
    const users = await rpc(env, 'maruten_users_list', {});
    return json({ users: Array.isArray(users) ? users : [] });
  } catch (e) {
    const f = dbFailure(e);
    return fail(f.status, f.code, f.message);
  }
}

/* POST /api/admin/users  { action: create | update | reset, ... } */
export async function manageUsers({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const { value: body, error: bodyError } = await readJson(request, 4096);
  if (bodyError) return bodyError;
  if (!isPlainObject(body)) return fail(400, 'bad_shape', '形式が正しくありません。');

  try {
    const { error } = await requireAdmin(request, env);
    if (error) return error;

    if (body.action === 'create') {
      const res = await rpc(env, 'maruten_user_create', {
        p_login: str(body.loginId, 64) || '',
        p_name: str(body.name, 64) || '',
        p_role: body.role === 'admin' ? 'admin' : 'staff',
        p_password: str(body.password, 200) || ''
      });
      if (!res || !res.ok) return reasonFail(res && res.reason);
      return json({ ok: true, id: res.id });
    }

    const id = str(body.id, 64);
    if (!id || !UUID_RE.test(id)) return reasonFail('not_found');

    if (body.action === 'update') {
      const res = await rpc(env, 'maruten_user_update', {
        p_id: id,
        p_name: typeof body.name === 'string' ? body.name.slice(0, 64) : null,
        p_role: body.role === 'admin' || body.role === 'staff' ? body.role : null,
        p_active: typeof body.active === 'boolean' ? body.active : null
      });
      forgetUser(id);
      if (!res || !res.ok) return reasonFail(res && res.reason);
      return json({ ok: true });
    }

    if (body.action === 'reset') {
      const res = await rpc(env, 'maruten_user_set_password', {
        p_id: id,
        p_password: str(body.password, 200) || ''
      });
      forgetUser(id);
      if (!res || !res.ok) return reasonFail(res && res.reason);
      return json({ ok: true });
    }

    return fail(400, 'bad_action', '操作の指定が正しくありません。');
  } catch (e) {
    const f = dbFailure(e);
    return fail(f.status, f.code, f.message);
  }
}
