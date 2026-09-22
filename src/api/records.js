/*
 * records.js - データの読み書き
 *
 *   GET  /api/admin/records   事務所：全データの差分を取り出す
 *   POST /api/admin/records   事務所：追加・更新（削除は「削除済みの印」のみ）
 *   POST /api/field/session   現場：QRの鍵を確かめて、その現場の利用証明を渡す
 *   GET  /api/field/records   現場：QRの現場のデータだけを取り出す
 *   POST /api/field/records   現場：点検・入出庫・貸出の記録だけを書く
 */
import { json, fail, checkOrigin, readJson, setCookie, isPlainObject, str } from '../lib/http.js';
import { b64urlFromBytes, b64urlToBytes, safeEqual } from '../lib/crypto.js';
import {
  ID_RE, ISO_RE, configured, space, inList, selectPage, fetchExisting, fetchSites, fetchSiteNames,
  upsertRows, dbFailure
} from '../lib/db.js';
import {
  ADMIN_KINDS, FIELD_SITE_KINDS, FIELD_DEPOT_KINDS, FIELD_RECENT_KINDS, FIELD_INSPECTION_DAYS, FIELD_WRITE, MAX_BODY,
  normalizeRows, siteForField, mergeApprovals, daysAgo
} from '../lib/policy.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import {
  FIELD_COOKIE, FIELD_MAX_SITES, adminFromRequest, fieldEntriesFromRequest, fieldScopeFromRequest,
  fieldKeyTag, issueFieldToken, forgetSite
} from '../lib/session.js';

const PAGE = 500;
const FIELD_PAGE = 300;

function notReady(env) {
  if (!configured(env)) return fail(503, 'not_configured', 'サーバー側の接続設定が未完了です。');
  if (!env.SESSION_SECRET) return fail(503, 'no_session_secret', 'サーバー側の設定（SESSION_SECRET）が未完了です。');
  return null;
}

function dbFail(e) {
  const f = dbFailure(e);
  return fail(f.status, f.code, f.message);
}

/* ------------------------------------------------------------------ *
 * 続きの位置（カーソル）は、グループごとの (updated_at, id) を封筒に入れて渡す
 * ------------------------------------------------------------------ */
function encodeCursor(obj) {
  return b64urlFromBytes(new TextEncoder().encode(JSON.stringify(obj)));
}

function decodeCursor(raw, scopeKey) {
  if (!raw || raw.length > 4000) return {};
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64urlToBytes(raw)));
    if (!isPlainObject(obj) || !isPlainObject(obj.g)) return {};
    if ((obj.sc || '') !== (scopeKey || '')) return {};   // 現場の組み合わせが変わったら最初から
    const out = {};
    for (const [k, v] of Object.entries(obj.g)) {
      if (Array.isArray(v) && typeof v[0] === 'string' && ISO_RE.test(v[0]) &&
          typeof v[1] === 'string' && ID_RE.test(v[1])) {
        out[k] = { t: v[0], i: v[1] };
      }
    }
    return out;
  } catch (e) {
    return {};
  }
}

async function pullGroups(env, groups, cursor, limit) {
  const results = await Promise.all(groups.map(([key, filters]) =>
    selectPage(env, filters, cursor[key] || null, limit).then((page) => ({ key, page }))));
  const rows = [];
  const next = {};
  let more = false;
  for (const { key, page } of results) {
    page.rows.forEach((r) => rows.push(r));
    if (page.next) next[key] = [page.next.t, page.next.i];
    if (page.more) more = true;
  }
  return { rows, next, more };
}

/* ================================================================== *
 * 事務所
 * ================================================================== */
async function requireStaff(request, env) {
  const user = await adminFromRequest(request, env);
  if (!user) return { error: fail(401, 'no_login', 'ログインしていません。') };
  if (user.mustChange) return { error: fail(403, 'must_change_password', '先にパスワードを変更してください。') };
  return { user };
}

