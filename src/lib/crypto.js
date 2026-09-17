/*
 * crypto.js - 署名付きトークン（ログインの証明・QRの証明）
 *
 * クッキーの中身は「中身.署名」の形。中身は改ざんできないが読めるので、
 * 個人情報やパスワードは入れない（アカウントのIDと有効期限だけ）。
 * 用途（admin / field）を署名の対象に含め、取り違えて使えないようにしてある。
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlFromBytes(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const keyCache = new Map();

function hmacKey(secret) {
  let p = keyCache.get(secret);
  if (!p) {
    p = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, p);
  }
  return p;
}

export async function hmac(secret, message) {
  const key = await hmacKey(secret);
  return b64urlFromBytes(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** 長さと内容を、比較にかかる時間から推測されないように比べる */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

export async function signToken(secret, purpose, payload) {
  const body = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  return body + '.' + (await hmac(secret, purpose + '.' + body));
}

/** 署名と有効期限を確かめ、正しければ中身を返す（だめなら null） */
export async function verifyToken(secret, purpose, token) {
  if (!secret || typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = await hmac(secret, purpose + '.' + body);
  if (!safeEqual(sig, expect)) return null;
  try {
    const obj = JSON.parse(dec.decode(b64urlToBytes(body)));
    if (!obj || typeof obj.exp !== 'number' || obj.exp <= Date.now()) return null;
    return obj;
  } catch (e) {
    return null;
  }
}
