/*
 * _lib.js - サーバー側（Cloudflare Pages Functions）の共通処理
 *
 * 考え方:
 *   ブラウザにはデータベースの鍵を一切渡さない。ブラウザは同じドメインの
 *   /api/... だけを呼び、鍵を持つのはこのサーバー側の処理だけにする。
 *   Supabase の鍵は Cloudflare の環境変数（暗号化）に置く。
 */

export const TABLE = 'juki_records';
// 配列で持つ（オブジェクトだと '__proto__' 等が継承経由で一致してしまう）
export const KINDS = ['sites', 'machines', 'inspections'];

export const SESSION_COOKIE = 'mt_session';
export const SESSION_HOURS = 12;

/* ------------------------------------------------------------------ *
 * 応答の組み立て
 * ------------------------------------------------------------------ */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

export function fail(status, code, message) {
  return json({ error: code, message }, status);
}

/* ------------------------------------------------------------------ *
 * 呼び出し元の確認
 * 別サイトに置かれた画面から呼ばれるのを防ぐ（ブラウザ経由の悪用対策）。
 * ------------------------------------------------------------------ */
export function checkOrigin(request) {
  const self = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== self) return false;
  if (!origin) {
    const referer = request.headers.get('Referer');
    if (referer && !referer.startsWith(self)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * 利用証明（セッション）
 * Turnstile を通過した端末に、署名付きの短期クッキーを渡す。
 * 中身は有効期限だけで、個人情報は入れない。
 * ------------------------------------------------------------------ */
const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToBytes(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64urlEncode(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** 署名付きセッション値を作る */
export async function makeSession(secret) {
  const payload = b64urlEncode(
    enc.encode(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600 * 1000 }))
  );
  return payload + '.' + (await hmac(secret, payload));
}

/** 署名と有効期限を確かめる */
export async function verifySession(secret, value) {
  if (!value || value.indexOf('.') < 0) return false;
  const [payload, sig] = value.split('.');
  const expect = await hmac(secret, payload);
  // 比較時間をそろえて、署名の推測を難しくする
  if (sig.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(payload)));
    return typeof obj.exp === 'number' && obj.exp > Date.now();
  } catch (e) {
    return false;
  }
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const kv = parts[i].trim();
    const eq = kv.indexOf('=');
    if (eq > 0 && kv.slice(0, eq) === name) return kv.slice(eq + 1);
  }
  return null;
}

export function sessionCookieHeader(value) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
}

/** セッションが必要かどうか（未設定でも動くようにしておく） */
export async function requireSession(request, env) {
  if (!env.SESSION_SECRET) return true;              // 未設定なら検査しない
  const cookie = readCookie(request, SESSION_COOKIE);
  return await verifySession(env.SESSION_SECRET, cookie);
}

/* ------------------------------------------------------------------ *
 * Supabase への問い合わせ（鍵はここだけが持つ）
 * ------------------------------------------------------------------ */
export function supabaseHeaders(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'content-type': 'application/json',
    ...extra
  };
}

export function supabaseUrl(env, path) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
  return base + '/rest/v1/' + path;
}

export function configured(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

/** 共有コード。環境変数で固定し、ブラウザからは指定させない */
export function space(env) {
  return env.SPACE || 'default';
}
