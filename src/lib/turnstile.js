/*
 * turnstile.js - Cloudflare Turnstile（人が操作しているかの確認）
 * TURNSTILE_SECRET が未設定なら確認を省く（試用環境向け）。
 */

export async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET) return { ok: true };
  if (!token || typeof token !== 'string' || token.length > 4096) {
    return { ok: false, code: 'turnstile_required', message: '安全確認が必要です。' };
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
    return { ok: false, code: 'turnstile_unreachable', message: '安全確認のサーバーに接続できませんでした。' };
  }
  if (!verdict || verdict.success !== true) {
    return { ok: false, code: 'turnstile_failed', message: '安全確認に失敗しました。もう一度お試しください。' };
  }
  return { ok: true };
}
