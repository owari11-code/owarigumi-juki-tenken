/*
 * views/auth.js - ログイン・初期設定・パスワード変更・アカウント管理
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var Api = MT.api;
  var Session = MT.session;
  var esc = U.esc;

  function busy(btn, on, label) {
    if (!btn) return;
    btn.disabled = on;
    if (label) btn.textContent = label;
  }

  function showError(e) {
    var box = U.qs('#form-error');
    if (box) {
      box.innerHTML = UI.alert('error', esc(e.message || '処理できませんでした。'));
      box.scrollIntoView({ block: 'center' });
    } else {
      U.toast(e.message || '処理できませんでした。', 'error');
    }
  }

  /** 推測されにくい仮パスワード（紛らわしい文字は使わない） */
  function tempPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    var a = new Uint8Array(12);
    crypto.getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += chars.charAt(a[i] % chars.length);
    return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
  }

  /* ------------------------------------------------------------------ *
   * ログイン
   * ------------------------------------------------------------------ */
  MT.route('login', { access: 'public', form: true }, function (m, params) {
    if (Session.isAdmin()) return U.go(params.next && params.next.indexOf('#/') === 0 ? params.next : '#/');

    U.app().innerHTML =
      UI.pageHead('LOGIN', '事務所ログイン') +
      '<div id="form-error"></div>' +
      '<div class="card">' +
      UI.field('ID', UI.text('f-login', '', '', ' autocomplete="username" autocapitalize="off" spellcheck="false"'), true) +
      UI.field('パスワード', '<input type="password" id="f-pass" autocomplete="current-password">', true) +
      UI.checkbox('f-remember', 'この端末でログインを保持する（14日間）', false) +
      UI.btnRow('<button class="btn lead" id="b-login">ログイン</button>') +
      '</div>' +
      UI.alert('info', '<strong>現場の方はログイン不要です。</strong>現場に掲示されたQRコード、または機械・資材に貼られたQRコードを読み取ってください。') +
      UI.btnRow('<a class="btn secondary" href="#/scan">■ QRを読み取る</a>') +
      '<details class="help"><summary>ID・パスワードが分からないとき</summary>' +
      '<p><strong>ほかの管理者がいる場合</strong><br>その人に <strong>設定 → 事務所アカウントの管理</strong> を開いてもらい、' +
      'あなたのアカウントの「パスワードを再発行」を押してもらってください。仮パスワードが表示されます。</p>' +
      '<p><strong>管理者も入れない場合</strong><br>Supabase の管理画面（SQL Editor）から、仮パスワードを発行できます。' +
      '手順は <strong>sql/recover.sql</strong>（手順書の「ログインできないとき」）にあります。' +
      'この操作ができるのは、Supabase にログインできる人だけです。</p>' +
      '<p class="muted">保存してあるパスワードは暗号化されていて、元の文字に戻すことはできません。' +
      '思い出すのではなく、新しいものに作り直す形になります。</p></details>' +
      '<p class="muted" id="setup-link"></p>';

    Api.setupStatus().then(function (s) {
      if (s && s.needed) {
        var el = U.qs('#setup-link');
        if (el) el.innerHTML = '管理者がまだ登録されていません。<a href="#/setup">初期設定はこちら</a>';
      }
    }, function (e) {
      // 保管先が止まっている等。何が起きているのか分かるように出す
      var el = U.qs('#setup-link');
      if (el) el.textContent = (e && e.message) || '';
    });

    function submit() {
      var loginId = U.val('#f-login');
      var pass = U.qs('#f-pass').value;
      if (!loginId || !pass) return showError({ message: 'IDとパスワードを入力してください。' });
      var btn = U.qs('#b-login');
      busy(btn, true, '確認しています…');
      Api.login(loginId, pass, U.checked('#f-remember')).then(function (user) {
        MT.afterLogin(user);
        U.toast(user.name + ' さん、ログインしました');
        if (user.mustChange) return U.go('#/password');
        U.go(params.next && params.next.indexOf('#/') === 0 && params.next.indexOf('#/login') !== 0 ? params.next : '#/');
      }, function (e) {
        busy(btn, false, 'ログイン');
        showError(e);
      });
    }
    U.on('#b-login', 'click', submit);
    U.on('#f-pass', 'keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    var first = U.qs('#f-login');
    if (first) first.focus();
  });

  /* ------------------------------------------------------------------ *
   * 初期設定（最初の管理者）
   * ------------------------------------------------------------------ */
  MT.route('setup', { access: 'public', form: true }, function () {
    U.app().innerHTML =
      UI.backLink('#/login', 'ログインへ戻る') +
      UI.pageHead('SETUP', '初期設定（最初の管理者）') +
      UI.alert('info', 'Supabase で準備用のSQLを実行したときに表示された<strong>「初期設定コード」</strong>を入力してください。' +
        'ここで登録した人が管理者になり、ほかの社員のアカウントを作れるようになります。') +
      '<div id="form-error"></div>' +
      '<div class="card">' +
      UI.field('初期設定コード', UI.text('f-code', '', '例：A1B2C3D4E5F6', ' autocapitalize="characters" spellcheck="false"'), true) +
      UI.field('ID（ログインに使う名前）', UI.text('f-login', '', '例：owari', ' autocapitalize="off" spellcheck="false"'), true,
        '半角の英小文字・数字・記号（. _ -）で3〜40文字') +
      UI.field('氏名', UI.text('f-name', '', '例：尾割 順一'), true, '点検記録の「確認」欄に、この名前が入ります') +
      UI.field('パスワード', '<input type="password" id="f-pass" autocomplete="new-password">', true, '10文字以上') +
      UI.field('パスワード（確認）', '<input type="password" id="f-pass2" autocomplete="new-password">', true) +
      UI.btnRow('<button class="btn lead" id="b-setup">管理者を登録してログイン</button>') +
      '</div>';

    U.on('#b-setup', 'click', function () {
      var p1 = U.qs('#f-pass').value, p2 = U.qs('#f-pass2').value;
      if (p1 !== p2) return showError({ message: 'パスワード（確認）が一致しません。' });
      if (p1.length < 10) return showError({ message: 'パスワードは10文字以上にしてください。' });
      var btn = U.qs('#b-setup');
      busy(btn, true, '登録しています…');
      Api.setup(U.val('#f-code'), U.val('#f-login'), U.val('#f-name'), p1).then(function (user) {
        MT.afterLogin(user);
        U.toast('管理者を登録しました');
        U.go('#/');
      }, function (e) {
        busy(btn, false, '管理者を登録してログイン');
        showError(e);
      });
    });
  });

  /* ------------------------------------------------------------------ *
   * パスワード変更
   * ------------------------------------------------------------------ */
  MT.route('password', { access: 'public', form: true }, function () {
    if (!Session.user) return U.go('#/login');
    var must = Session.user.mustChange;
    U.app().innerHTML =
      (must ? '' : UI.backLink('#/settings', '設定へ戻る')) +
      UI.pageHead('PASSWORD', 'パスワードの変更') +
      (must ? UI.alert('warn', '<strong>最初にパスワードを変更してください。</strong>管理者から伝えられた仮のパスワードは、ここで自分だけが知るパスワードに変えます。') : '') +
      '<div id="form-error"></div>' +
      '<div class="card">' +
      UI.field('今のパスワード', '<input type="password" id="f-cur" autocomplete="current-password">', true) +
      UI.field('新しいパスワード', '<input type="password" id="f-new" autocomplete="new-password">', true, '10文字以上') +
      UI.field('新しいパスワード（確認）', '<input type="password" id="f-new2" autocomplete="new-password">', true) +
      UI.btnRow('<button class="btn lead" id="b-change">変更する</button>') +
      '<p class="muted">変更すると、ほかの端末でのログインは切れます（この端末はそのまま使えます）。</p>' +
      '</div>';

    U.on('#b-change', 'click', function () {
      var cur = U.qs('#f-cur').value, n1 = U.qs('#f-new').value, n2 = U.qs('#f-new2').value;
      if (n1 !== n2) return showError({ message: '新しいパスワード（確認）が一致しません。' });
      if (n1.length < 10) return showError({ message: 'パスワードは10文字以上にしてください。' });
      var btn = U.qs('#b-change');
      busy(btn, true, '変更しています…');
      Api.changePassword(cur, n1).then(function (user) {
        MT.afterLogin(user);
        U.toast('パスワードを変更しました');
        U.go('#/');
      }, function (e) {
        busy(btn, false, '変更する');
        showError(e);
      });
    });
  });

  /* ------------------------------------------------------------------ *
   * アカウント管理（管理者）
   * ------------------------------------------------------------------ */
  MT.route('users', { access: 'manager', form: true }, function () {
    U.app().innerHTML = UI.backLink('#/settings', '設定へ戻る') + UI.pageHead('ACCOUNTS', '事務所アカウント') +
      '<div class="card"><p>読み込んでいます…</p></div>';

    Api.users().then(render, function (e) {
      U.app().innerHTML = UI.backLink('#/settings', '設定へ戻る') + UI.pageHead('ACCOUNTS', '事務所アカウント') +
        UI.alert('error', esc(e.message));
    });

    function render(users) {
      var me = Session.user;
      var html = UI.backLink('#/settings', '設定へ戻る') + UI.pageHead('ACCOUNTS', '事務所アカウント') +
        '<div id="form-error"></div>' +
        UI.alert('info', 'アカウントは事務所で使う人だけに作ります。現場で点検・記録するだけの方（協力会社を含む）には不要です（QRコードで使えます）。');

      html += '<ul class="list">';
      users.forEach(function (u) {
        var tags = [{ cls: u.role === 'admin' ? 'done' : 'none', text: u.role === 'admin' ? '管理者' : '社員' }];
        if (!u.active) tags.push({ cls: 'ng', text: '無効' });
        if (u.locked) tags.push({ cls: 'ng', text: 'ロック中' });
        if (u.mustChange) tags.push({ cls: 'warn', text: '仮パスワード' });
        html += '<li class="user-row" data-user="' + esc(u.id) + '">' +
          '<div class="card tight">' +
          '<div class="user-head"><strong>' + esc(u.name) + '</strong> <span class="muted">ID: ' + esc(u.loginId) + '</span>' +
          (me && me.id === u.id ? ' <span class="tag ok">自分</span>' : '') + '</div>' +
          '<div class="tags">' + tags.map(UI.tag).join('') + '</div>' +
          '<p class="muted">最終ログイン：' + (u.lastLoginAt ? esc(U.formatStamp(u.lastLoginAt).date + ' ' + U.formatStamp(u.lastLoginAt).time) : '－') + '</p>' +
          '<div class="btn-row">' +
          '<button class="btn small secondary" data-act="role">' + (u.role === 'admin' ? '社員にする' : '管理者にする') + '</button>' +
          '<button class="btn small secondary" data-act="active">' + (u.active ? '無効にする' : '有効に戻す') + '</button>' +
          '<button class="btn small secondary" data-act="reset">パスワード再発行</button>' +
          '</div></div></li>';
      });
      html += '</ul>';

      html += UI.h2('NEW', 'アカウントを追加') +
        '<div class="card">' +
        UI.field('ID（ログインに使う名前）', UI.text('n-login', '', '例：tanaka', ' autocapitalize="off" spellcheck="false"'), true,
          '半角の英小文字・数字・記号（. _ -）で3〜40文字') +
        UI.field('氏名', UI.text('n-name', '', '例：田中 一郎'), true) +
        UI.field('権限', UI.select('n-role', [['staff', '社員（現場・記録の管理）'], ['admin', '管理者（アカウントの管理もできる）']], 'staff')) +
        UI.field('仮パスワード', UI.text('n-pass', tempPassword(), '', ' spellcheck="false"'), true, '本人に伝えてください。初回ログイン時に変更を求められます') +
        UI.btnRow('<button class="btn" id="b-create">追加する</button>') +
        '</div>';

      U.app().innerHTML = html;

      U.on('#b-create', 'click', function () {
        var payload = { action: 'create', loginId: U.val('#n-login'), name: U.val('#n-name'), role: U.val('#n-role'), password: U.val('#n-pass') };
        if (!payload.loginId || !payload.name) return showError({ message: 'IDと氏名を入力してください。' });
        Api.manageUser(payload).then(function () {
          alert('アカウントを追加しました。\n\nID：' + payload.loginId + '\n仮パスワード：' + payload.password + '\n\n本人に伝えてください（この画面を閉じると再表示できません）。');
          MT.rerender();
        }, showError);
      });

      U.qsa('.user-row').forEach(function (row) {
        var id = row.getAttribute('data-user');
        var u = users.filter(function (x) { return x.id === id; })[0];
        row.addEventListener('click', function (ev) {
          var btn = ev.target.closest('[data-act]');
          if (!btn) return;
          var act = btn.getAttribute('data-act');
          if (act === 'role') {
            var next = u.role === 'admin' ? 'staff' : 'admin';
            if (!confirm(u.name + ' さんを' + (next === 'admin' ? '管理者' : '社員') + 'にします。よろしいですか？')) return;
            Api.manageUser({ action: 'update', id: id, role: next }).then(MT.rerender, showError);
          } else if (act === 'active') {
            if (!confirm(u.name + ' さんのアカウントを' + (u.active ? '無効にします（ログイン中の端末もすぐ使えなくなります）' : '有効に戻します') + '。よろしいですか？')) return;
            Api.manageUser({ action: 'update', id: id, active: !u.active }).then(MT.rerender, showError);
          } else if (act === 'reset') {
            var pw = tempPassword();
            if (!confirm(u.name + ' さんのパスワードを再発行します。今のパスワードは使えなくなります。よろしいですか？')) return;
            Api.manageUser({ action: 'reset', id: id, password: pw }).then(function () {
              alert('パスワードを再発行しました。\n\nID：' + u.loginId + '\n仮パスワード：' + pw + '\n\n本人に伝えてください。');
              MT.rerender();
            }, showError);
          }
        });
      });
    }
  });
})(window);