/* GET /api/admin/records?cursor= */
export async function adminPull({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const nr = notReady(env);
  if (nr) return nr;
  try {
    const { error } = await requireStaff(request, env);
    if (error) return error;
    const cursor = decodeCursor(new URL(request.url).searchParams.get('cursor'), 'admin');
    const { rows, next, more } = await pullGroups(env,
      [['a', [['kind', 'in.(' + ADMIN_KINDS.join(',') + ')']]]], cursor, PAGE);
    return json({ rows, cursor: encodeCursor({ sc: 'admin', g: next }), more });
  } catch (e) {
    return dbFail(e);
  }
}

/* POST /api/admin/records  [ { id, kind, data, deleted } ] */
export async function adminPush({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const nr = notReady(env);
  if (nr) return nr;
  const { value: body, error: bodyError } = await readJson(request, MAX_BODY);
  if (bodyError) return bodyError;

  try {
    const { user, error } = await requireStaff(request, env);
    if (error) return error;

    const norm = normalizeRows(body, ADMIN_KINDS);
    if (norm.error) return fail(400, norm.error[0], norm.error[1]);
    const rejected = norm.rejected;
    const existing = await fetchExisting(env, norm.rows.map((r) => r.id));

    const accepted = [];
    for (const row of norm.rows) {
      const ex = existing.get(row.id);
      if (ex && ex.kind !== row.kind) {
        rejected.push({ id: row.id, code: 'kind_conflict' });
        continue;
      }
      if (row.kind === 'inspections') {
        const merged = mergeApprovals(user, ex ? ex.approvals : null, row.data);
        if (merged.error) {
          rejected.push({ id: row.id, code: merged.error });
          continue;
        }
        if (merged.value) row.data.approvals = merged.value;
        else delete row.data.approvals;
      }
      delete row.data._unapprove;
      row.data._by = user.name;
      accepted.push({ id: row.id, space: space(env), kind: row.kind, data: row.data, deleted: row.deleted });
    }

    await upsertRows(env, accepted);
    accepted.forEach((r) => { if (r.kind === 'sites') forgetSite(r.id); });
    return json({ ok: true, saved: accepted.length, rejected });
  } catch (e) {
    return dbFail(e);
  }
}

/* ================================================================== *
 * 現場（QR）
 * ================================================================== */

/* POST /api/field/session  { siteId, key, token } */
export async function fieldSession({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const nr = notReady(env);
  if (nr) return nr;
  const { value: body, error } = await readJson(request, 4096);
  if (error) return error;
  if (!isPlainObject(body)) return fail(400, 'bad_shape', '形式が正しくありません。');

  const siteId = str(body.siteId, 64);
  const key = str(body.key, 128);
  if (!siteId || !ID_RE.test(siteId) || !key) {
    return fail(400, 'bad_qr', 'QRコードの内容が正しくありません。');
  }

  const ts = await verifyTurnstile(request, env, body.token);
  if (!ts.ok) return fail(403, ts.code, ts.message);

  try {
    const sites = await fetchSites(env, [siteId]);
    const row = sites.get(siteId);
    if (!row || row.deleted || !row.data || typeof row.data.fieldKey !== 'string' ||
        !safeEqual(key, row.data.fieldKey)) {
      return fail(403, 'bad_qr', 'このQRコードは使えません。事務所で新しいQRコードを印刷してもらってください。');
    }
    forgetSite(siteId);

    // すでに持っている現場の証明に、この現場を加える（古いものから外す）
    const tag = await fieldKeyTag(env, siteId, row.data.fieldKey);
    const entries = (await fieldEntriesFromRequest(request, env)).filter((e) => e[0] !== siteId);
    entries.push([siteId, tag]);
    while (entries.length > FIELD_MAX_SITES) entries.shift();

    const { token, maxAge } = await issueFieldToken(env, entries);
    return json({
      ok: true,
      site: { id: siteId, name: row.data.name || '', depot: row.data.depot === true }
    }, 200, { 'set-cookie': setCookie(FIELD_COOKIE, token, maxAge) });
  } catch (e) {
    return dbFail(e);
  }
}

async function requireField(request, env) {
  const scope = await fieldScopeFromRequest(request, env);
  if (!scope) return { error: fail(401, 'no_field_session', 'QRコードを読み取り直してください。') };
  return { scope };
}

/* GET /api/field/records?cursor= */
export async function fieldPull({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const nr = notReady(env);
  if (nr) return nr;
  try {
    const { scope, error } = await requireField(request, env);
    if (error) return error;

    const ids = scope.siteIds.slice().sort();
    const scopeKey = ids.join(',');
    const cursor = decodeCursor(new URL(request.url).searchParams.get('cursor'), scopeKey);
    const groups = [
      ['s', [['kind', 'eq.sites'], ['id', 'in.' + inList(ids)]]],
      ['k', [['kind', 'in.(' + FIELD_SITE_KINDS.join(',') + ')'], ['data->>siteId', 'in.' + inList(ids)]]],
      ['i', [['kind', 'in.(' + FIELD_RECENT_KINDS.join(',') + ')'], ['data->>siteId', 'in.' + inList(ids)],
        ['data->>date', 'gte.' + daysAgo(FIELD_INSPECTION_DAYS)]]]
    ];
    if (scope.depotIds.length) {
      groups.push(['d', [['kind', 'in.(' + FIELD_DEPOT_KINDS.join(',') + ')'],
        ['data->>siteId', 'in.' + inList(scope.depotIds.slice().sort())]]]);
    }

    const { rows, next, more } = await pullGroups(env, groups, cursor, FIELD_PAGE);
    rows.forEach((r) => {
      if (r.kind === 'sites' && r.data) r.data = siteForField(r.data);
    });

    const out = { rows, cursor: encodeCursor({ sc: scopeKey, g: next }), more, scope: ids };
    if (scope.depotIds.length) out.siteNames = await fetchSiteNames(env);
    return json(out);
  } catch (e) {
    return dbFail(e);
  }
}

/* POST /api/field/records  [ { id, kind, data } ] */
export async function fieldPush({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  const nr = notReady(env);
  if (nr) return nr;
  const { value: body, error: bodyError } = await readJson(request, MAX_BODY);
  if (bodyError) return bodyError;

  try {
    const { scope, error } = await requireField(request, env);
    if (error) return error;

    const norm = normalizeRows(body, Object.keys(FIELD_WRITE));
    if (norm.error) return fail(400, norm.error[0], norm.error[1]);
    const rejected = norm.rejected;
    const skipped = [];

    // 行そのものと、参照先（重機・資材・工具など）をまとめて引く
    const lookups = [];
    norm.rows.forEach((row) => {
      lookups.push(row.id);
      FIELD_WRITE[row.kind].refs.forEach(([field]) => {
        if (typeof row.data[field] === 'string') lookups.push(row.data[field]);
      });
    });
    const existing = await fetchExisting(env, lookups);

    const accepted = [];
    for (const row of norm.rows) {
      const rule = FIELD_WRITE[row.kind];
      const siteId = row.data.siteId;
      const allowed = rule.depot ? scope.depotIds : scope.siteIds;
      if (allowed.indexOf(siteId) < 0) {
        rejected.push({ id: row.id, code: 'out_of_scope' });
        continue;
      }
      if (row.deleted) {
        rejected.push({ id: row.id, code: 'no_delete' });
        continue;
      }
      const ex = existing.get(row.id);
      if (ex) {
        if (ex.kind !== row.kind || ex.siteId !== siteId) {
          rejected.push({ id: row.id, code: 'kind_conflict' });
          continue;
        }
        if (ex.deleted) {            // 事務所で削除された記録は、現場から復活させない
          skipped.push(row.id);
          continue;
        }
      }
      let badRef = false;
      for (const [field, kinds] of rule.refs) {
        const ref = row.data[field];
        if (ref === undefined || ref === null || ref === '') continue;
        const target = typeof ref === 'string' ? existing.get(ref) : null;
        if (!target || target.deleted || kinds.indexOf(target.kind) < 0 || target.siteId !== siteId) {
          badRef = true;
          break;
        }
      }
      if (badRef) {
        rejected.push({ id: row.id, code: 'bad_reference' });
        continue;
      }
      if (row.kind === 'inspections') {
        // 確認欄（元請）は事務所でしか付けられない。現場からの送信では今の状態を保つ
        if (ex && ex.approvals) row.data.approvals = ex.approvals;
        else delete row.data.approvals;
      }
      delete row.data._unapprove;
      row.data._by = 'QR';
      accepted.push({ id: row.id, space: space(env), kind: row.kind, data: row.data, deleted: false });
    }

    await upsertRows(env, accepted);
    return json({ ok: true, saved: accepted.length, rejected, skipped });
  } catch (e) {
    return dbFail(e);
  }
}
