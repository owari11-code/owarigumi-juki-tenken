/*
 * app.js - 画面の切り替え（ハッシュのルーティング）と起動
 * 画面の登録口は core/router.js。ここは登録された画面を、URLに合わせて描く。
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var Session = MT.session;
  var Store = MT.store;
  var Sync = MT.sync;
  var Api = MT.api;

  var routes = MT.routes;
  var current = null;
  var LAST_USER = 'maruten-last-user';

  /* ------------------------------------------------------------------ *
   * ヘッダー
   * ------------------------------------------------------------------ */
  function updateHeader() {
    var user = Session.user;
    var btn = document.getElementById('nav-user');
    var nav = document.getElementById('main-nav');
    if (btn) {
      if (user) {
        btn.textContent = user.name;
        btn.href = '#/settings';
      } else {
        btn.textContent = '事務所ログイン';
        btn.href = '#/login';
      }
    }
    if (nav) nav.hidden = !Session.isAdmin();
    var p = U.parseHash().path;
    var key = !p.length ? 'home'
      : (p[0] === 'sites' || p[0] === 'site') ? 'sites'
      : (p[0] === 'tools' || p[0] === 'tool') ? 'tools'
      : (p[0] === 'staffing' || p[0] === 'staff') ? 'staff'
      : (p[0] === 'settings' || p[0] === 'users') ? 'settings' : '';
    U.qsa('[data-nav]', document).forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('data-nav') === key);
    });
  }

  function updateSyncChip(st) {
    var chip = document.getElementById('sync-chip');
    if (!chip) return;
    var cls = 'sync-chip ';
    var label;
    if (!Sync.canSync()) { cls += 'off'; label = Session.user ? 'オフライン' : '未接続'; }
    else if (st.running) { cls += 'busy'; label = '同期中'; }
    else if (st.lastError && (st.lastErrorCode === 'offline' || st.lastErrorCode === 'network')) {
      // 圏外は異常ではない。記録は端末に残り、つながれば送られる
      cls += 'busy';
      label = st.pending ? '圏外・未送信 ' + st.pending : '圏外';
    }
    else if (st.lastError) { cls += 'error'; label = '同期エラー'; }
    else if (st.rejected) { cls += 'error'; label = '送信不可 ' + st.rejected; }
    else if (st.pending) { cls += 'busy'; label = '未送信 ' + st.pending; }
    else { cls += 'ok'; label = '同期済'; }
    chip.className = cls;
    chip.textContent = label;
    chip.title = st.lastError || '';
  }

  /* ------------------------------------------------------------------ *
   * QRコードからの入口  #q=<内容>
   * ------------------------------------------------------------------ */
  var TYPE_ROUTE = { site: '#/site/', m: '#/machine/', g: '#/target/', mat: '#/material/', tool: '#/tool/' };
  var TYPE_KIND = { m: 'machines', g: 'targets', mat: 'materials', tool: 'tools' };

  function handleQr(encoded) {
    var p;
    try { p = JSON.parse(U.b64urlDecode(encoded)); } catch (e) { p = null; }
    if (!p || p.v !== 2 || typeof p.s !== 'string' || typeof p.k !== 'string' || !TYPE_ROUTE[p.t]) {
      return MT.notFound('QRコードの内容を読み取れませんでした。');
    }
    var dest = TYPE_ROUTE[p.t] + encodeURIComponent(p.t === 'site' ? p.s : p.i);

    function land() {
      if (p.t !== 'site' && !Store.get(TYPE_KIND[p.t], p.i)) {
        return MT.notFound('QRコードの対象が見つかりません。削除されたか、事務所でQRコードが作り直された可能性があります。');
      }
      location.replace(location.href.split('#')[0] + dest);
    }

    if (Session.isAdmin()) {
      if (p.t !== 'site' && !Store.get(TYPE_KIND[p.t], p.i)) {
        MT.loading();
        Sync.syncNow().then(land, land);
        return;
      }
      return land();
    }

    Session.addFieldKey(p.s, p.k, '', p.t === 'tool');
    MT.loading('QRコードを確認しています…');
    Api.fieldSession(p.s, p.k).then(function (res) {
      if (res && res.site) Session.addFieldKey(p.s, p.k, res.site.name, res.site.depot);
      MT.loading('データを読み込んでいます…');
      return Sync.syncNow();
    }).then(function () {
      if (Sync.status().lastError && !Store.get('sites', p.s)) {
        return MT.notFound('データを読み込めませんでした：' + Sync.status().lastError);
      }
      land();
    }, function (e) {
      if (e.code === 'bad_qr') {
        Session.removeFieldKey(p.s);
        return MT.notFound(e.message);
      }
      // 電波が無いときは、この端末に残っているデータで開く
      if (Store.get('sites', p.s)) return land();
      MT.notFound('QRコードを確認できませんでした：' + e.message);
    });
  }

  /* ------------------------------------------------------------------ *
   * ルーター
   * ------------------------------------------------------------------ */
  function route() {
    var h = U.parseHash();
    global.scrollTo(0, 0);
    if (MT.stopScan) MT.stopScan();
    document.body.classList.remove('printing');
    updateHeader();

    if (h.qr !== undefined) return handleQr(h.qr);
    if (h.legacyQr) {
      return MT.notFound('古い形式のQRコードです。事務所で新しいQRコードを印刷してもらってください。');
    }

    var path = h.path.join('/');
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(path);
      if (!m) continue;
      var r = routes[i];
      var access = r.opts.access || 'admin';
      if ((access === 'admin' || access === 'manager') && !Session.user) {
        return U.go('#/login' + U.query({ next: location.hash }));
      }
      if (Session.user && Session.user.mustChange && path !== 'password' && access !== 'public') {
        return U.go('#/password');
      }
      if (access === 'manager' && !Session.isManager()) {
        return MT.notFound('この画面は管理者だけが使えます。');
      }
      current = r;
      if (r.opts.print) document.body.classList.add('printing');
      try {
        r.render(m.slice(1).map(function (x) { return x === undefined ? x : decodeURIComponent(x); }), h.params);
      } catch (e) {
        if (global.console) console.error(e);
        MT.notFound('表示中に問題が発生しました：' + e.message);
      }
      return;
    }
    current = null;
    MT.notFound();
  }

  MT.rerender = route;

  global.addEventListener('hashchange', route);

  /* ------------------------------------------------------------------ *
   * 起動
   * ------------------------------------------------------------------ */
  function rememberUser(user) {
    try {
      if (user) localStorage.setItem(LAST_USER, JSON.stringify(user));
      else localStorage.removeItem(LAST_USER);
    } catch (e) { /* 無視 */ }
  }

  Session.onChange(function () {
    updateHeader();
  });

  Store.onChange(function (local) {
    if (local) Sync.schedulePush();
    updateSyncChip(Sync.status());
  });

  /** 入力の途中（小さな入力欄を開いている・文字を打っている）なら描き直さない */
  function isEditing() {
    var el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && U.app().contains(el)) return true;
    return !!U.app().querySelector('.inline-form');
  }

  Sync.onStatus(function (st, changed) {
    // 以前のアプリで登録した現場には、同期のあとでQRの鍵を付ける（事務所のみ）
    if (!st.running && !st.lastError && Session.isAdmin() && MT.model.ensureSiteKeys()) {
      Sync.schedulePush();
    }
    updateSyncChip(st);
    if (changed && current && !current.opts.form && !current.opts.print && !isEditing()) route();
    var box = document.getElementById('sync-state');
    if (box && MT.syncStateText) box.textContent = MT.syncStateText(st);
  });

  MT.afterLogin = function (user) {
    rememberUser(user);
    Session.setUser(user);
    Sync.start();
  };

  MT.afterLogout = function () {
    rememberUser(null);
    Store.clear(false);
    Session.setUser(null);
    Sync.start();
  };

  Store.ready.then(function () {
    return Api.me().then(function (user) {
      rememberUser(user);
      Session.setUser(user);
    }, function () {
      // サーバーにつながらない（電波が無い等）。前回ログインしていた人として、端末内のデータで開く
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(LAST_USER) || 'null'); } catch (e) { cached = null; }
      Session.setUser(cached);
    });
  }).then(function () {
    route();
    updateSyncChip(Sync.status());
    Sync.start();
  });
})(window);
