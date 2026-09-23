/*
 * views/tools.js - 小型機械・工具（持ち出し・返却）
 *
 * 工具は会社の資機材置場（本社）に属する。置場のQRの鍵で持ち出し・返却を記録するので、
 * 工具に貼ったQRを読めば、ログインなしで記録できる。
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

  function lastName() {
    try { return localStorage.getItem('maruten-last-inspector') || ''; } catch (e) { return ''; }
  }

  function toolTags(tool) {
    var st = M.toolState(tool);
    var tags = [{ cls: st.cls, text: st.label }];
    if (st.lend && st.lend.dueDate) tags.push({ cls: st.state === 'overdue' ? 'ng' : 'none', text: '返却予定 ' + U.formatShort(st.lend.dueDate) });
    return tags;
  }

  function lendWhere(l) {
    if (l.destSiteId) {
      var s = Store.get('sites', l.destSiteId);
      if (s) return s.name;
      var names = Store.getMeta('siteNames') || [];
      var hit = names.filter(function (x) { return x.id === l.destSiteId; })[0];
      if (hit) return hit.name;
    }
    return l.destName || '';
  }

  /* ------------------------------------------------------------------ *
   * 一覧（事務所）
   * ------------------------------------------------------------------ */
  MT.route('tools', {}, function (m, params) {
    var depot = M.ensureDepot();
    var filter = params.f || 'all';
    var all = Store.list('tools').sort(function (a, b) {
      return String(a.number || '').localeCompare(String(b.number || ''), 'ja', { numeric: true }) || U.byName(a, b);
    });
    var counts = { all: all.length, lent: 0, overdue: 0, available: 0, repair: 0 };
    all.forEach(function (t) {
      var st = M.toolState(t).state;
      if (st === 'lent' || st === 'overdue') counts.lent++;
      if (st === 'overdue') counts.overdue++;
      if (st === 'available') counts.available++;
      if (st === 'repair') counts.repair++;
    });
    var list = all.filter(function (t) {
      var st = M.toolState(t).state;
      if (filter === 'lent') return st === 'lent' || st === 'overdue';
      if (filter === 'overdue') return st === 'overdue';
      if (filter === 'available') return st === 'available';
      if (filter === 'repair') return st === 'repair' || st === 'retired';
      return true;
    });

    var html = UI.pageHead('TOOLS', '工具・小型機械') +
      UI.tabs(function (k) { return '#/tools?f=' + k; }, [
        ['all', 'すべて', String(counts.all)], ['lent', '貸出中', String(counts.lent)],
        ['overdue', '期限切れ', counts.overdue ? String(counts.overdue) : ''], ['available', '保管中', String(counts.available)],
        ['repair', '修理・中止', counts.repair ? String(counts.repair) : '']
      ], filter);

    if (!list.length) html += UI.empty(all.length ? '該当する工具はありません。' : 'まだ工具が登録されていません。');
    html += '<ul class="list">' + list.map(function (t) {
      var st = M.toolState(t);
      return '<li>' + UI.rowLink('#/tool/' + encodeURIComponent(t.id), {
        count: t.number || '－', unit: 'NO.',
        countClass: st.state === 'available' ? 'done' : st.state === 'overdue' ? '' : 'idle',
        main: t.name,
        subHtml: esc(A.nameOf(A.TOOL_KINDS, t.kind, '')) +
          (st.lend ? '<br>' + esc(st.lend.borrower || '') + '　→　' + esc(lendWhere(st.lend) || '持出先未記入') + '（' + esc(U.formatShort(st.lend.outDate)) + '〜）' : (t.place ? '<br>保管：' + esc(t.place) : '')),
        tags: toolTags(t)
      }) + '</li>';
    }).join('') + '</ul>';

    html += UI.btnRow('<a class="btn" href="#/tool/new">＋ 工具を登録</a>') +
      UI.btnRow('<a class="btn secondary" href="#/print/tool-labels">QRラベルを印刷</a><a class="btn secondary" href="#/print/lends?ym=' + U.thisMonth() + '">貸出簿を印刷</a>') +
      '<p class="muted">工具のQRは「' + esc(depot.name) + '」のQRとして発行されます。読み取ると、ログインなしで持ち出し・返却を記録できます。</p>';
    U.app().innerHTML = html;
  });

  /* ------------------------------------------------------------------ *
   * 一覧（現場の端末。置場のQRを読んだ端末だけ）
   * ------------------------------------------------------------------ */
  MT.route('tools-field', { access: 'field' }, function () {
    if (Session.isAdmin()) return U.go('#/tools');
    var depots = Session.fieldSites().filter(function (s) { return s.depot && !s.invalid; });
    if (!depots.length) return MT.requireSiteAccess('__none__');
    var list = Store.list('tools').sort(U.byName);
    var html = UI.pageHead('TOOLS', '工具の持ち出し・返却');
    if (!list.length) html += UI.empty('工具のデータがまだありません。電波の届く場所で開き直してください。');
    html += '<ul class="list">' + list.map(function (t) {
      var st = M.toolState(t);
      return '<li>' + UI.rowLink('#/tool/' + encodeURIComponent(t.id), {
        count: t.number || '－', unit: 'NO.', countClass: st.state === 'available' ? 'done' : 'idle',
        main: t.name,
        subHtml: st.lend ? esc((st.lend.borrower || '') + ' → ' + (lendWhere(st.lend) || '')) : '保管中',
        tags: toolTags(t)
      }) + '</li>';
    }).join('') + '</ul>';
    U.app().innerHTML = html + UI.btnRow('<a class="btn secondary" href="#/scan">■ QRを読み取る</a>');
  });

  /* ------------------------------------------------------------------ *
   * 登録・編集
   * ------------------------------------------------------------------ */
  function toolForm(tool) {
    var isNew = !tool;
    var depot = M.ensureDepot();
    tool = tool || { siteId: depot.id, kind: 'power', status: 'ok' };
    var back = isNew ? '#/tools' : '#/tool/' + encodeURIComponent(tool.id);
    U.app().innerHTML = UI.backLink(back, '戻る') +
      UI.pageHead('TOOL', isNew ? '工具の登録' : '工具の編集') +
      '<div class="card">' +
      UI.field('名称', UI.text('f-name', tool.name, '例：ハンマードリル／発電機 2.8kVA'), true) +
      '<div class="field-row">' +
      UI.field('管理番号', UI.text('f-number', tool.number, '例：D-01')) +
      UI.field('種類', UI.select('f-kind', A.TOOL_KINDS.map(function (k) { return [k.id, k.name]; }), tool.kind)) +
      '</div>' +
      '<div class="field-row">' +
      UI.field('メーカー', UI.text('f-maker', tool.maker)) +
      UI.field('型式', UI.text('f-model', tool.model)) +
      '</div>' +
      UI.field('保管場所', UI.pickOther('f-place', A.PLACES, tool.place, '例：本社 倉庫 棚B')) +
      UI.field('状態', UI.select('f-status', A.TOOL_STATUS.map(function (s) { return [s.id, s.name]; }), tool.status || 'ok')) +
      UI.field('次回の点検日（任意）', UI.date('f-due', tool.checkDue), false, '絶縁抵抗測定など、定期点検の予定日') +
      UI.field('備考', UI.textarea('f-note', tool.note)) +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="' + esc(back) + '">キャンセル</a>') +
      (isNew ? '' : UI.btnRow('<button class="btn danger" id="b-del">この工具を削除</button>'));

    UI.bindPickOther('f-place');

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name');
      if (!name) { U.toast('名称を入力してください'); return U.qs('#f-name').focus(); }
      tool.name = name;
      tool.number = U.val('#f-number');
      tool.kind = U.val('#f-kind');
      tool.maker = U.val('#f-maker');
      tool.model = U.val('#f-model');
      tool.place = UI.pickOtherValue('f-place');
      tool.status = U.val('#f-status');
      tool.checkDue = U.val('#f-due');
      tool.note = U.val('#f-note');
      if (!tool.siteId) tool.siteId = depot.id;
      Store.put('tools', tool);
      U.toast('保存しました');
      U.go('#/tool/' + encodeURIComponent(tool.id));
    });
    U.on('#b-del', 'click', function () {
      if (!confirm('「' + tool.name + '」と、その貸出の記録を削除します。よろしいですか？')) return;
      M.lendsOf(tool).forEach(function (l) { Store.remove('lends', l.id); });
      Store.remove('tools', tool.id);
      U.toast('削除しました');
      U.go('#/tools');
    });
  }

  MT.route('tool/new', { form: true }, function () { toolForm(null); });
  MT.route('tool/([^/]+)/edit', { form: true }, function (m) {
    var t = Store.get('tools', m[0]);
    if (!t) return MT.notFound('工具が見つかりません。');
    toolForm(t);
  });

  /* ------------------------------------------------------------------ *
   * 工具の画面（QRから開く）
   * ------------------------------------------------------------------ */
  MT.route('tool/([^/]+)', { access: 'field' }, function (m) {
    var tool = Store.get('tools', m[0]);
    if (!tool) {
      if (MT.sync.status().running) return MT.loading();
      return MT.notFound('工具が見つかりません。');
    }
    if (!MT.requireSiteAccess(tool.siteId)) return;
    var admin = Session.isAdmin();
    var st = M.toolState(tool);
    var lends = M.lendsOf(tool).slice().reverse();

    var html = UI.backLink(admin ? '#/tools' : '#/tools-field', '工具の一覧へ') +
      UI.pageHead('TOOL', tool.name) +
      '<div class="card blueprint">' + UI.corners() + '<div class="meta-lines">' +
      esc([tool.number ? 'No.' + tool.number : '', A.nameOf(A.TOOL_KINDS, tool.kind, ''), ((tool.maker || '') + ' ' + (tool.model || '')).trim()].filter(Boolean).join('　／　')) +
      (tool.place ? '<br>保管場所：' + esc(tool.place) : '') + '</div>' +
      '<div class="tags">' + toolTags(tool).map(UI.tag).join('') + '</div></div>';

    if (st.state === 'retired' || st.state === 'repair') {
      html += UI.alert('warn', 'この工具は「' + esc(st.label) + '」になっています。持ち出す前に事務所へ確認してください。');
    }

    if (st.lend) {
      html += UI.h2('RETURN', '返却する') +
        '<div class="card"><p>' + esc(st.lend.borrower || '') + ' さんが ' + esc(U.formatDate(st.lend.outDate)) + ' に持ち出し中' +
        (lendWhere(st.lend) ? '（持出先：' + esc(lendWhere(st.lend)) + '）' : '') +
        (st.lend.dueDate ? '<br>返却予定：' + esc(U.formatDate(st.lend.dueDate)) : '') + '</p>' +
        '<div class="field-row">' + UI.field('返却日', UI.date('r-date', U.todayStr()), true) + UI.field('返却した人', UI.text('r-person', lastName()), true) + '</div>' +
        UI.field('状態・気づいたこと', UI.text('r-note', '', '例：刃が欠けている／異常なし')) +
        UI.btnRow('<button class="btn lead" id="b-return">返却を記録する</button>') + '</div>';
    } else if (st.state !== 'retired') {
      var names = Store.getMeta('siteNames') || [];
      if (admin) names = M.sites({ activeOnly: true }).map(function (s) { return { id: s.id, name: s.name }; });
      html += UI.h2('LEND', '持ち出す') +
        '<div class="card">' +
        '<div class="field-row">' + UI.field('持ち出す人', UI.text('l-person', lastName()), true) + UI.field('持出日', UI.date('l-date', U.todayStr()), true) + '</div>' +
        UI.field('持出先（現場）', UI.select('l-site', [['', '（選ぶ）']].concat(names.map(function (s) { return [s.id, s.name]; })).concat([['other', 'その他（下に記入）']]), '')) +
        UI.field('持出先（その他）', UI.text('l-dest', '', '例：本社 作業場')) +
        UI.field('返却予定日', UI.date('l-due', U.addDays(U.todayStr(), 7))) +
        UI.btnRow('<button class="btn lead" id="b-lend">持ち出しを記録する</button>') + '</div>';
    }

    html += UI.h2('HISTORY', '貸出の記録（' + lends.length + '件）');
    if (!lends.length) html += UI.empty('まだ記録がありません。');
    else {
      html += '<div class="table-scroll"><table class="data compact-table"><thead><tr><th>持出</th><th>返却</th><th>持ち出した人</th><th>持出先</th></tr></thead><tbody>' +
        lends.slice(0, 30).map(function (l) {
          return '<tr><td>' + esc(U.formatShort(l.outDate)) + '</td><td>' + (l.returnedDate ? esc(U.formatShort(l.returnedDate)) : '<strong>未返却</strong>') + '</td>' +
            '<td>' + esc(l.borrower || '') + '</td><td>' + esc(lendWhere(l)) + (l.returnNote ? '<br><span class="muted">' + esc(l.returnNote) + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    if (admin) {
      var depot = Store.get('sites', tool.siteId) || M.ensureDepot();
      html += UI.h2('QR', 'この工具のQRコード') +
        '<div class="card qr-box"><div id="qr"></div><div class="qr-url">読み取ると、この画面が開きます（ログイン不要）</div></div>' +
        UI.btnRow('<a class="btn secondary" href="#/print/tool-labels?id=' + encodeURIComponent(tool.id) + '">QRラベルを印刷</a><a class="btn plain" href="#/tool/' + encodeURIComponent(tool.id) + '/edit">登録内容を編集</a>');
      if (tool.note) html += UI.h2('MEMO', '備考') + '<div class="card"><p>' + U.nl2br(tool.note) + '</p></div>';
      U.app().innerHTML = html;
      UI.drawQr(U.qs('#qr'), UI.qrUrl('tool', depot, tool), 220);
    } else {
      U.app().innerHTML = html;
    }

    U.on('#b-lend', 'click', function () {
      var person = U.val('#l-person'), date = U.val('#l-date');
      if (!person) return U.toast('持ち出す人を入力してください');
      if (!U.isDate(date)) return U.toast('持出日を入力してください');
      var siteSel = U.val('#l-site');
      var names = Store.getMeta('siteNames') || [];
      var picked = siteSel && siteSel !== 'other' ? siteSel : '';
      var destName = U.val('#l-dest');
      if (picked) {
        var s = Store.get('sites', picked) || names.filter(function (x) { return x.id === picked; })[0];
        destName = s ? s.name : destName;
      }
      if (!destName) return U.toast('持出先を選ぶか、記入してください');
      Store.put('lends', {
        siteId: tool.siteId, toolId: tool.id, borrower: person, outDate: date,
        dueDate: U.val('#l-due'), destSiteId: picked, destName: destName
      });
      try { localStorage.setItem('maruten-last-inspector', person); } catch (e) { /* 無視 */ }
      U.toast('持ち出しを記録しました');
      MT.rerender();
    });

    U.on('#b-return', 'click', function () {
      var date = U.val('#r-date'), person = U.val('#r-person');
      if (!U.isDate(date)) return U.toast('返却日を入力してください');
      if (!person) return U.toast('返却した人を入力してください');
      var lend = Store.get('lends', st.lend.id);
      if (!lend) return MT.rerender();
      lend.returnedDate = date;
      lend.returnedBy = person;
      lend.returnNote = U.val('#r-note');
      Store.put('lends', lend);
      try { localStorage.setItem('maruten-last-inspector', person); } catch (e) { /* 無視 */ }
      U.toast('返却を記録しました');
      MT.rerender();
    });
  });

  /* ------------------------------------------------------------------ *
   * 印刷：工具のQRラベル
   * ------------------------------------------------------------------ */
  MT.route('print/tool-labels', { print: true }, function (m, params) {
    var depot = M.ensureDepot();
    var tools = Store.list('tools', function (t) { return !params.id || t.id === params.id; }).sort(function (a, b) {
      return String(a.number || '').localeCompare(String(b.number || ''), 'ja', { numeric: true });
    });
    var labels = tools.map(function (t) {
      var site = Store.get('sites', t.siteId) || depot;
      return { url: UI.qrUrl('tool', site, t), title: t.name, sub: [t.number ? 'No.' + t.number : '', site.name].filter(Boolean).join('／'), badge: '工具', guide: '読み取って持ち出し・返却を記録' };
    });
    var back = params.id ? '#/tool/' + encodeURIComponent(params.id) : '#/tools';
    if (!labels.length) {
      U.app().innerHTML = UI.backLink(back, '戻る') + UI.empty('印刷する工具がありません。');
      return;
    }
    U.app().innerHTML = UI.printBar(back, labels.length + '枚のラベルを印刷します。') + UI.labelsHtml(labels);
    UI.drawLabels(labels);
    UI.bindPrint();
  });

  /* ------------------------------------------------------------------ *
   * 印刷：工具貸出簿（月ごと）
   * ------------------------------------------------------------------ */
  MT.route('print/lends', { print: true }, function (m, params) {
    var ym = U.isYm(params.ym) ? params.ym : U.thisMonth();
    var from = ym + '-01', to = ym + '-' + U.pad(U.daysInMonth(ym));
    var lends = Store.list('lends', function (l) {
      // その月に持ち出した、またはその月をまたいで貸出中だったもの
      return (l.outDate || '') <= to && (!l.returnedDate || l.returnedDate >= from);
    }).sort(function (a, b) { return (a.outDate || '').localeCompare(b.outDate || ''); });

    U.app().innerHTML = UI.printBar('#/tools', esc(U.ymLabel(ym)) + 'の貸出簿です。') +
      '<div class="no-print card">' + UI.field('月', '<input type="month" id="f-ym" value="' + ym + '">') + '</div>' +
      '<div class="print-sheet"><div class="doc">' +
      '<div class="doc-head"><div><div class="doc-title">工具・小型機械　貸出簿</div><div class="doc-sub">' + esc(U.ymLabel(ym)) + '</div></div>' +
      '<div class="doc-sub">' + esc((global.APP_CONFIG && global.APP_CONFIG.company) || '') + '</div></div>' +
      '<table class="doc-table"><thead><tr><th style="width:10%">管理番号</th><th style="width:20%">名称</th><th style="width:9%">持出日</th><th style="width:13%">持ち出した人</th><th>持出先</th><th style="width:9%">返却予定</th><th style="width:9%">返却日</th><th style="width:12%">返却者</th></tr></thead><tbody>' +
      (lends.length ? lends.map(function (l) {
        var t = Store.get('tools', l.toolId) || {};
        var overdue = !l.returnedDate && l.dueDate && l.dueDate < U.todayStr();
        return '<tr><td>' + esc(t.number || '') + '</td><td>' + esc(t.name || '（削除済み）') + '</td><td>' + esc(U.formatShort(l.outDate)) + '</td>' +
          '<td>' + esc(l.borrower || '') + '</td><td>' + esc(lendWhere(l)) + '</td><td>' + esc(U.formatShort(l.dueDate)) + '</td>' +
          '<td>' + (l.returnedDate ? esc(U.formatShort(l.returnedDate)) : (overdue ? '<strong>期限切れ</strong>' : '貸出中')) + '</td><td>' + esc(l.returnedBy || '') + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted-cell">この月の貸出はありません</td></tr>') +
      '</tbody></table></div></div>';
    U.on('#f-ym', 'change', function () {
      var v = U.val('#f-ym');
      if (U.isYm(v)) U.go('#/print/lends?ym=' + v);
    });
    UI.bindPrint();
  });
})(window);
