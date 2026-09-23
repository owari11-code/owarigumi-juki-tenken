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

    var pick = totals.filter(function (t) { return /合計/.test(clean(t.label)); })[0] ||
      totals.filter(function (t) { return /工事価格/.test(clean(t.label)); })[0] || null;

    return { title: title, items: leaves, totals: totals, contract: pick ? pick.amount : null };
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

      html += UI.h2('TOTAL', '請負金額') + '<div class="card">' +
        (picked.title ? '<p class="muted">内訳書の工事名：' + esc(picked.title) + '</p>' : '') +
        UI.field('請負金額として使う行', UI.select('f-total',
          [['', '（入れない）']].concat(picked.totals.map(function (t, i) {
            return [String(i), t.label + '　' + U.fmtNum(t.amount, 0) + ' 円'];
          })),
          picked.totals.reduce(function (acc, t, i) { return t.amount === picked.contract ? String(i) : acc; }, ''))) +
        '</div>';

      html += UI.h2('ITEMS', '取り込む工種・種別（' + picked.items.length + '件）') +
        '<div class="card">' +
        '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th class="nowrap">取込</th><th>工種（大分類）</th><th>種別（中分類）</th>' +
        '<th class="r">積算金額</th><th class="r">構成比率</th><th class="r">請負比</th></tr></thead><tbody>' +
        picked.items.map(function (it, i) {
          var ratio = sum > 0 ? it.amount / sum * 100 : 0;
          return '<tr class="' + (it.use ? '' : 'off') + '"><td class="c">' +
            '<input type="checkbox" class="bd-use" data-i="' + i + '"' + (it.use ? ' checked' : '') + '></td>' +
            '<td>' + esc(it.group || '－') + '</td><td>' + esc(it.name) + '</td>' +
            '<td class="r">' + U.fmtNum(it.amount, 0) + '</td>' +
            '<td class="r">' + U.fmtNum(ratio, 1) + '%</td>' +
            '<td class="r">' + (contract ? U.fmtNum(it.amount / contract * 100, 1) + '%' : '－') + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><th colspan="3">内訳の合計</th><th class="r">' + U.fmtNum(sum, 0) + '</th>' +
        '<th class="r">100.0%</th><th class="r">' + (contract ? U.fmtNum(sum / contract * 100, 1) + '%' : '－') + '</th></tr></tfoot>' +
        '</table></div></div>';

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

    U.on('#b-import', 'click', function () {
      var use = picked.items.filter(function (it) { return it.use; });
      if (!use.length) return U.toast('取り込む行を選んでください');
      var mode = U.val('#f-mode') || 'add';
      if (mode === 'replace' && !confirm('いまの工程をすべて消して、' + use.length + '件を入れ直します。よろしいですか？')) return;

      var ti = U.val('#f-total');
      if (ti !== '') {
        var fresh = Store.get('sites', site.id);
        fresh.contractAmount = picked.totals[Number(ti)].amount;
        Store.put('sites', fresh);
      }

      if (mode === 'replace') M.tasks(site.id).forEach(function (t) { Store.remove('tasks', t.id); });

      // 期間は工期を等分した仮の値（あとでドラッグして合わせてもらう）
      var from = U.isDate(site.periodFrom) ? site.periodFrom : U.todayStr();
      var to = U.isDate(site.periodTo) && site.periodTo > from ? site.periodTo : U.addDays(from, use.length * 7);
      var span = U.diffDays(from, to) + 1;
      var per = Math.max(3, Math.round(span / use.length));
      var step = use.length > 1 ? (span - per) / (use.length - 1) : 0;

      use.forEach(function (it, i) {
        var s = U.addDays(from, Math.round(i * step));
        var e = U.addDays(s, per - 1);
        if (e > to) e = to;
        Store.put('tasks', {
          siteId: site.id, group: it.group, name: it.name, amount: it.amount,
          planStart: s, planEnd: e, progress: 0, weight: null, note: ''
        });
      });

      picked = null;
      U.toast(use.length + '件を取り込みました');
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
