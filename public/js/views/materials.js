/*
 * views/materials.js - 資材（在庫・搬入・使用・搬出・棚卸、受払簿の印刷）
 *
 * 在庫数は記録（stock_logs）を日付順に足し引きして求める。
 * 「棚卸」の記録は、その時点の数量をその値にそろえる（数え直しの反映）。
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var M = MT.model;
  var Store = MT.store;
  var Session = MT.session;
  var A = MT.assets;
  var esc = U.esc;

  function typeInfo(id) {
    return A.STOCK_TYPES.filter(function (t) { return t.id === id; })[0] || A.STOCK_TYPES[0];
  }

  /* ------------------------------------------------------------------ *
   * 現場の「資材」タブ
   * ------------------------------------------------------------------ */
  MT.siteTabs.materials = {
    label: '資材',
    badge: function (site) {
      var low = Store.list('materials', null, site.id).filter(M.stockLow).length;
      return low ? '!' + low : '';
    },
    render: function (site) {
      var sid = encodeURIComponent(site.id);
      var list = Store.list('materials', null, site.id).sort(U.byName);
      var html = '<p class="muted">資材ごとにQRラベルを貼っておくと、現場で読み取って搬入・使用を記録できます。在庫が「発注点」以下になるとお知らせします。</p>';
      if (!list.length) html += UI.empty('まだ資材が登録されていません。');
      html += '<ul class="list">' + list.map(function (mat) {
        var s = M.stock(mat);
        var last = s.rows.length ? s.rows[s.rows.length - 1].log : null;
        var tags = [];
        if (M.stockLow(mat)) tags.push({ cls: 'warn', text: '発注点以下' });
        return '<li>' + UI.rowLink('#/material/' + encodeURIComponent(mat.id), {
          count: U.fmtNum(s.qty), unit: mat.unit || '',
          countClass: M.stockLow(mat) ? '' : 'done',
          main: mat.name,
          subHtml: esc([mat.spec, mat.place].filter(Boolean).join(' ／ ')) +
            (last ? '<br>最終記録 ' + esc(U.formatShort(last.date)) + ' ' + esc(typeInfo(last.type).name) : ''),
          tags: tags
        }) + '</li>';
      }).join('') + '</ul>';
      html += UI.btnRow('<a class="btn small secondary" href="#/material/new?site=' + sid + '">＋ 資材を登録</a>' +
        (list.length ? '<a class="btn small plain" href="#/print/labels?site=' + sid + '&kind=materials">QRラベルを印刷</a>' +
          '<a class="btn small plain" href="#/print/stock?site=' + sid + '&ym=' + U.thisMonth() + '">受払簿を印刷</a>' : ''));
      return html;
    }
  };

  /* ------------------------------------------------------------------ *
   * 登録・編集
   * ------------------------------------------------------------------ */
  function materialForm(mat, siteId) {
    var isNew = !mat;
    mat = mat || { siteId: siteId };
    var site = Store.get('sites', mat.siteId);
    if (!site) return MT.notFound('現場が見つかりません。');
    var back = isNew ? '#/site/' + encodeURIComponent(site.id) + '?tab=materials' : '#/material/' + encodeURIComponent(mat.id);

    U.app().innerHTML = UI.backLink(back, '戻る') +
      UI.pageHead('MATERIAL', isNew ? '資材の登録' : '資材の編集') +
      '<div class="card">' +
      UI.field('資材名', UI.text('f-name', mat.name, '例：生コンクリート／異形鉄筋 D13／大型土のう'), true) +
      UI.field('規格', UI.text('f-spec', mat.spec, '例：24-8-40BB／SD295A')) +
      '<div class="field-row">' +
      UI.field('単位', UI.text('f-unit', mat.unit, '例：m3、t、本、袋'), true) +
      UI.field('発注点', UI.number('f-min', mat.minQty, ' step="any" min="0"'), false, 'この数量以下でお知らせ') +
      '</div>' +
      UI.field('保管場所', UI.text('f-place', mat.place, '例：資材置場A')) +
      UI.field('仕入先', UI.text('f-supplier', mat.supplier, '例：○○建材')) +
      UI.field('備考', UI.textarea('f-note', mat.note)) +
      (isNew ? UI.field('最初の在庫数（任意）', UI.number('f-initial', '', ' step="any" min="0"'), false, '入力すると「棚卸」として記録します') : '') +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="' + esc(back) + '">キャンセル</a>') +
      (isNew ? '' : UI.btnRow('<button class="btn danger" id="b-del">この資材を削除</button>') +
        '<p class="muted">削除すると、この資材の入出庫の記録も削除されます。</p>');

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name'), unit = U.val('#f-unit');
      if (!name) { U.toast('資材名を入力してください'); return U.qs('#f-name').focus(); }
      if (!unit) { U.toast('単位を入力してください'); return U.qs('#f-unit').focus(); }
      mat.name = name;
      mat.spec = U.val('#f-spec');
      mat.unit = unit;
      mat.minQty = U.num(U.val('#f-min'));
      mat.place = U.val('#f-place');
      mat.supplier = U.val('#f-supplier');
      mat.note = U.val('#f-note');
      Store.put('materials', mat);
      if (isNew) {
        var initial = U.num(U.val('#f-initial'));
        if (initial !== null) {
          Store.put('stock_logs', { siteId: mat.siteId, materialId: mat.id, type: 'adjust', qty: initial, date: U.todayStr(), person: Session.user ? Session.user.name : '', note: '登録時の在庫' });
        }
      }
      U.toast('保存しました');
      U.go('#/material/' + encodeURIComponent(mat.id));
    });
    U.on('#b-del', 'click', function () {
      if (!confirm('「' + mat.name + '」と、その入出庫の記録をすべて削除します。よろしいですか？')) return;
      M.stockLogs(mat).forEach(function (l) { Store.remove('stock_logs', l.id); });
      Store.remove('materials', mat.id);
      U.toast('削除しました');
      U.go('#/site/' + encodeURIComponent(mat.siteId) + '?tab=materials');
    });
  }

  MT.route('material/new', { form: true }, function (m, params) { materialForm(null, params.site); });
  MT.route('material/([^/]+)/edit', { form: true }, function (m) {
    var mat = Store.get('materials', m[0]);
    if (!mat) return MT.notFound('資材が見つかりません。');
    materialForm(mat);
  });

  /* ------------------------------------------------------------------ *
   * 資材の画面（QRから開く）
   * ------------------------------------------------------------------ */
  MT.route('material/([^/]+)', { access: 'field' }, function (m) {
    var mat = Store.get('materials', m[0]);
    if (!mat) {
      if (MT.sync.status().running) return MT.loading();
      return MT.notFound('資材が見つかりません。');
    }
    if (!MT.requireSiteAccess(mat.siteId)) return;
    var site = Store.get('sites', mat.siteId) || {};
    var admin = Session.isAdmin();
    var s = M.stock(mat);

    var html = UI.backLink('#/site/' + encodeURIComponent(mat.siteId) + (admin ? '?tab=materials' : ''), '現場へ戻る') +
      UI.pageHead('MATERIAL', mat.name) +
      UI.stat(U.fmtNum(s.qty) + '<span class="of"> ' + esc(mat.unit || '') + '</span>',
        '現在の在庫<br>' + esc([mat.spec, mat.place].filter(Boolean).join('　／　')) +
        (mat.minQty !== null && mat.minQty !== undefined && mat.minQty !== '' ? '<br>発注点 ' + U.fmtNum(mat.minQty) + ' ' + esc(mat.unit || '') : '') +
        (M.stockLow(mat) ? '<br><span class="ng">発注点以下です</span>' : ''));

    html += UI.h2('RECORD', '記録する') +
      '<div class="stock-buttons">' + A.STOCK_TYPES.map(function (t) {
        return '<button class="btn ' + (t.id === 'use' ? '' : 'secondary') + '" data-stock="' + t.id + '">' + esc(t.name) + '</button>';
      }).join('') + '</div><div id="stock-form"></div>';

    var rows = s.rows.slice().reverse();
    html += UI.h2('HISTORY', '入出庫の記録（' + rows.length + '件）');
    if (!rows.length) html += UI.empty('まだ記録がありません。');
    else {
      html += '<div class="table-scroll"><table class="data compact-table"><thead><tr><th>日付</th><th>区分</th><th class="r">数量</th><th class="r">残</th><th>記録者・備考</th></tr></thead><tbody>' +
        rows.slice(0, 60).map(function (r) {
          var l = r.log;
          var t = typeInfo(l.type);
          var qty = l.type === 'adjust' ? '＝' + U.fmtNum(U.num(l.qty)) : (t.sign > 0 ? '＋' : '−') + U.fmtNum(U.num(l.qty));
          return '<tr' + (l._dirty ? ' class="unsent"' : '') + '><td>' + esc(U.formatShort(l.date)) + '</td><td>' + esc(t.name.replace('（数量を合わせる）', '')) + '</td>' +
            '<td class="r">' + esc(qty) + '</td><td class="r">' + esc(U.fmtNum(r.balance)) + '</td>' +
            '<td>' + esc([l.person, l.note].filter(Boolean).join('　')) +
            (admin ? ' <button class="link-btn" data-dellog="' + esc(l.id) + '">削除</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      if (rows.length > 60) html += '<p class="muted">古い記録は「受払簿を印刷」で確認できます。</p>';
    }

    if (admin) {
      html += UI.h2('QR', 'この資材のQRコード') +
        '<div class="card qr-box"><div id="qr"></div><div class="qr-url">読み取ると、この画面が開きます（ログイン不要）</div></div>' +
        UI.btnRow('<a class="btn secondary" href="#/print/labels?site=' + encodeURIComponent(site.id) + '&kind=one-material&id=' + encodeURIComponent(mat.id) + '">QRラベルを印刷</a>' +
          '<a class="btn secondary" href="#/print/stock?site=' + encodeURIComponent(site.id) + '&material=' + encodeURIComponent(mat.id) + '&ym=' + U.thisMonth() + '">受払簿を印刷</a>' +
          '<a class="btn plain" href="#/material/' + encodeURIComponent(mat.id) + '/edit">登録内容を編集</a>');
    }

    U.app().innerHTML = html;
    if (admin) UI.drawQr(U.qs('#qr'), UI.qrUrl('mat', site, mat), 220);

    U.qsa('[data-stock]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = typeInfo(btn.getAttribute('data-stock'));
        var person = '';
        try { person = localStorage.getItem('maruten-last-inspector') || ''; } catch (e) { /* 無視 */ }
        U.qs('#stock-form').innerHTML = '<div class="inline-form">' +
          '<div class="inline-title">' + esc(t.name) + '</div>' +
          '<div class="field-row">' +
          UI.field(t.id === 'adjust' ? '数え直した数量' : '数量', UI.number('s-qty', '', ' step="any" min="0"'), true) +
          UI.field('単位', '<input type="text" value="' + esc(mat.unit || '') + '" disabled>') +
          '</div>' +
          '<div class="field-row">' + UI.field('日付', UI.date('s-date', U.todayStr()), true) + UI.field('記録者', UI.text('s-person', person), true) + '</div>' +
          UI.field('備考', UI.text('s-note', '', t.id === 'in' ? '例：伝票No. ○○' : t.id === 'use' ? '例：No.3 擁壁' : '')) +
          UI.btnRow('<button class="btn" id="s-save">記録する</button><button class="btn plain" id="s-cancel">やめる</button>') +
          '</div>';
        var q = U.qs('#s-qty');
        if (q) q.focus();
        U.on('#s-cancel', 'click', function () { U.qs('#stock-form').innerHTML = ''; });
        U.on('#s-save', 'click', function () {
          var qty = U.num(U.val('#s-qty'));
          var date = U.val('#s-date');
          var who = U.val('#s-person');
          if (qty === null || qty < 0) return U.toast('数量を入力してください');
          if (!U.isDate(date)) return U.toast('日付を入力してください');
          if (!who) return U.toast('記録者を入力してください');
          var now = M.stock(mat).qty;
          if ((t.id === 'use' || t.id === 'out') && qty > now &&
              !confirm('在庫（' + U.fmtNum(now) + ' ' + (mat.unit || '') + '）より多い数量です。このまま記録しますか？')) return;
          Store.put('stock_logs', { siteId: mat.siteId, materialId: mat.id, type: t.id, qty: qty, date: date, person: who, note: U.val('#s-note') });
          try { localStorage.setItem('maruten-last-inspector', who); } catch (e) { /* 無視 */ }
          U.toast(t.name.replace('（数量を合わせる）', '') + 'を記録しました');
          MT.rerender();
        });
      });
    });

    U.qsa('[data-dellog]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('この記録を削除します。在庫数も変わります。よろしいですか？')) return;
        Store.remove('stock_logs', btn.getAttribute('data-dellog'));
        MT.rerender();
      });
    });
  });

  /* ------------------------------------------------------------------ *
   * 印刷：資材受払簿（月ごと）
   * ------------------------------------------------------------------ */
  MT.route('print/stock', { print: true }, function (m, params) {
    var site = Store.get('sites', params.site);
    if (!site) return MT.notFound('現場が見つかりません。');
    var ym = U.isYm(params.ym) ? params.ym : U.thisMonth();
    var from = ym + '-01', to = ym + '-' + U.pad(U.daysInMonth(ym));
    var mats = Store.list('materials', function (x) { return !params.material || x.id === params.material; }, site.id).sort(U.byName);
    var back = params.material ? '#/material/' + encodeURIComponent(params.material) : '#/site/' + encodeURIComponent(site.id) + '?tab=materials';

    var body = mats.map(function (mat) {
      var s = M.stock(mat);
      var before = 0;
      var inMonth = [];
      s.rows.forEach(function (r) {
        if (r.log.date < from) before = r.balance;
        else if (r.log.date <= to) inMonth.push(r);
      });
      var tIn = 0, tOut = 0;
      var trs = inMonth.map(function (r) {
        var l = r.log, n = U.num(l.qty) || 0;
        var inQ = '', outQ = '';
        if (l.type === 'in') { inQ = U.fmtNum(n); tIn += n; }
        else if (l.type === 'use' || l.type === 'out') { outQ = U.fmtNum(n); tOut += n; }
        return '<tr><td>' + esc(U.formatShort(l.date)) + '</td><td>' + esc(typeInfo(l.type).name.replace('（数量を合わせる）', '')) + '</td>' +
          '<td class="r">' + inQ + '</td><td class="r">' + outQ + '</td><td class="r">' + U.fmtNum(r.balance) + '</td>' +
          '<td>' + esc(l.person || '') + '</td><td>' + esc(l.note || '') + '</td></tr>';
      }).join('');
      return '<div class="ledger">' +
        '<div class="ledger-head"><strong>' + esc(mat.name) + '</strong>' + (mat.spec ? '　' + esc(mat.spec) : '') + '　（単位：' + esc(mat.unit || '') + '）</div>' +
        '<table class="doc-table"><thead><tr><th style="width:9%">日付</th><th style="width:11%">区分</th><th style="width:11%">受入</th><th style="width:11%">払出</th><th style="width:11%">残</th><th style="width:15%">記録者</th><th>備考</th></tr></thead><tbody>' +
        '<tr class="carry"><td colspan="4">前月からの繰越</td><td class="r">' + U.fmtNum(before) + '</td><td></td><td></td></tr>' +
        (trs || '<tr><td colspan="7" class="muted-cell">この月の記録はありません</td></tr>') +
        '<tr class="total"><td colspan="2">当月計</td><td class="r">' + U.fmtNum(tIn) + '</td><td class="r">' + U.fmtNum(tOut) + '</td>' +
        '<td class="r">' + U.fmtNum(inMonth.length ? inMonth[inMonth.length - 1].balance : before) + '</td><td></td><td></td></tr>' +
        '</tbody></table></div>';
    }).join('');

    U.app().innerHTML = UI.printBar(back, esc(U.ymLabel(ym)) + '分の受払簿です。') +
      '<div class="no-print card">' + UI.field('月', UI.text('f-ym', ym, '', ' type="month"')) + '</div>' +
      '<div class="print-sheet"><div class="doc">' +
      '<div class="doc-head"><div><div class="doc-title">資材受払簿</div><div class="doc-sub">' + esc(U.ymLabel(ym)) + '分</div></div>' +
      '<div class="doc-sub">' + esc((global.APP_CONFIG && global.APP_CONFIG.company) || '') + '</div></div>' +
      '<table class="meta"><tbody><tr><th>工事名</th><td>' + esc(site.name) + (site.contractNo ? '（工事番号：' + esc(site.contractNo) + '）' : '') + '</td></tr></tbody></table>' +
      (body || '<p>資材が登録されていません。</p>') + '</div></div>';
    var ymInput = U.qs('#f-ym');
    if (ymInput) {
      ymInput.type = 'month';
      ymInput.addEventListener('change', function () {
        if (U.isYm(ymInput.value)) U.go('#/print/stock' + U.query({ site: site.id, material: params.material, ym: ymInput.value }));
      });
    }
    UI.bindPrint();
  });
})(window);
