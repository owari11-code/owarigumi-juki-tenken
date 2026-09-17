/*
 * http.js - 応答の組み立て・クッキー・呼び出し元の確認
 */

export function json(body, status = 200, headers = {}) {
  const h = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else h.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function fail(status, code, message, extra = {}) {
  return json({ error: code, message, ...extra }, status);
}

/**
 * 別サイトに置かれた画面から呼ばれるのを防ぐ（ブラウザ経由の悪用対策）。
 * Origin があれば自分自身と一致すること、無ければ Referer で確かめる。
 */
export function checkOrigin(request) {
  const self = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== self) return false;
  if (!origin) {
    const referer = request.headers.get('Referer');
    if (referer && !referer.startsWith(self + '/')) return false;
  }
  return true;
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const kv = part.trim();
    const eq = kv.indexOf('=');
    if (eq > 0 && kv.slice(0, eq) === name) return kv.slice(eq + 1);
  }
  return null;
}

export function setCookie(name, value, maxAgeSec) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** 本文をJSONとして読む。大きすぎる・壊れている場合は Response を返す */
export async function readJson(request, maxBytes) {
  const raw = await request.text();
  if (raw.length > maxBytes) {
    return { error: fail(413, 'too_large', '送信データが大きすぎます。') };
  }
  try {
    return { value: raw ? JSON.parse(raw) : null };
  } catch (e) {
    return { error: fail(400, 'bad_json', '内容を読み取れませんでした。') };
  }
}

export function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function str(v, max) {
  return typeof v === 'string' && v.length <= max ? v : null;
}
