/*
 * api.js - サーバーとのやり取り
 *
 * ブラウザはデータベースに直接つながず、同じドメインの /api/... だけを呼ぶ。
 * ログインの証明・QRの証明はクッキー（HttpOnly）で持つので、画面のコードからは読めない。
 */
(function (global) {
  'use strict';

  var U = global.MT.util;

  function config() {
    var cfg = global.APP_CONFIG || {};
    return {
      apiBase: String(cfg.apiBase || '').replace(/\/+$/, ''),
      siteKey: cfg.turnstileSiteKey || ''
    };
  }

  function ApiError(status, code, message) {
    this.name = 'ApiError';
    this.status = status;
    this.code = code || '';
    this.message = message || '';
  }
  ApiError.prototype = Object.create(Error.prototype);

  function networkError() {
    if (global.navigator && navigator.onLine === false) {
      return new ApiError(0, 'offline', '電波が届いていません。記録はこの端末に保存され、つながった時点で送信されます。');
    }
    return new ApiError(0, 'network', 'サーバーに接続できませんでした。しばらくしてからお試しください。');
  }

  function request(method, path, body) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { accept: 'application/json' }
    };
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(config().apiBase + path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var code = (data && data.error) || ('http_' + res.status);
          var msg = (data && data.message) || ('サーバーエラー（' + res.status + '）');
          throw new ApiError(res.status, code, msg);
        }
        return data;
      });
    }, function () {
      throw networkError();
    });
  }

  /* ------------------------------------------------------------------ *
   * 安全確認（Cloudflare Turnstile）
   * 必要なときだけ画面に出る。確認の結果（トークン）は1回しか使えない。
   * ------------------------------------------------------------------ */
  var tsLoading = null;

  function loadTurnstile() {
    if (global.turnstile) return Promise.resolve();
    if (tsLoading) return tsLoading;
    tsLoading = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      el.async = true;
      el.onload = function () { resolve(); };
      el.onerror = function () {
        tsLoading = null;
        reject(new ApiError(0, 'turnstile_load', '安全確認の仕組みを読み込めませんでした。電波の状態をご確認ください。'));
      };
      document.head.appendChild(el);
    });
    return tsLoading;
  }

  /** 安全確認が出せなかったときの案内（原因ごとに変える） */
  function turnstileHelp(code) {
    var here = location.hostname;
    var want = '';
    try {
      var base = (global.APP_CONFIG || {}).baseUrl;
      if (base) want = new URL(base, location.href).hostname;
    } catch (e) { /* 無視 */ }

    if (String(code) === '110200') {
      return '安全確認は、このアドレスでは許可されていません（コード 110200）。' +
        'いま開いているのは ' + here + ' です。' +
        (want && want !== here
          ? '正しいアドレス https://' + want + '/ で開き直してください。'
          : 'Cloudflare の Turnstile の設定で、このアドレスを許可してください。');
    }
    return '安全確認の画面を表示できませんでした' + (code ? '（コード ' + code + '）' : '') +
      '。いま開いているアドレスは ' + here + ' です。' +
      '通信環境をご確認ください。社内の設定で challenges.cloudflare.com への通信が遮断されていると、この表示になります。';
  }

  function turnstileToken(isRetry) {
    var siteKey = config().siteKey;
    if (!siteKey) return Promise.resolve('');
    return loadTurnstile().then(function () {
      return new Promise(function (resolve, reject) {
        var overlay = document.createElement('div');
        overlay.className = 'ts-overlay';
        overlay.innerHTML = '<div class="ts-box"><div class="ts-title">安全確認</div>' +
          '<p class="ts-note">自動で確認しています。表示が出たら、チェックを入れてください。</p>' +
          '<div class="ts-widget"></div></div>';
        document.body.appendChild(overlay);
        var done = false;
        var widgetId = null;
        function cleanup() {
          if (done) return false;
          done = true;
          clearTimeout(timer);
          try { if (widgetId !== null) global.turnstile.remove(widgetId); } catch (e) { /* 無視 */ }
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          return true;
        }
        function finish(fn, arg) {
          if (!cleanup()) return;
          fn(arg);
        }
        var timer = setTimeout(function () {
          finish(reject, new ApiError(0, 'turnstile_timeout', '安全確認に時間がかかっています。もう一度お試しください。'));
        }, 45000);
        try {
          widgetId = global.turnstile.render(overlay.querySelector('.ts-widget'), {
            sitekey: siteKey,
            appearance: 'interaction-only',
            callback: function (token) { finish(resolve, token); },
            'error-callback': function (code) {
              // 一時的な失敗が多いので、まず1回だけ自動でやり直す
              if (!isRetry) {
                if (!cleanup()) return;
                setTimeout(function () { turnstileToken(true).then(resolve, reject); }, 800);
                return;
              }
              finish(reject, new ApiError(0, 'turnstile_blocked', turnstileHelp(code)));
            },
            'expired-callback': function () {
              finish(reject, new ApiError(0, 'turnstile_expired', '安全確認の有効時間が切れました。もう一度お試しください。'));
            }
          });
        } catch (e) {
          finish(reject, new ApiError(0, 'turnstile_failed', '安全確認を開始できませんでした。'));
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 事務所のログイン
   * ------------------------------------------------------------------ */
  function me() {
    return request('GET', '/api/auth/me').then(function (d) { return d.user; }, function (e) {
      if (e.status === 401) return null;
      throw e;
    });
  }

  function login(loginId, password, remember) {
    return turnstileToken().then(function (token) {
      return request('POST', '/api/auth/login', {
        loginId: loginId, password: password, remember: !!remember, token: token
      });
    }).then(function (d) { return d.user; });
  }

  function logout() {
    return request('POST', '/api/auth/logout', {});
  }

  function setupStatus() {
    return request('GET', '/api/auth/setup');
  }

  function setup(code, loginId, name, password) {
    return turnstileToken().then(function (token) {
      return request('POST', '/api/auth/setup', {
        code: code, loginId: loginId, name: name, password: password, token: token
      });
    }).then(function (d) { return d.user; });
  }

  function changePassword(current, next) {
    return request('POST', '/api/auth/password', { current: current, next: next })
      .then(function (d) { return d.user; });
  }

  function users() {
    return request('GET', '/api/admin/users').then(function (d) { return d.users || []; });
  }

  function manageUser(payload) {
    return request('POST', '/api/admin/users', payload);
  }

  /* ------------------------------------------------------------------ *
   * 現場（QR）
   * ------------------------------------------------------------------ */
  function fieldSession(siteId, key) {
    return turnstileToken().then(function (token) {
      return request('POST', '/api/field/session', { siteId: siteId, key: key, token: token });
    });
  }

  /* ------------------------------------------------------------------ *
   * データ
   * ------------------------------------------------------------------ */
  function pull(mode, cursor) {
    var path = mode === 'admin' ? '/api/admin/records' : '/api/field/records';
    return request('GET', path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
  }

  function push(mode, rows) {
    var path = mode === 'admin' ? '/api/admin/records' : '/api/field/records';
    return request('POST', path, rows);
  }

  function serverStatus() {
    return request('GET', '/api/status');
  }

  global.MT.api = {
    ApiError: ApiError,
    request: request,
    turnstileToken: turnstileToken,
    me: me,
    login: login,
    logout: logout,
    setupStatus: setupStatus,
    setup: setup,
    changePassword: changePassword,
    users: users,
    manageUser: manageUser,
    fieldSession: fieldSession,
    pull: pull,
    push: push,
    serverStatus: serverStatus
  };
})(window);
