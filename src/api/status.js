/*
 * status.js - 設定状況の確認と、稼働確認（自動停止の防止）
 */
import { json, fail } from '../lib/http.js';
import { safeEqual } from '../lib/crypto.js';
import { configured, selectPage, dbFailure } from '../lib/db.js';

/* 公開した版の目印。中身を直したら、ここも新しくする（どの版が動いているか分かるように） */
export const VERSION = '2026-09-23-3';

/* GET /api/status  … 設定済みかどうかだけを返す（値は一切返さない） */
export async function status({ env }) {
  return json({
    version: VERSION,
    database: configured(env),
    session: !!env.SESSION_SECRET,
    turnstile: !!env.TURNSTILE_SECRET,
    keepalive: !!env.KEEPALIVE_TOKEN
  });
}

/*
 * GET /api/ping  … GitHub Actions から週2回呼ばれる。合言葉（X-Keepalive）が必要。
 * Supabase の無料プランは7日間アクセスがないと停止するため、ごく軽く1件だけ読む。
 */
export async function ping({ request, env }) {
  if (!env.KEEPALIVE_TOKEN) return fail(503, 'not_configured', '稼働確認用の設定がありません。');
  const given = request.headers.get('X-Keepalive') || '';
  if (!safeEqual(given, env.KEEPALIVE_TOKEN)) return fail(403, 'bad_token', '許可されていません。');
  if (!configured(env)) return fail(503, 'not_configured', 'データベースの接続設定がありません。');
  try {
    await selectPage(env, [['kind', 'eq.sites']], null, 1);
    return json({ ok: true });
  } catch (e) {
    const f = dbFailure(e);
    return fail(f.status, f.code, f.message);
  }
}
