/*
 * sync.js - 端末とサーバーの同期
 *
 * 流れ: ①サーバーの新着を取り込む → ②この端末の未送信の変更を送る
 * これを「起動時／画面に戻ったとき／保存の直後／一定間隔」で行う。
 *
 *   事務所（ログイン中）… 全データをやり取りする
 *   現場（QR）          … QRの現場のデータだけを受け取り、点検・入出庫・貸出の記録だけを送る
 */
(function (global) {
  'use strict';

  var Store = global.MT.store;
  var Api = global.MT.api;
  var Session = global.MT.session;

  var FIELD_WRITE_KINDS = ['inspections', 'stock_logs', 'machine_logs', 'lends', 'ky', 'entrants'];
  var POLL_MS = 30000;
  var PUSH_DELAY_MS = 1200;
  var MAX_PUSH = 150;
  var FIELD_RETRY_MS = 10 * 60 * 1000;

  var listeners = [];
  var timer = null;
  var pushTimer = null;
  var running = null;
  var lastFieldAttempt = 0;

  var status = { running: false, lastSyncAt: null, lastError: null, pending: 0, rejected: 0, mode: 'field' };

  function mode() { return Session.user ? 'admin' : 'field'; }

  function validFieldSites() {
    return Session.fieldSites().filter(function (s) { return !s.invalid; });
  }

  /** 同期できる状態か（ログイン中、または使えるQRの鍵がある） */
  function canSync() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
    if (Session.user) return Session.isAdmin();
    return validFieldSites().length > 0;
  }

  function notify(changed) {
    status.pending = Store.pending().length;
    status.rejected = Store.rejected().length;
    status.mode = mode();
    listeners.forEach(function (cb) {
      try { cb(status, changed); } catch (e) { if (global.console) console.error(e); }
    });
  }

  /* ---------------- QRの利用証明 ---------------- */
  function ensureFieldSessions(onlyIds) {
    var keys = Session.fieldKeys();
    var targets = validFieldSites().filter(function (s) { return !onlyIds || onlyIds.indexOf(s.id) >= 0; });
    lastFieldAttempt = Date.now();
    var ok = 0;
    return targets.reduce(function (p, s) {
      return p.then(function () {
        return Api.fieldSession(s.id, keys[s.id].key).then(function (res) {
          ok++;
          if (res && res.site) Session.renameFieldSite(s.id, res.site.name);
        }, function (e) {
          if (e.code !== 'bad_qr') throw e;
          // QRが作り直された・現場が削除された。この端末に残っているその現場のデータも消す
          Session.markFieldKeyInvalid(s.id);
          Store.purgeSite(s.id);
        });
      });
    }, Promise.resolve()).then(function () { return ok; });
  }

  /* ---------------- 受け取る ---------------- */
  function pullAll() {
    var m = mode();
    var cursorKey = 'cursor.' + m;
    var changed = 0;
    var retried = false;
    var pages = 0;

    function page() {
      return Api.pull(m, Store.getMeta(cursorKey) || '').then(function (data) {
        pages++;
        changed += Store.mergeRows(data.rows || []);
        Store.setMeta(cursorKey, data.cursor);
        if (m === 'field') {
          if (data.siteNames) Store.setMeta('siteNames', data.siteNames);
          var scope = data.scope || [];
          var missing = validFieldSites().map(function (s) { return s.id; })
            .filter(function (id) { return scope.indexOf(id) < 0; });
          if (missing.length && Date.now() - lastFieldAttempt > FIELD_RETRY_MS) {
            return ensureFieldSessions(missing).then(function (n) {
              if (n > 0) return page();
              return data.more && pages < 100 ? page() : null;
            });
          }
        }
        if (data.more && pages < 100) return page();
        return null;
      }, function (e) {
        if (m === 'field' && e.code === 'no_field_session' && !retried) {
          retried = true;
          return ensureFieldSessions().then(function (n) {
            if (!n) throw new Api.ApiError(401, 'no_field_access', 'この端末で使えるQRコードがありません。QRコードを読み取り直してください。');
            return page();
          });
        }
        throw e;
      });
    }
    return page().then(function () { return changed; });
  }

  /* ---------------- 送る ---------------- */
  function pushAll() {
    var m = mode();
    var items = Store.pending(m === 'admin' ? undefined : FIELD_WRITE_KINDS);
    if (!items.length) return Promise.resolve(0);
    var retried = false;
    var sent = 0;

    function batch(offset) {
      var chunk = items.slice(offset, offset + MAX_PUSH);
      if (!chunk.length) return Promise.resolve(sent);
      var kindById = {};
      var rows = chunk.map(function (it) {
        kindById[it.record.id] = it.kind;
        var data = {};
        Object.keys(it.record).forEach(function (k) {
          if (k !== '_dirty' && k !== '_rejected' && k !== 'deleted') data[k] = it.record[k];
        });
        return { id: it.record.id, kind: it.kind, data: data, deleted: !!it.record.deleted };
      });
      // 送っている間に書き換えられた記録は、送信済みにしない（次の回にもう一度送る）
      var stamp = {};
      chunk.forEach(function (it) { stamp[it.record.id] = it.record.updatedAt; });

      return Api.push(m, rows).then(function (res) {
        var bad = (res && res.rejected) || [];
        var badIds = bad.map(function (r) { return r.id; });
        var okIds = rows.map(function (r) { return r.id; }).filter(function (id) {
          if (badIds.indexOf(id) >= 0) return false;
          var cur = Store.raw(kindById[id], id);
          return cur && cur.updatedAt === stamp[id];
        });
        Store.markSynced(okIds, kindById);
        Store.markRejected(bad, kindById);
        sent += okIds.length;
        return batch(offset + MAX_PUSH);
      }, function (e) {
        if (m === 'field' && e.code === 'no_field_session' && !retried) {
          retried = true;
          return ensureFieldSessions().then(function () { return batch(offset); });
        }
        throw e;
      });
    }
    return batch(0);
  }

  /* ---------------- 1回分 ---------------- */
  function syncNow() {
    if (!canSync()) {
      notify(0);
      return Promise.resolve(0);
    }
    if (running) return running;
    status.running = true;
    notify(0);

    running = pullAll().then(function (changed) {
      // 送信できた記録があれば、「未送信」の表示を消すために画面も描き直す
      return pushAll().then(function (sent) { return changed + (sent || 0); });
    }).then(function (changed) {
      status.lastSyncAt = new Date().toISOString();
      status.lastError = null;
      return changed;
    }, function (e) {
      if (e && e.status === 401 && e.code === 'no_login') {
        // ログインの期限切れ。画面側でログインを促す
        Session.setUser(null);
      }
      status.lastError = (e && e.message) || '同期できませんでした。';
      status.lastErrorCode = (e && e.code) || '';
      return 0;
    }).then(function (changed) {
      running = null;
      status.running = false;
      notify(changed);
      return changed;
    });
    return running;
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { syncNow(); }, PUSH_DELAY_MS);
  }

  function start() {
    stop();
    syncNow();
    timer = setInterval(function () {
      if (!document.hidden) syncNow();
    }, POLL_MS);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) syncNow();
  });
  global.addEventListener('online', function () { syncNow(); });

  global.MT.sync = {
    FIELD_WRITE_KINDS: FIELD_WRITE_KINDS,
    start: start,
    stop: stop,
    syncNow: syncNow,
    schedulePush: schedulePush,
    ensureFieldSessions: ensureFieldSessions,
    canSync: canSync,
    onStatus: function (cb) { listeners.push(cb); },
    status: function () {
      status.pending = Store.pending().length;
      status.rejected = Store.rejected().length;
      status.mode = mode();
      return status;
    }
  };
})(window);
