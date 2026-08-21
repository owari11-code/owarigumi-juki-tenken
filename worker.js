/*
 * worker.js - Cloudflare Workers（静的アセット付き）で動かすための入口
 *
 * Cloudflare は新規プロジェクトを Workers に誘導する画面構成に変わったため、
 * Pages と Workers のどちらでも動くようにしてある。
 *   ・Pages の場合  : functions/api/*.js が自動で /api/... に割り当てられる
 *   ・Workers の場合: このファイルが /api/... を受け持ち、それ以外は静的ファイルを返す
 * 処理の中身は同じものを読み込むので、二重管理にはならない。
 */
import { onRequestGet as recordsGet, onRequestPost as recordsPost } from './functions/api/records.js';
import { onRequestGet as sessionGet, onRequestPost as sessionPost } from './functions/api/session.js';
import { onRequestGet as pingGet } from './functions/api/ping.js';

function notAllowed() {
  return new Response(
    JSON.stringify({ error: 'not_allowed', message: 'この操作は許可されていません。' }),
    { status: 405, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
  );
}

function notFound() {
  return new Response(
    JSON.stringify({ error: 'not_found', message: '見つかりません。' }),
    { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
  );
}

/* 経路と、受け付けるメソッドの対応。ここに無いものは通さない（削除は載せない） */
const ROUTES = {
  '/api/records': { GET: recordsGet, POST: recordsPost },
  '/api/session': { GET: sessionGet, POST: sessionPost },
  '/api/ping': { GET: pingGet }
};

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;

    if (path.startsWith('/api/')) {
      const route = Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : null;
      if (!route) return notFound();
      const handler = Object.prototype.hasOwnProperty.call(route, request.method) ? route[request.method] : null;
      if (!handler) return notAllowed();
      return handler({ request, env, ctx });
    }

    // それ以外は静的ファイル（画面）を返す
    return env.ASSETS.fetch(request);
  }
};
