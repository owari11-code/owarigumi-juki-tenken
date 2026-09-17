/*
 * session.js - 「誰が使っているか」の確認
 *
 *   事務所（admin）… IDとパスワードでログインした人。全現場を扱える。
 *   現場（field）  … QRコードを読んだ端末。そのQRの現場だけを扱える。
 *
 * どちらも署名付きクッキーで証明する。署名だけでは、無効化したアカウントや
 * 作り直したQRの鍵を締め出せないため、データベースの今の状態とも照らし合わせる
 * （問い合わせを減らすため、結果は短時間だけ覚えておく）。
 */
import { readCookie } from './http.js';
import { hmac, safeEqual, signToken, verifyToken } from './crypto.js';
import { rpc, fetchSites } from './db.js';

export const ADMIN_COOKIE = 'mt_admin';
export const FIELD_COOKIE = 'mt_field';
export const ADMIN_HOURS = 12;
export const ADMIN_REMEMBER_DAYS = 14;
export const FIELD_HOURS = 12;
export const FIELD_MAX_SITES = 10;

const CHECK_TTL_MS = 30 * 1000;
const userCache = new Map();   // userId -> { at, info }
const siteCache = new Map();   // siteId -> { at, row }

export function forgetUser(id) {
  userCache.delete(id);
}

export function forgetSite(id) {
  siteCache.delete(id);
}

/* ------------------------------------------------------------------ *
 * 事務所
 * ------------------------------------------------------------------ */
export async function issueAdminToken(env, user, remember) {
  const ms = remember ? ADMIN_REMEMBER_DAYS * 86400 * 1000 : ADMIN_HOURS * 3600 * 1000;
  const token = await signToken(env.SESSION_SECRET, 'admin', {
    u: user.id, sv: user.sv, r: remember ? 1 : 0, exp: Date.now() + ms
  });
  return { token, maxAge: Math.floor(ms / 1000) };
}

async function sessionCheck(env, id) {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.info;
  const info = await rpc(env, 'maruten_session_check', { p_id: id });
  userCache.set(id, { at: Date.now(), info });
  return info;
}

/** ログイン中の事務所アカウントを返す（いなければ null） */
export async function adminFromRequest(request, env) {
  if (!env.SESSION_SECRET) return null;
  const tok = await verifyToken(env.SESSION_SECRET, 'admin', readCookie(request, ADMIN_COOKIE));
  if (!tok || typeof tok.u !== 'string') return null;
  const info = await sessionCheck(env, tok.u);
  if (!info || !info.active || info.sv !== tok.sv) return null;
  return {
    id: info.id,
    loginId: info.loginId,
    name: info.name,
    role: info.role,
    mustChange: !!info.mustChange,
    remember: tok.r === 1
  };
}

/* ------------------------------------------------------------------ *
 * 現場（QR）
 * ------------------------------------------------------------------ */

/** 鍵そのものはクッキーに入れず、鍵から作った印だけを入れる */
export async function fieldKeyTag(env, siteId, fieldKey) {
  return (await hmac(env.SESSION_SECRET, 'fieldkey.' + siteId + '.' + fieldKey)).slice(0, 22);
}

async function loadSites(env, ids) {
  const now = Date.now();
  const out = new Map();
  const missing = [];
  ids.forEach((id) => {
    const hit = siteCache.get(id);
    if (hit && now - hit.at < CHECK_TTL_MS) out.set(id, hit.row);
    else missing.push(id);
  });
  if (missing.length) {
    const rows = await fetchSites(env, missing);
    missing.forEach((id) => {
      const row = rows.get(id) || null;
      siteCache.set(id, { at: now, row });
      out.set(id, row);
    });
  }
  return out;
}

export async function issueFieldToken(env, entries) {
  const ms = FIELD_HOURS * 3600 * 1000;
  const token = await signToken(env.SESSION_SECRET, 'field', { s: entries, exp: Date.now() + ms });
  return { token, maxAge: Math.floor(ms / 1000) };
}

/** クッキーに入っている現場の一覧（署名が正しいものだけ。鍵の照合はまだ） */
export async function fieldEntriesFromRequest(request, env) {
  if (!env.SESSION_SECRET) return [];
  const tok = await verifyToken(env.SESSION_SECRET, 'field', readCookie(request, FIELD_COOKIE));
  if (!tok || !Array.isArray(tok.s)) return [];
  return tok.s.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string');
}

/**
 * QRで使える現場の範囲を返す（無ければ null）。
 * 鍵を作り直した現場や削除した現場は、ここで外れる。
 */
export async function fieldScopeFromRequest(request, env) {
  const entries = await fieldEntriesFromRequest(request, env);
  if (!entries.length) return null;
  const sites = await loadSites(env, entries.map((e) => e[0]));
  const scope = { siteIds: [], depotIds: [], sites: new Map(), entries: [] };
  for (const [id, tag] of entries) {
    const row = sites.get(id);
    if (!row || row.deleted || !row.data || !row.data.fieldKey) continue;
    const expect = await fieldKeyTag(env, id, row.data.fieldKey);
    if (!safeEqual(tag, expect)) continue;
    scope.siteIds.push(id);
    if (row.data.depot === true) scope.depotIds.push(id);
    scope.sites.set(id, row);
    scope.entries.push([id, tag]);
  }
  return scope.siteIds.length ? scope : null;
}
