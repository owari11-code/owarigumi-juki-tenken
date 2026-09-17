/*
 * db.js - Supabase（PostgREST）への問い合わせ。データベースの鍵はここだけが持つ。
 *
 * データは1つのテーブル juki_records に、種別（kind）ごとに入れている。
 *   id text / space text / kind text / data jsonb / deleted boolean / updated_at timestamptz
 * updated_at はデータベース側の時刻で打ち直されるので、取りこぼしなく差分を取り出せる。
 */

export const TABLE = 'juki_records';
export const PAGE_LIMIT = 500;

export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class DbError extends Error {
  constructor(status, detail) {
    super('database error ' + status);
    this.status = status;
    this.detail = String(detail || '').slice(0, 300);
  }
}

export function configured(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

export function space(env) {
  return env.SPACE || 'default';
}

function baseUrl(env) {
  return String(env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

function headers(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'content-type': 'application/json',
    accept: 'application/json',
    ...extra
  };
}

/** PostgREST の値を二重引用符で囲む（, . : ( ) を含む値を正しく渡すため） */
export function quote(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function inList(values) {
  return '(' + values.map(quote).join(',') + ')';
}

function query(params) {
  return params.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

async function request(env, method, path, body, extraHeaders) {
  let res;
  try {
    res = await fetch(baseUrl(env) + '/rest/v1/' + path, {
      method,
      headers: headers(env, extraHeaders),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) {
    throw new DbError(0, 'unreachable');
  }
  const text = await res.text();
  if (!res.ok) throw new DbError(res.status, text);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new DbError(502, 'bad response');
  }
}

/** データベース関数を呼ぶ（ログインの照合など） */
export function rpc(env, fn, args) {
  return request(env, 'POST', 'rpc/' + fn, args || {});
}

/**
 * 更新時刻の順に1ページ分を取り出す。
 * 同じ時刻の行がページの境目で分かれても漏れないよう、(updated_at, id) の組で続きを指す。
 *   filters … [['kind', 'in.(...)'], ...]
 *   after   … { t: updated_at, i: id } または null
 */
export async function selectPage(env, filters, after, limit = PAGE_LIMIT) {
  const params = [
    ['select', 'id,kind,data,deleted,updated_at'],
    ['space', 'eq.' + space(env)],
    ...filters
  ];
  if (after) {
    params.push(['or', `(updated_at.gt.${quote(after.t)},and(updated_at.eq.${quote(after.t)},id.gt.${quote(after.i)}))`]);
  }
  params.push(['order', 'updated_at.asc,id.asc'], ['limit', String(limit)]);
  const rows = await request(env, 'GET', TABLE + '?' + query(params));
  const list = Array.isArray(rows) ? rows : [];
  const last = list.length ? list[list.length - 1] : null;
  return {
    rows: list,
    next: last ? { t: last.updated_at, i: last.id } : after,
    more: list.length >= limit
  };
}

/** id の一覧から、既にある行の要点（種別・現場・削除済み・確認欄）を引く */
export async function fetchExisting(env, ids) {
  const map = new Map();
  const unique = [...new Set(ids)].filter((id) => ID_RE.test(id));
  for (let i = 0; i < unique.length; i += 150) {
    const chunk = unique.slice(i, i + 150);
    const params = [
      ['select', 'id,kind,deleted,siteId:data->>siteId,approvals:data->approvals'],
      ['space', 'eq.' + space(env)],
      ['id', 'in.' + inList(chunk)]
    ];
    const rows = await request(env, 'GET', TABLE + '?' + query(params));
    (rows || []).forEach((r) => map.set(r.id, r));
  }
  return map;
}

/** 現場の行を引く（QRの鍵の照合用。削除済みも含めて返す） */
export async function fetchSites(env, ids) {
  const map = new Map();
  const unique = [...new Set(ids)].filter((id) => ID_RE.test(id));
  if (!unique.length) return map;
  const params = [
    ['select', 'id,deleted,data'],
    ['space', 'eq.' + space(env)],
    ['kind', 'eq.sites'],
    ['id', 'in.' + inList(unique)]
  ];
  const rows = await request(env, 'GET', TABLE + '?' + query(params));
  (rows || []).forEach((r) => map.set(r.id, r));
  return map;
}

/** 稼働中の現場の名前だけを引く（工具の持出先を選ぶため） */
export async function fetchSiteNames(env) {
  const params = [
    ['select', 'id,name:data->>name,status:data->>status,depot:data->>depot'],
    ['space', 'eq.' + space(env)],
    ['kind', 'eq.sites'],
    ['deleted', 'is.false'],
    ['order', 'id.asc'],
    ['limit', '300']
  ];
  const rows = await request(env, 'GET', TABLE + '?' + query(params));
  return (rows || [])
    .filter((r) => r.depot !== 'true' && r.status !== 'done')
    .map((r) => ({ id: r.id, name: r.name || '' }));
}

/** 追加・更新（削除は「削除済みの印」だけ。行そのものは消さない） */
export async function upsertRows(env, rows) {
  if (!rows.length) return;
  await request(env, 'POST', TABLE, rows, { Prefer: 'resolution=merge-duplicates,return=minimal' });
}

/** データベースの失敗を、画面に出してよい形に直す */
export function dbFailure(e) {
  const detail = (e && e.detail) || '';
  if (e && e.status === 0) {
    return { status: 502, code: 'upstream_unreachable', message: 'データの保管先に接続できませんでした。保管先が停止している可能性があります。' };
  }
  if (/PGRST202|Could not find the function/i.test(detail)) {
    return { status: 503, code: 'db_not_ready', message: 'データベースの準備（SQL）がまだ実行されていません。' };
  }
  if (/PGRST205|schema cache/i.test(detail)) {
    return { status: 503, code: 'db_not_ready', message: 'データの置き場（テーブル）が見つかりません。' };
  }
  return { status: 502, code: 'upstream_error', message: 'データの保管先でエラーが発生しました。' };
}
