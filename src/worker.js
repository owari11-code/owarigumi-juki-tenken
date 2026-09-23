/*
 * worker.js - GENBA ONE by OWR の入口（Cloudflare Workers）
 *
 * /api/... はここで受け持ち、それ以外は public/ の画面ファイルを返す。
 * 表に載っていない経路・メソッドは通さない（削除の経路はそもそも無い）。
 */
import { fail } from './lib/http.js';
import { status, ping } from './api/status.js';
import { me, login, logout, changePassword, setupStatus, setup } from './api/auth.js';
import { listUsers, manageUsers } from './api/users.js';
import { adminPull, adminPush, fieldSession, fieldPull, fieldPush } from './api/records.js';

const ROUTES = {
  '/api/status': { GET: status },
  '/api/session': { GET: status },            // 以前の確認用URL（互換のため残す）
  '/api/ping': { GET: ping },
  '/api/auth/me': { GET: me },
  '/api/auth/login': { POST: login },
  '/api/auth/logout': { POST: logout },
  '/api/auth/password': { POST: changePassword },
  '/api/auth/setup': { GET: setupStatus, POST: setup },
  '/api/admin/users': { GET: listUsers, POST: manageUsers },
  '/api/admin/records': { GET: adminPull, POST: adminPush },
  '/api/field/session': { POST: fieldSession },
  '/api/field/records': { GET: fieldPull, POST: fieldPush }
};

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;

    if (path.startsWith('/api/')) {
      const route = Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : null;
      if (!route) return fail(404, 'not_found', '見つかりません。');
      const handler = Object.prototype.hasOwnProperty.call(route, request.method) ? route[request.method] : null;
      if (!handler) return fail(405, 'not_allowed', 'この操作は許可されていません。');
      try {
        return await handler({ request, env, ctx });
      } catch (e) {
        // 中身は画面に出さず、Cloudflare のログにだけ残す
        console.error('unhandled', path, e && e.stack ? e.stack : e);
        return fail(500, 'server_error', 'サーバーで問題が発生しました。');
      }
    }

    return env.ASSETS.fetch(request);
  }
};
