/*
 * sync.js - 端末間の自動同期
 *
 * ブラウザはデータベースに直接つながず、同じドメインの /api/... だけを呼ぶ。
 * データベースの鍵は Cloudflare 側（サーバー）にあり、画面のコードからは見えない。
 *
 * 流れ: ①サーバーの新着を取得して取り込む → ②未送信の変更を送る
 * これを「起動時／画面を開いたとき／保存直後／一定間隔」で行う。
 */
(function (global) {
  'use strict';

  var POLL_MS = 20000;      // 画面を開いている間の自動取得間隔
  var PUSH_DELAY_MS = 1200; // 保存してから送信するまでの待ち（連続保存をまとめる）
  var CURSOR_KEY = 'juki-sync-cursor';
  var EPOCH = '1970-01-01T00:00:00.000Z';
  var MAX_PUSH = 200;       // サーバー側の受付上限に合わせる

  var listeners = [];
  var timer = null;
  var pushTimer = null;
  var running = false;
  var sessionWork = null;
  var turnstileLoading = null;
  var status = {
    configured: false,
    enabled: false,
    running: false,
    lastSyncAt: null,
    lastError: null,
    pending: 0
  };

  function config() {
    var s = Store.getSettings();
    return {
      apiBase: (s.apiBase || '').replace(/\/+$/, ''),
      siteKey: s.turnstileSiteKey || '',
      enabled: s.syncEnabled !== false
    };
  }

  function api(path) { return config().apiBase + path; }

  /** ファイルとして開いている場合はサーバーが無いので同期できない */
  function isConfigured() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }
  function isActive() {
    return isConfigured() && config().enabled;
  }

  function cursor() {
    try { return localStorage.getItem(CURSOR_KEY) || EPOCH; } catch (e) { return EPOCH; }
  }
  function setCursor(v) {
    try { localStorage.setItem(CURSOR_KEY, v); } catch (e) { /* 保存できなくても動作は続く */ }
  }

  function notify(changed) {
    status.pending = Store.pendingRecords().length;
    listeners.forEach(function (cb) {
      try { cb(status, changed); } catch (e) { /* 通知先の例外は無視 */ }
    });
  }

  /* ------------------------------------------------------------------ *
   * 利用確認（Turnstile）
   * ログインの代わりに「人が操作している端末か」を一度だけ確かめ、
   * 12時間有効の証明をサーバーから受け取る。
   * ------------------------------------------------------------------ */
  function loadTurnstile() {
    if (global.turnstile) return Promise.resolve();
    if (turnstileLoading) return turnstileLoading;
    turnstileLoading = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      el.async = true;
      el.defer = true;
      el.onload = function () { resolve(); };
      el.onerror = function () {
        turnstileLoading = null;
        reject(new Error('安全確認の仕組みを読み込めませんでした'));
      };
      document.head.appendChild(el);
    });
    return turnstileLoading;
  }

  function getTurnstileToken(siteKey) {
    return loadTurnstile().then(function () {
      return new Promise(function (resolve, reject) {
        var overlay = document.createElement('div');
        overlay.className = 'ts-overlay';
        overlay.innerHTML = '<div class="ts-box">' +
          '<div class="ts-title">安全確認</div>' +
          '<p class="ts-note">初回と1日1回だけ、自動で確認を行います。</p>' +
          '<div id="ts-widget"></div></div>';
        document.body.appendChild(overlay);

        var done = false;
        function finish(fn, arg) {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          fn(arg);
        }
        var timeout = setTimeout(function () {
          finish(reject, new Error('安全確認に時間がかかっています'));
        }, 30000);

        try {
          global.turnstile.render('#ts-widget', {
            sitekey: siteKey,
            appearance: 'interaction-only',   // 必要なときだけ画面に出る
            callback: function (token) { finish(resolve, token); },
            'error-callback': function () { finish(reject, new Error('端末の確認に失敗しました')); },
            'timeout-callback': function () { finish(reject, new Error('安全確認がやり直しになりました')); }
          });
        } catch (e) {
          finish(reject, new Error('安全確認を開始できませんでした'));
        }
      });
    });
  }

  function postSession(token) {
    return fetch(api('/api/session'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(token ? { token: token } : {})
    }).then(function (r) {
      if (!r.ok) return failWith(r);
      return true;
    });
  }

  /** 証明を取り直す。同時に何度も走らないようにまとめる */
  function ensureSession() {
    if (sessionWork) return sessionWork;
    var c = config();
    var work = c.siteKey
      ? getTurnstileToken(c.siteKey).then(function (token) { return postSession(token); })
      : postSession(null);
    sessionWork = work.then(
      function (v) { sessionWork = null; return v; },
      function (e) { sessionWork = null; throw e; }
    );
    return sessionWork;
  }

  /* ------------------------------------------------------------------ *
   * エラーの説明
   * ------------------------------------------------------------------ */
  function describeError(res, body) {
    var code = '', message = '';
    try {
      var j = JSON.parse(body);
      code = j.error || '';
      message = j.message || '';
    } catch (e) {
      message = (body || '').slice(0, 120);
    }
    if (code === 'not_configured') {
      return 'サーバー側の接続設定が未完了です。Cloudflareの環境変数（SUPABASE_URL / SUPABASE_SERVICE_KEY）をご確認ください。';
    }
    if (code === 'no_session' || code === 'turnstile_required' || code === 'turnstile_failed') {
      return '安全確認に失敗しました。通信状態を確認して、もう一度お試しください。';
    }
    if (code === 'bad_origin') {
      return '別のサイトからは利用できません。正しいURLから開き直してください。';
    }
    if (code === 'too_many' || code === 'too_large' || code === 'row_too_large') {
      return '一度に送るデータが多すぎます。' + (message || '');
    }
    if (code === 'upstream_error' || code === 'upstream_unreachable') {
      if (/PGRST205|schema cache/i.test(message)) {
        return 'テーブル juki_records がまだありません。Supabase の SQL Editor で準備用のSQLを実行してください。';
      }
      return 'データの保管先に接続できません。保管先が停止している可能性があります。事務所へご連絡ください。';
    }
    if (res && res.status === 405) return 'この操作は許可されていません。';
    if (res && res.status === 429) return 'アクセスが集中しています。しばらくしてからお試しください。';
    if (res && res.status) {
      return 'サーバーエラー（' + res.status + '）' + (message ? '：' + message : '');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return '端末が通信できていません。電波の状態をご確認ください。' +
        '（点検の記録は端末に保存され、つながった時点で自動送信されます）';
    }
    return 'サーバーに接続できません。しばらくしてからお試しください。' +
      '（点検の記録は端末に保存されています）';
  }

  function failWith(r) {
    return r.text().then(function (t) {
      var err = new Error(describeError(r, t));
      err.status = r.status;
      try { err.code = JSON.parse(t).error; } catch (e) { err.code = ''; }
      throw err;
    });
  }

  /** 証明切れなら取り直して一度だけやり直す */
  function apiFetch(path, options, retried) {
    return fetch(api(path), options).then(function (r) {
      if (r.status === 401 && !retried) {
        return failWith(r)['catch'](function (e) {
          if (e.code !== 'no_session' && e.code !== 'turnstile_required') throw e;
          return ensureSession().then(function () { return apiFetch(path, options, true); });
        });
      }
      if (!r.ok) return failWith(r);
      return r;
    });
  }

  /* ---------------- サーバーから取得 ---------------- */
  function pull() {
    return apiFetch('/api/records?since=' + encodeURIComponent(cursor()), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'accept': 'application/json' }
    }).then(function (r) {
      return r.json();
    }).then(function (body) {
      var rows = (body && body.rows) || [];
      if (!rows.length) return 0;
      var bundle = { sites: [], machines: [], inspections: [] };
      var maxAt = cursor();
      rows.forEach(function (row) {
        if (row.updated_at > maxAt) maxAt = row.updated_at;
        // 継承経由の一致（'__proto__' など）を弾くため、自身の項目かを確かめる
        if (!Object.prototype.hasOwnProperty.call(bundle, row.kind)) return;
        var rec = row.data || {};
        rec.id = row.id;
        rec.deleted = !!row.deleted;
        bundle[row.kind].push(rec);
      });
      var changed = Store.mergeAll(bundle, false);
      setCursor(maxAt);
      return changed;
    });
  }

  /* ---------------- サーバーへ送信 ---------------- */
  function push() {
    var pending = Store.pendingRecords();
    if (!pending.length) return Promise.resolve(0);
    // 上限を超える分は次の巡回で送る
    if (pending.length > MAX_PUSH) pending = pending.slice(0, MAX_PUSH);

    var rows = pending.map(function (p) {
      var data = {};
      Object.keys(p.record).forEach(function (k) {
        if (k !== '_dirty') data[k] = p.record[k];
      });
      return { id: p.record.id, kind: p.kind, data: data, deleted: !!p.record.deleted };
    });

    return apiFetch('/api/records', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rows)
    }).then(function () {
      Store.markSynced(rows.map(function (x) { return x.id; }));
      return rows.length;
    });
  }

  /* ---------------- 1回分の同期 ---------------- */
  function syncNow(force) {
    if (!isActive()) {
      status.configured = isConfigured();
      status.enabled = config().enabled;
      notify(0);
      return Promise.resolve(0);
    }
    if (running && !force) return Promise.resolve(0);
    running = true;
    status.running = true;
    status.configured = true;
    status.enabled = true;
    notify(0);

    return pull()
      .then(function (changed) {
        return push().then(function () { return changed; });
      })
      .then(function (changed) {
        status.lastSyncAt = new Date().toISOString();
        status.lastError = null;
        running = false;
        status.running = false;
        notify(changed);
        return changed;
      })['catch'](function (e) {
        var m = (e && e.message) || '';
        status.lastError = (!m || /Failed to fetch|NetworkError|Load failed/i.test(m))
          ? describeError(null, '') : m;
        running = false;
        status.running = false;
        notify(0);
        return 0;
      });
  }

  function schedulePush() {
    if (!isActive()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { syncNow(); }, PUSH_DELAY_MS);
  }

  function start() {
    stop();
    status.configured = isConfigured();
    status.enabled = config().enabled;
    if (!isActive()) { notify(0); return; }
    syncNow();
    timer = setInterval(function () {
      if (!document.hidden) syncNow();
    }, POLL_MS);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  function onStatus(cb) { listeners.push(cb); }

  /** サーバー側の設定状況を調べる（鍵そのものは返ってこない） */
  function test() {
    return fetch(api('/api/session'), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) return failWith(r);
      return r.json();
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) syncNow();
  });
  global.addEventListener('online', function () { syncNow(); });

  global.Sync = {
    start: start,
    stop: stop,
    syncNow: syncNow,
    schedulePush: schedulePush,
    onStatus: onStatus,
    status: function () {
      status.configured = isConfigured();
      status.enabled = config().enabled;
      status.pending = Store.pendingRecords().length;
      return status;
    },
    isActive: isActive,
    isConfigured: isConfigured,
    test: test
  };
})(window);
