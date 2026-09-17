/*
 * views/settings.js - 設定（同期の状態・アカウント・この端末のデータ）
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var Api = MT.api;
  var Store = MT.store;
  var Session = MT.session;
  var Sync = MT.sync;
  var Cat = MT.cat;
  var esc = U.esc;

  MT.syncStateText = function (st) {
    if (!Sync.canSync()) return Session.user ? 'サーバーにつながっていません。' : 'この端末で使えるQRコードがまだありません。';
    if (st.running) return '同期しています…';
    if (st.lastError) return '同期できていません：' + st.lastError;
    var t = st.lastSyncAt ? new Date(st.lastSyncAt) : null;
    return '同期しています。最終同期 ' + (t ? t.getHours() + ':' + U.pad(t.getMinutes()) + ':' + U.pad(t.getSeconds()) : '－') +
      (st.pending ? '（未送信 ' + st.pending + ' 件）' : '');
  };

  MT.route('settings', { access: 'field', form: true }, function () {
    var user = Session.user;
    var st = Sync.status();
    var counts = Store.counts();
    var rejected = Store.rejected();

    var html = UI.pageHead('SETTINGS', '設定');

    /* 同期 */
    html += UI.h2('SYNC', '同期') + '<div class="card">' +
      '<p id="sync-state">' + esc(MT.syncStateText(st)) + '</p>' +
      (Store.isPersistent() ? '' : UI.alert('warn', 'この端末（ブラウザ）ではデータを保存できません。プライベートモードをやめるか、別のブラウザでお使いください。')) +
      UI.btnRow('<button class="btn secondary" id="b-sync">今すぐ同期</button>') +
      (rejected.length ? UI.alert('error', '<strong>サーバーが受け付けなかった記録が ' + rejected.length + ' 件あります。</strong>' +
        '事務所で内容を確認してください。<br>' + rejected.slice(0, 5).map(function (r) {
          return esc(kindLabel(r.kind) + '：' + (r.record.name || r.record.targetName || r.record.date || r.record.id) + '（' + r.record._rejected + '）');
        }).join('<br>')) : '') +
      '</div>';

    /* アカウント */
    if (user) {
      html += UI.h2('ACCOUNT', 'ログイン中のアカウント') + '<div class="card">' +
        '<p><strong>' + esc(user.name) + '</strong>　<span class="muted">ID：' + esc(user.loginId) + '　権限：' + (user.role === 'admin' ? '管理者' : '社員') + '</span></p>' +
        UI.btnRow('<a class="btn secondary" href="#/password">パスワードを変更</a>' +
          (Session.isManager() ? '<a class="btn secondary" href="#/users">事務所アカウントの管理</a>' : '') +
          '<button class="btn plain" id="b-logout">ログアウト</button>') +
        '<p class="muted">ログアウトすると、この端末に保存されている事務所用のデータを消去します（サーバーには残ります）。</p>' +
        '</div>';
    } else {
      html += UI.h2('ACCOUNT', '事務所の方') + '<div class="card"><p>現場・点検の管理、帳票の印刷は、ログインして行います。</p>' +
        UI.btnRow('<a class="btn" href="#/login">ログイン</a>') + '</div>';
    }

    /* QRで使える現場 */
    var fields = Session.fieldSites();
    if (fields.length) {
      html += UI.h2('QR', 'この端末で読み取った現場') + '<div class="card"><ul class="plain-list">' + fields.map(function (s) {
        return '<li><span>' + esc(s.name || s.id) + (s.invalid ? ' <span class="tag ng">QRが無効</span>' : '') + '</span>' +
          '<button class="btn small plain" data-forget="' + esc(s.id) + '">外す</button></li>';
      }).join('') + '</ul><p class="muted">使わなくなった現場は外してください。もう一度QRを読み取れば、また使えます。</p></div>';
    }

    /* 帳票・QR */
    if (Session.isAdmin()) {
      var base = '';
      try { base = localStorage.getItem('maruten-base-url') || ''; } catch (e) { /* 無視 */ }
      html += UI.h2('URL', 'QRコードに入れるURL') + '<div class="card">' +
        '<p class="muted">通常は変更不要です。独自のドメインで公開した場合だけ入力します（この端末で印刷するQRに反映）。</p>' +
        UI.field('公開URL', UI.text('f-base', base, UI.baseUrl())) +
        UI.btnRow('<button class="btn secondary" id="b-base">保存</button>') + '</div>';

      html += UI.h2('SERVER', 'サーバーの設定状況') + '<div class="card" id="server-state"><p class="muted">確認しています…</p></div>';
    }

    /* この端末のデータ */
    html += UI.h2('DATA', 'この端末のデータ') + '<div class="card">' +
      '<table class="kv"><tbody>' +
      '<tr><th>工事現場</th><td>' + counts.sites + ' 件</td></tr>' +
      '<tr><th>重機・機械</th><td>' + counts.machines + ' 台</td></tr>' +
      '<tr><th>点検対象</th><td>' + counts.targets + ' 件</td></tr>' +
      '<tr><th>点検記録</th><td>' + counts.inspections + ' 件</td></tr>' +
      '<tr><th>資材・入出庫</th><td>' + counts.materials + ' 件 ／ ' + counts.stock_logs + ' 件</td></tr>' +
      '<tr><th>未送信</th><td>' + counts.pending + ' 件</td></tr>' +
      '</tbody></table>' +
      UI.btnRow((Session.isAdmin() ? '<button class="btn secondary" id="b-export">データを書き出す（控え）</button>' : '') +
        '<button class="btn plain" id="b-clear">この端末のデータを消去</button>') +
      '</div>';

    html += UI.h2('ABOUT', 'このアプリについて') + '<div class="card"><p class="muted">点検項目の出典</p><ul class="source-list">' +
      Cat.all().map(function (c) { return '<li><strong>' + esc(c.name) + '</strong>：' + esc(c.source) + '</li>'; }).join('') +
      '</ul><p class="muted">玉掛け・地山/土留の点検項目は、法令の条文をもとに作成しています。社内の運用に合わせて見直してください。</p></div>';

    U.app().innerHTML = html;

    U.on('#b-sync', 'click', function () {
      U.qs('#sync-state').textContent = '同期しています…';
      Sync.syncNow().then(function () { MT.rerender(); });
    });

    U.on('#b-logout', 'click', function () {
      var pending = Store.pending().length;
      function out() {
        Api.logout().then(null, function () { /* 端末側だけでもログアウトする */ }).then(function () {
          MT.afterLogout();
          U.toast('ログアウトしました');
          U.go('#/');
        });
      }
      if (!pending) return out();
      U.toast('未送信の記録を送っています…');
      Sync.syncNow().then(function () {
        var left = Store.pending().length;
        if (left && !confirm('まだ送信できていない記録が ' + left + ' 件あります。ログアウトすると失われます。ログアウトしますか？')) return;
        out();
      });
    });

    U.qsa('[data-forget]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('この現場を、この端末から外します（この端末に残っているその現場のデータも消えます）。よろしいですか？')) return;
        var id = btn.getAttribute('data-forget');
        Session.removeFieldKey(id);
        if (!Session.isAdmin()) Store.purgeSite(id);
        MT.rerender();
      });
    });

    U.on('#b-base', 'click', function () {
      var v = U.val('#f-base');
      if (v && !/^https:\/\//i.test(v)) return U.toast('https:// で始まるURLを入力してください');
      try {
        if (v) localStorage.setItem('maruten-base-url', v.replace(/#.*$/, ''));
        else localStorage.removeItem('maruten-base-url');
      } catch (e) { /* 無視 */ }
      U.toast('保存しました');
    });

    U.on('#b-export', 'click', function () {
      U.download('マル点データ_' + U.todayStr() + '.json', Store.exportAll(), 'application/json');
    });

    U.on('#b-clear', 'click', function () {
      var pending = Store.pending().length;
      if (!confirm('この端末に保存されているデータを消去します（サーバーのデータは消えません）。' +
        (pending ? '\n\n※まだ送信していない記録が ' + pending + ' 件あり、それも消えます。' : '') + '\nよろしいですか？')) return;
      Store.clear(false);
      U.toast('消去しました');
      Sync.syncNow();
      U.go('#/');
    });

    if (Session.isAdmin()) {
      Api.serverStatus().then(function (s) {
        var box = U.qs('#server-state');
        if (!box) return;
        function mark(ok, label) { return '<div>' + (ok ? '✓ ' : '× ') + esc(label) + '</div>'; }
        box.innerHTML = mark(s.database, 'データベース接続') + mark(s.session, 'ログイン・QRの証明（SESSION_SECRET）') +
          mark(s.turnstile, '自動化アクセスの遮断（Turnstile）') + mark(s.keepalive, '自動停止の防止（KEEPALIVE_TOKEN）');
      }, function (e) {
        var box = U.qs('#server-state');
        if (box) box.innerHTML = UI.alert('error', 'サーバーに接続できません：' + esc(e.message));
      });
    }
  });

  function kindLabel(kind) {
    return {
      inspections: '点検記録', stock_logs: '資材の入出庫', machine_logs: '機械の搬入・搬出', lends: '工具の貸出',
      sites: '工事現場', machines: '機械', targets: '点検対象', materials: '資材', tools: '工具', tasks: '工程',
      progress_logs: '進捗', staff: '社員', assignments: '配置'
    }[kind] || kind;
  }
})(window);
