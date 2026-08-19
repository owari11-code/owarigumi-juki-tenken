/*
 * sync.js - 端末間の自動同期（Supabase）
 *
 * ログイン画面を出さずに共有するため、Supabase の anon(公開)キーで
 * 1つのテーブル juki_records を読み書きする。
 *   id / space(共有コード) / kind(sites|machines|inspections) / data(レコード本体)
 *   / deleted / updated_at(サーバー時刻・取得の目印)
 *
 * 流れ: ①サーバーの新着を取得して取り込む → ②未送信の変更を送る
 * これを「起動時／画面を開いたとき／保存直後／一定間隔」で行う。
 */
(function (global) {
  'use strict';

  var TABLE = 'juki_records';
  var POLL_MS = 20000;      // 画面を開いている間の自動取得間隔
  var PUSH_DELAY_MS = 1200; // 保存してから送信するまでの待ち（連続保存をまとめる）
  var CURSOR_KEY = 'juki-sync-cursor';
  var EPOCH = '1970-01-01T00:00:00.000Z';

  var listeners = [];
  var timer = null;
  var pushTimer = null;
  var running = false;
  var status = {
    configured: false,
    enabled: false,
    running: false,
    lastSyncAt: null,
    lastError: null,
    pending: 0
  };

  /**
   * 入力されたURLを「https://xxxx.supabase.co」の形にそろえる。
   * 管理画面からコピーすると末尾に /rest/v1/ が付いていることがあり、
   * そのままだとパスが二重になって接続できないため、パス以降は落とす。
   */
  function normalizeUrl(raw) {
    var u = String(raw || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
      var parsed = new URL(u);
      return parsed.protocol + '//' + parsed.host;
    } catch (e) {
      return u.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
    }
  }

  function config() {
    var s = Store.getSettings();
    return {
      url: normalizeUrl(s.supabaseUrl),
      key: (s.supabaseAnonKey || '').trim(),
      space: s.space || 'default',
      enabled: s.syncEnabled !== false
    };
  }

  function isConfigured() {
    var c = config();
    return !!(c.url && c.key);
  }

  function isActive() {
    var c = config();
    return !!(c.url && c.key && c.enabled);
  }

  function cursor() {
    try { return localStorage.getItem(CURSOR_KEY) || EPOCH; } catch (e) { return EPOCH; }
  }
  function setCursor(v) {
    try { localStorage.setItem(CURSOR_KEY, v); } catch (e) { /* 保存できなくても動作は続く */ }
  }

  function headers(c, extra) {
    var h = {
      apikey: c.key,
      Authorization: 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function notify(changed) {
    status.pending = Store.pendingRecords().length;
    listeners.forEach(function (cb) {
      try { cb(status, changed); } catch (e) { /* 通知先の例外は無視 */ }
    });
  }

  /** エラー応答を、対処が分かる日本語にして返す */
  function describeError(res, body) {
    var code = '', message = '';
    try {
      var j = JSON.parse(body);
      code = j.code || '';
      message = j.message || '';
    } catch (e) {
      message = (body || '').slice(0, 120);
    }
    if (code === 'PGRST205' || code === '42P01' || /schema cache/i.test(message)) {
      return 'テーブル juki_records がまだありません。Supabase の SQL Editor で README のSQLを実行してください。';
    }
    if (code === 'PGRST125' || /Invalid path/i.test(message)) {
      return 'URLの形式が正しくありません。Project URL（https://〇〇.supabase.co）だけを入力してください。';
    }
    if (code === '42501' || /permission denied|row-level security/i.test(message)) {
      return 'アクセスが許可されていません。README のSQLのうち、ポリシー（create policy）の部分が実行されているか確認してください。';
    }
    if (res && (res.status === 401 || res.status === 403)) {
      return 'キーが正しくありません。Supabase の anon public（または publishable）キーを確認してください。';
    }
    if (res && res.status) {
      return 'サーバーエラー（' + res.status + '）' + (message ? '：' + message : '');
    }
    // 端末は通信できているのに届かない場合は、保管先(Supabase)側の停止が疑わしい
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return '端末が通信できていません。電波の状態をご確認ください。'
        + '（点検の記録は端末に保存され、つながった時点で自動送信されます）';
    }
    return 'データの保管先に接続できません。保管先が停止しているか、URLが変わった可能性があります。'
      + '事務所へご連絡ください。（点検の記録は端末に保存されています）';
  }

  function failWith(r) {
    return r.text().then(function (t) { throw new Error(describeError(r, t)); });
  }

  /* ---------------- サーバーから取得 ---------------- */
  function pull(c) {
    var url = c.url + '/rest/v1/' + TABLE +
      '?select=id,kind,data,deleted,updated_at' +
      '&space=eq.' + encodeURIComponent(c.space) +
      '&updated_at=gt.' + encodeURIComponent(cursor()) +
      '&order=updated_at.asc&limit=2000';
    return fetch(url, { headers: headers(c) })
      .then(function (r) {
        if (!r.ok) return failWith(r);
        return r.json();
      })
      .then(function (rows) {
        if (!rows.length) return 0;
        var bundle = { sites: [], machines: [], inspections: [] };
        var maxAt = cursor();
        rows.forEach(function (row) {
          if (row.updated_at > maxAt) maxAt = row.updated_at;
          if (!bundle[row.kind]) return;
          var rec = row.data || {};
          rec.id = row.id;
          rec.deleted = !!row.deleted;
          bundle[row.kind].push(rec);
        });
        var changed = Store.mergeAll(bundle, false);
        setCursor(maxAt);
        return changed;
      })
      .catch(function (e) {
        // 通信自体に失敗した場合（圏外など）は分かりやすい文言に置き換える
        var m = (e && e.message) || '';
        if (!m || /Failed to fetch|NetworkError|Load failed/i.test(m)) {
          throw new Error(describeError(null, ''));
        }
        throw e;
      });
  }

  /* ---------------- サーバーへ送信 ---------------- */
  function push(c) {
    var pending = Store.pendingRecords();
    if (!pending.length) return Promise.resolve(0);

    var rows = pending.map(function (p) {
      var data = {};
      Object.keys(p.record).forEach(function (k) {
        if (k !== '_dirty') data[k] = p.record[k];
      });
      return {
        id: p.record.id,
        space: c.space,
        kind: p.kind,
        data: data,
        deleted: !!p.record.deleted
      };
    });

    return fetch(c.url + '/rest/v1/' + TABLE, {
      method: 'POST',
      headers: headers(c, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows)
    }).then(function (r) {
      if (!r.ok) return failWith(r);
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

    var c = config();
    return pull(c)
      .then(function (changed) {
        return push(c).then(function () { return changed; });
      })
      .then(function (changed) {
        status.lastSyncAt = new Date().toISOString();
        status.lastError = null;
        running = false;
        status.running = false;
        notify(changed);
        return changed;
      })
      .catch(function (e) {
        // 送信側で通信に失敗した場合も分かりやすい文言にそろえる
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

  /** 同期状態が変わったとき（引数：status, 取り込んだ件数） */
  function onStatus(cb) { listeners.push(cb); }

  /** 接続テスト。設定画面から使う */
  function test(url, key, space) {
    var c = { url: normalizeUrl(url), key: (key || '').trim(), space: space || 'default' };
    if (!c.url || !c.key) return Promise.reject(new Error('URLとキーの両方を入力してください'));
    return fetch(c.url + '/rest/v1/' + TABLE + '?select=id&limit=1&space=eq.' + encodeURIComponent(c.space), {
      headers: headers(c)
    }).then(function (r) {
      if (!r.ok) return failWith(r);
      return true;
    }, function () {
      throw new Error(describeError(null, ''));
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
    normalizeUrl: normalizeUrl,
    test: test
  };
})(window);
