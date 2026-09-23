/*
 * views/breakdown.js - 請負代金内訳書（様式第22）の読み込み
 *
 * 内訳書のExcelを選ぶと、「費目・工種・種別・細別」の段組みを読み取り、
 * いちばん細かい段（＝細別）を1件ずつ工程の行にする。
 *   工種（大分類）… その行の1つ上の段の名前
 *   種別（中分類）… その行の名前
 *   積算金額　　　… 金額の列
 * 段は「どの列に文字が書いてあるか」で見分ける（左にあるものほど大きい分類）。
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var M = MT.model;
  var Store = MT.store;
  var esc = U.esc;

  var picked = null;            // 読み込んだ内訳（画面を開いている間だけ持つ）
  var pickedSite = '';

  function clean(s) { return String(s === null || s === undefined ? '' : s).replace(/[\s　]/g, ''); }
  function isSummary(s) { return /^[＊*]/.test(clean(s)); }

  /** 内訳書のシートを読み解く */
  function parse(rows) {
    var amountCol = -1, headRow = -1;
    for (var ri = 0; ri < rows.length && amountCol < 0; ri++) {
      var r = rows[ri];
      if (!r) continue;
      for (var ci = 0; ci < r.length; ci++) {
        if (typeof r[ci] === 'string' && clean(r[ci]) === '金額') { amountCol = ci; headRow = ri; break; }
      }
    }
    if (amountCol < 0) throw new Error('「金額」の欄が見つかりません。様式第22（請負代金内訳書）のExcelを選んでください。');

    var title = '';
    for (var ti = 0; ti < headRow; ti++) {
      var tr = rows[ti];
      if (!tr) continue;
      for (var tc = 0; tc < tr.length; tc++) {
        if (typeof tr[tc] === 'string' && clean(tr[tc]) === '工事名') {
          for (var tn = tc + 1; tn < tr.length; tn++) {
            if (typeof tr[tn] === 'string' && clean(tr[tn])) { title = String(tr[tn]).trim(); break; }
          }
        }
      }
    }

    var items = [], totals = [];
    for (var i = headRow + 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row) continue;
      var label = '', labelCol = -1;
      for (var c2 = 0; c2 < Math.min(row.length, amountCol); c2++) {
        if (typeof row[c2] === 'string' && clean(row[c2])) { label = String(row[c2]).trim(); labelCol = c2; break; }
      }
      if (!label) continue;
      var amount = null;
      for (var c3 = amountCol; c3 < row.length; c3++) {
        if (typeof row[c3] === 'number') { amount = row[c3]; break; }
      }
      if (amount === null) continue;
      if (isSummary(label) || /^消費税/.test(clean(label))) totals.push({ label: label.replace(/[＊*]/g, '').trim(), amount: amount });
      else items.push({ label: label, col: labelCol, amount: amount });
    }
    if (!items.length) throw new Error('工種の行が見つかりませんでした。');

    // 文字の書かれた列を左から並べ、何段目かを決める
    var cols = [];
    items.forEach(function (it) { if (cols.indexOf(it.col) < 0) cols.push(it.col); });
    cols.sort(function (a, b) { return a - b; });
    items.forEach(function (it) { it.level = cols.indexOf(it.col); });

    // いちばん細かい段（次の行が自分より浅い＝子を持たない行）だけを取り込む
    items.forEach(function (it, k) {
      var next = items[k + 1];
      it.leaf = !next || next.level <= it.level;
    });

    var leaves = [];
    items.forEach(function (it, k) {
      if (!it.leaf) return;
      var group = '';
      for (var b = k - 1; b >= 0; b--) {
        if (items[b].level === it.level - 1) { group = items[b].label; break; }
        if (items[b].level < it.level - 1) break;
      }
      leaves.push({ group: group, name: it.label, amount: it.amount, use: true });
    });

    function find(re) {
      var hit = totals.filter(function (t) { return re.test(clean(t.label)); })[0];
      return hit ? hit.amount : null;
    }
    return {
      title: title,
      items: leaves,
      totals: totals,
      contract: find(/^合計$/) || find(/合計/) || find(/工事価格/),   // 請負金額
      net: find(/純工事費/),                                          // 全体金額（構成比率の分母）
      common: find(/共通仮設費/),                                     // 準備工・後片付のもと
      useCommon: find(/共通仮設費/) !== null,
      share: 50
    };
  }

  /** 選ばれた集計行（select の値）を金額に直す */
  function totalValue(id) {
    return id === '' ? null : picked.totals[Number(id)].amount;
  }

  function totalOptions() {
    return [['', '（入れない）']].concat(picked.totals.map(function (t, i) {
      return [String(i), t.label + '　' + U.fmtNum(t.amount, 0) + ' 円'];
    }));
  }

  /** 金額から、選択肢の番号を探す */
  function indexOfAmount(amount) {
    if (amount === null) return '';
    for (var i = 0; i < picked.totals.length; i++) {
      if (picked.totals[i].amount === amount) return String(i);
    }
    return '';
  }

  /* ------------------------------------------------------------------ *
   * 画面
   * ------------------------------------------------------------------ */
  function render(site) {
    var back = '#/site/' + encodeURIComponent(site.id) + '?tab=schedule';
    var has = M.tasks(site.id).length;
    var html = UI.backLink(back, '工程へ戻る') +
      UI.pageHead('BREAKDOWN', '請負代金内訳書の読み込み') +
      '<p class="muted">' + esc(site.name) + '</p>' +
      '<div class="card">' +
      '<p class="section-note">愛知県の <strong>様式第22（請負代金内訳書）</strong> のExcelを選んでください。' +
      '「費目・工種・種別・細別」の段組みを読み取り、いちばん細かい段を工程の行にします。</p>' +
      '<input type="file" id="f-xlsx" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">' +
      '<div id="bd-msg"></div></div>';

    if (picked) {
      var sum = 0;
      picked.items.forEach(function (it) { if (it.use) sum += it.amount; });
      var contract = U.num(picked.contract);
      var net = U.num(picked.net);
      var common = picked.useCommon ? U.num(picked.common) : null;
      var prep = common === null ? 0 : Math.round(common * picked.share / 100);
      var extra = common === null ? [] : [
        { group: '共通仮設費', name: '準備工', amount: prep, costKind: 'prep' },
        { group: '共通仮設費', name: '後片付', amount: common - prep, costKind: 'cleanup' }
      ];
      var withExtra = sum + (common === null ? 0 : common);
      var base = net !== null ? net : withExtra;

      html += UI.h2('TOTAL', '金額の決めごと') + '<div class="card">' +
        (picked.title ? '<p class="muted">内訳書の工事名：' + esc(picked.title) + '</p>' : '') +
        UI.field('全体金額（構成比率の分母）', UI.select('f-net', totalOptions(), indexOfAmount(picked.net)), false,
          '純工事費（直接工事費＋共通仮設費）を選びます') +
        UI.field('請負金額', UI.select('f-total', totalOptions(), indexOfAmount(picked.contract))) +
        '</div>';

      html += UI.h2('COMMON', '準備工・後片付') + '<div class="card">' +
        UI.checkbox('f-usecommon', '共通仮設費から「準備工」「後片付」の行をつくる', picked.useCommon) +
        (picked.useCommon
          ? UI.field('共通仮設費', UI.select('f-common', totalOptions(), indexOfAmount(picked.common))) +
            '<div class="field-row">' +
            UI.field('準備工の割合（%）', UI.number('f-share', picked.share, ' step="1" min="0" max="100"')) +
            UI.field('後片付の割合（%）', UI.text('f-share2', (100 - picked.share) + ' %', '', ' readonly')) +
            '</div>' +
            '<p class="section-note">準備工 <strong>' + U.fmtNum(prep, 0) + ' 円</strong>　／　' +
            '後片付 <strong>' + U.fmtNum(common - prep, 0) + ' 円</strong>' +
            '（割合は取り込んだ後でも、工程の画面から変えられます）</p>'
          : '<p class="section-note">内訳書に共通仮設費の行が見つからないか、使わない設定です。</p>') +
        '</div>';

      html += UI.h2('ITEMS', '取り込む工種・種別（' + (picked.items.length + extra.length) + '件）') +
        '<div class="card">' +
        '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th class="nowrap">取込</th><th>工種（大分類）</th><th>種別（中分類）</th>' +
        '<th class="r">積算金額</th><th class="r">構成比率</th><th class="r">請負比</th></tr></thead><tbody>' +
        picked.items.map(function (it, i) {
          return '<tr class="' + (it.use ? '' : 'off') + '"><td class="c">' +
            '<input type="checkbox" class="bd-use" data-i="' + i + '"' + (it.use ? ' checked' : '') + '></td>' +
            '<td>' + esc(it.group || '－') + '</td><td>' + esc(it.name) + '</td>' +
            '<td class="r">' + U.fmtNum(it.amount, 0) + '</td>' +
            '<td class="r">' + (base > 0 ? U.fmtNum(it.amount / base * 100, 1) + '%' : '－') + '</td>' +
            '<td class="r">' + (contract ? U.fmtNum(it.amount / contract * 100, 1) + '%' : '－') + '</td></tr>';
        }).join('') +
        extra.map(function (it) {
          return '<tr class="add"><td class="c">＋</td><td>' + esc(it.group) + '</td><td>' + esc(it.name) + '</td>' +
            '<td class="r">' + U.fmtNum(it.amount, 0) + '</td>' +
            '<td class="r">' + (base > 0 ? U.fmtNum(it.amount / base * 100, 1) + '%' : '－') + '</td>' +
            '<td class="r">' + (contract ? U.fmtNum(it.amount / contract * 100, 1) + '%' : '－') + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><th colspan="3">合計</th><th class="r">' + U.fmtNum(withExtra, 0) + '</th>' +
        '<th class="r">' + (base > 0 ? U.fmtNum(withExtra / base * 100, 1) + '%' : '－') + '</th>' +
        '<th class="r">' + (contract ? U.fmtNum(withExtra / contract * 100, 1) + '%' : '－') + '</th></tr></tfoot>' +
        '</table></div>' +
        (base > 0 && Math.abs(withExtra / base * 100 - 100) >= 0.5
          ? '<p class="section-note warn-text">合計が全体金額と合っていません（' + U.fmtNum(withExtra / base * 100, 1) +
            '%）。全体金額の選び方か、取り込む行をご確認ください。</p>'
          : '<p class="section-note">合計が全体金額とそろっています。構成比率の合計が100%になります。</p>') +
        '</div>';

      if (has) {
        html += UI.alert('warn', 'この現場には、すでに <strong>' + has + '件</strong> の工程が入っています。' +
          '入れ替えると、いまの期間や進捗は消えます。');
        html += '<div class="card">' +
          UI.field('いまの工程をどうするか', UI.select('f-mode',
            [['add', '追加する（いまの工程はそのまま）'], ['replace', '入れ替える（いまの工程を消す）']], 'add')) +
          '</div>';
      }

      html += '<p class="muted">期間は工期を等分した仮の値で入ります。取り込んだあと、工程表の帯をドラッグして合わせてください。</p>' +
        UI.btnRow('<button class="btn lead block" id="b-import">この内容で取り込む</button>');
    }

    U.app().innerHTML = html;
    bind(site);
  }

  function bind(site) {
    var file = document.getElementById('f-xlsx');
    if (file) {
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var msg = document.getElementById('bd-msg');
        msg.innerHTML = '<p class="muted">読み込んでいます…</p>';
        f.arrayBuffer().then(MT.xlsxRead).then(function (book) {
          var found = null, err = null;
          book.sheets.forEach(function (s) {
            if (found) return;
            try { found = parse(s.rows); } catch (e) { err = e; }
          });
          if (!found) throw err || new Error('内訳書を読み取れませんでした。');
          picked = found;
          pickedSite = site.id;
          render(site);
        }).catch(function (e) {
          picked = null;
          msg.innerHTML = '<div class="alert error">' + esc(e.message || String(e)) + '</div>';
        });
      });
    }

    U.qsa('.bd-use').forEach(function (cb) {
      cb.addEventListener('change', function () {
        picked.items[Number(cb.getAttribute('data-i'))].use = cb.checked;
        render(site);
      });
    });

    U.on('#f-net', 'change', function () { picked.net = totalValue(U.val('#f-net')); render(site); });
    U.on('#f-total', 'change', function () { picked.contract = totalValue(U.val('#f-total')); render(site); });
    U.on('#f-common', 'change', function () { picked.common = totalValue(U.val('#f-common')); render(site); });
    U.on('#f-usecommon', 'change', function () { picked.useCommon = U.checked('#f-usecommon'); render(site); });
    U.on('#f-share', 'change', function () {
      var v = U.num(U.val('#f-share'));
      picked.share = v === null || v < 0 || v > 100 ? 50 : v;
      render(site);
    });

    U.on('#b-import', 'click', function () {
      var use = picked.items.filter(function (it) { return it.use; });
      if (!use.length) return U.toast('取り込む行を選んでください');
      var mode = U.val('#f-mode') || 'add';

      var common = picked.useCommon ? U.num(picked.common) : null;
      var share = U.num(picked.share);
      if (share === null || share < 0 || share > 100) share = 50;
      var prep = common === null ? 0 : Math.round(common * share / 100);
      var total = use.length + (common === null ? 0 : 2);
      if (mode === 'replace' && !confirm('いまの工程をすべて消して、' + total + '件を入れ直します。よろしいですか？')) return;

      var fresh = Store.get('sites', site.id);
      fresh.contractAmount = totalValue(U.val('#f-total'));
      fresh.netCost = totalValue(U.val('#f-net'));
      fresh.commonCost = common;
      fresh.prepShare = share;
      Store.put('sites', fresh);

      if (mode === 'replace') M.tasks(site.id).forEach(function (t) { Store.remove('tasks', t.id); });

      // 期間は工期を等分した仮の値（あとでドラッグして合わせてもらう）
      var from = U.isDate(site.periodFrom) ? site.periodFrom : U.todayStr();
      var to = U.isDate(site.periodTo) && site.periodTo > from ? site.periodTo : U.addDays(from, use.length * 7);
      var span = U.diffDays(from, to) + 1;

      // 準備工は工期の頭、後片付は工期の終わりに置き、その間に工種を並べる
      var head = Math.max(2, Math.min(6, Math.round(span / 12)));
      var bodyFrom = common !== null ? U.addDays(from, head + 1) : from;
      var bodyTo = common !== null ? U.addDays(to, -(head + 1)) : to;
      if (bodyTo <= bodyFrom) { bodyFrom = from; bodyTo = to; }
      var bodySpan = U.diffDays(bodyFrom, bodyTo) + 1;
      var per = Math.max(3, Math.round(bodySpan / use.length));
      var step = use.length > 1 ? (bodySpan - per) / (use.length - 1) : 0;

      use.forEach(function (it, i) {
        var s = U.addDays(bodyFrom, Math.round(i * step));
        var e = U.addDays(s, per - 1);
        if (e > bodyTo) e = bodyTo;
        Store.put('tasks', {
          siteId: site.id, group: it.group, name: it.name, amount: it.amount,
          planStart: s, planEnd: e, progress: 0, weight: null, note: ''
        });
      });

      if (common !== null) {
        Store.put('tasks', {
          siteId: site.id, group: '共通仮設費', name: '準備工', amount: prep, costKind: 'prep',
          planStart: from, planEnd: U.addDays(from, head), progress: 0, weight: null, note: ''
        });
        Store.put('tasks', {
          siteId: site.id, group: '共通仮設費', name: '後片付', amount: common - prep, costKind: 'cleanup',
          planStart: U.addDays(to, -head), planEnd: to, progress: 0, weight: null, note: ''
        });
      }

      picked = null;
      U.toast(total + '件を取り込みました');
      U.go('#/site/' + encodeURIComponent(site.id) + '?tab=schedule');
    });
  }

  MT.route('breakdown', { form: true }, function (m, params) {
    var site = Store.get('sites', params.site);
    if (!site || site.depot) return MT.notFound('現場が見つかりません。');
    if (pickedSite !== site.id) picked = null;    // よその現場の読み込みを持ち越さない
    render(site);
  });
})(window);
