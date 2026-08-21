/*
 * /api/ping - 稼働確認専用の入口（GitHub Actions からの自動アクセス用）
 *
 * Supabase の無料プランは7日間アクセスがないと停止するため、
 * 定期的にごく軽い問い合わせを送って停止を防ぐ。
 * 画面用の入口とは分けてあり、合言葉（KEEPALIVE_TOKEN）が要る。
 * データは一切返さない。
 *
 * 必要な環境変数:
 *   KEEPALIVE_TOKEN … GitHub Actions と共有する合言葉（暗号化して保存）
 */
import { TABLE, json, fail, supabaseHeaders, supabaseUrl, configured, space } from './_lib.js';

export async function onRequestGet({ request, env }) {
  if (!env.KEEPALIVE_TOKEN) return fail(503, 'not_configured', '稼働確認用の設定がありません。');

  const given = request.headers.get('X-Keepalive') || '';
  // 長さをそろえてから1文字ずつ比べ、合言葉の推測を難しくする
  const expect = env.KEEPALIVE_TOKEN;
  if (given.length !== expect.length) return fail(403, 'bad_token', '許可されていません。');
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= given.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return fail(403, 'bad_token', '許可されていません。');

  if (!configured(env)) return fail(503, 'not_configured', 'データベースの接続設定がありません。');

  const target = supabaseUrl(env, TABLE) +
    '?select=id&limit=1&space=eq.' + encodeURIComponent(space(env));

  let res;
  try {
    res = await fetch(target, { headers: supabaseHeaders(env) });
  } catch (e) {
    return fail(502, 'upstream_unreachable', 'データの保管先に接続できませんでした。');
  }
  if (!res.ok) {
    const text = await res.text();
    return fail(502, 'upstream_error', String(text).slice(0, 200));
  }
  // 件数も中身も返さない。生きているかどうかだけ。
  return json({ ok: true });
}
