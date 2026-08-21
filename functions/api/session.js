/*
 * /api/session - 利用証明（セッション）の発行
 *
 * Cloudflare Turnstile を通過した端末にだけ、署名付きの短期クッキーを渡す。
 * ログインは求めないが、自動化された巻き取り（スクレイピング）や
 * いたずら書き込みは、ここで大半を止められる。
 *
 * 必要な環境変数:
 *   SESSION_SECRET    … 署名用のランダムな文字列（必須。これが無いと検査しない）
 *   TURNSTILE_SECRET  … Turnstile の Secret Key（無い場合は検査を省く）
 */
import { json, fail, checkOrigin, makeSession, sessionCookieHeader } from './_lib.js';

export async function onRequestPost({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');

  if (!env.SESSION_SECRET) {
    // 署名鍵が未設定なら、セッションの仕組みそのものを使わない
    return json({ ok: true, session: false });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) { /* 本文なしも許容する */ }

  if (env.TURNSTILE_SECRET) {
    const token = body && body.token;
    if (!token || typeof token !== 'string' || token.length > 4096) {
      return fail(400, 'turnstile_required', '確認トークンがありません。');
    }
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', token);
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) form.append('remoteip', ip);

    let verdict;
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form
      });
      verdict = await res.json();
    } catch (e) {
      return fail(502, 'turnstile_unreachable', '確認サーバーに接続できませんでした。');
    }
    if (!verdict || !verdict.success) {
      return fail(403, 'turnstile_failed', '端末の確認に失敗しました。もう一度お試しください。');
    }
  }

  const value = await makeSession(env.SESSION_SECRET);
  return json({ ok: true, session: true }, 200, { 'set-cookie': sessionCookieHeader(value) });
}

/** 設定状況の確認用（鍵そのものは返さない） */
export async function onRequestGet({ env }) {
  return json({
    session: !!env.SESSION_SECRET,
    turnstile: !!env.TURNSTILE_SECRET,
    database: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY)
  });
}
