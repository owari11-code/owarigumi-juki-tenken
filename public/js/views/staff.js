/*
 * views/staff.js - 人員配置（社員名簿・現場への配置・月間の配置表）
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var M = MT.model;
  var Store = MT.store;
  var A = MT.assets;
  var esc = U.esc;

  function staffName(id) {
    var s = Store.get('staff', id);
    return s ? s.name : '（削除された社員）';
  }

  function siteName(id) {
    var s = Store.get('sites', id);
    return s ? s.name : '（削除された現場）';
  }

  function periodLabel(a) {
    if (!a.from && !a.to) return '期間の定めなし';
    return (a.from ? U.formatShort(a.from) : '') + '〜' + (a.to ? U.formatShort(a.to) : '');
  }

  /** 年つきの配置期間と、その日数 */
  function periodFull(a) {
    if (!a.from && !a.to) return '期間の定めなし';
    var s = (a.from ? U.formatDate(a.from) : '（開始日なし）') + ' 〜 ' + (a.to ? U.formatDate(a.to) : '（終了日なし）');
    if (a.from && a.to) {
      var n = U.diffDays(a.from, a.to);
      if (n !== null && n >= 0) s += '（' + (n + 1) + '日間）';
    }
    return s;
  }

  /** 期間が重なっている、ほかの現場への配置 */
  function overlaps(a) {
    return M.assignments({ staffId: a.staffId }).filter(function (b) {
      if (b.id === a.id || b.siteId === a.siteId) return false;
      var aFrom = a.from || '0000-00-00', aTo = a.to || '9999-99-99';
      var bFrom = b.from || '0000-00-00', bTo = b.to || '9999-99-99';
      return aFrom <= bTo && bFrom <= aTo;
    });
  }

  /* ------------------------------------------------------------------ *
   * 現場の「人員」タブ
   * ------------------------------------------------------------------ */
  MT.siteTabs.staff = {
    label: '人員',
    badge: function (site) {
      var n = M.assignments({ siteId: site.id, date: U.todayStr() }).length;
      return n ? n + '名' : '';
    },
    render: function (site) {
      var sid = encodeURIComponent(site.id);
      var today = U.todayStr();
      var list = M.assignments({ siteId: site.id });
      var now = list.filter(function (a) { return M.activeOn(a, today); });
      var future = list.filter(function (a) { return a.from && a.from > today; });
      var past = list.filter(function (a) { return a.to && a.to < today; });

      function rows(items) {
        return '<ul class="list">' + items.map(function (a) {
          var ov = overlaps(a);
          var tags = [{ cls: 'none', text: a.role || '担当' }];
          if (ov.length) tags.push({ cls: 'warn', text: '他現場と重複 ' + ov.length });
          return '<li>' + UI.rowLink('#/assignment/' + encodeURIComponent(a.id) + '/edit', {
            count: (staffName(a.staffId) || '？').charAt(0), unit: '',
            countClass: M.activeOn(a, today) ? 'done' : 'idle',
            main: staffName(a.staffId),
            subHtml: esc(periodLabel(a)) + (a.note ? '<br>' + esc(a.note) : ''),
            tags: tags
          }) + '</li>';
        }).join('') + '</ul>';
      }

      var html = UI.h2('NOW', '現在の配置（' + now.length + '名）') + (now.length ? rows(now) : UI.empty('現在配置されている社員はいません。'));
      if (future.length) html += UI.h2('NEXT', 'これからの配置') + rows(future);
      if (past.length) html += '<details class="fold"><summary>終わった配置（' + past.length + '件）</summary>' + rows(past) + '</details>';
      html += UI.btnRow('<a class="btn secondary" href="#/assignment/new?site=' + sid + '">＋ 社員を配置する</a><a class="btn plain" href="#/staffing">全社の配置表</a>');
      if (!M.staffList().length) html += UI.alert('info', '先に<a href="#/staff">社員名簿</a>に社員を登録してください。');
      return html;
    }
  };

  /* ------------------------------------------------------------------ *
   * 配置の登録・編集
   * ------------------------------------------------------------------ */
  function assignmentForm(a, params) {
    var isNew = !a;
    a = a || { siteId: params.site || '', staffId: params.staff || '', role: '担当技術者' };
    var site = Store.get('sites', a.siteId);
    var staffOptions = [['', '（選ぶ）']].concat(M.staffList().map(function (s) { return [s.id, s.name + (s.position ? '（' + s.position + '）' : '')]; }));
    var siteOptions = [['', '（選ぶ）']].concat(M.sites({ activeOnly: true }).map(function (s) { return [s.id, s.name]; }));
    var back = site ? '#/site/' + encodeURIComponent(site.id) + '?tab=staff' : '#/staffing';

    U.app().innerHTML = UI.backLink(back, '戻る') +
      UI.pageHead('ASSIGN', isNew ? '社員の配置' : '配置の編集') +
      '<div class="card">' +
      UI.field('工事現場', UI.select('f-site', siteOptions, a.siteId), true) +
      UI.field('社員', UI.select('f-staff', staffOptions, a.staffId), true) +
      UI.field('役割', UI.select('f-role', A.ASSIGN_ROLES.map(function (r) { return [r, r]; }), a.role)) +
      '<div class="field-row">' +
      UI.field('配置の開始', UI.date('f-from', a.from || (site && site.periodFrom) || U.todayStr())) +
      UI.field('配置の終了', UI.date('f-to', a.to || (site && site.periodTo) || '')) +
      '</div>' +
      UI.field('備考', UI.text('f-note', a.note, '例：週2日（火・木）')) +
      '<div id="overlap"></div>' +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="' + esc(back) + '">キャンセル</a>') +
      (isNew ? '' : UI.btnRow('<button class="btn danger" id="b-del">この配置を削除</button>'));

    function checkOverlap() {
      var probe = { id: a.id, staffId: U.val('#f-staff'), siteId: U.val('#f-site'), from: U.val('#f-from'), to: U.val('#f-to') };
      var box = U.qs('#overlap');
      if (!box) return;
      if (!probe.staffId) { box.innerHTML = ''; return; }
      var ov = overlaps(probe);
      box.innerHTML = ov.length ? UI.alert('warn', 'この期間は、ほかの現場にも配置されています：' +
        ov.map(function (b) { return esc(siteName(b.siteId) + '（' + periodLabel(b) + '・' + (b.role || '') + '）'); }).join('、')) : '';
    }
    ['#f-staff', '#f-site', '#f-from', '#f-to'].forEach(function (sel) { U.on(sel, 'change', checkOverlap); });
    checkOverlap();

    U.on('#b-save', 'click', function () {
      var siteId = U.val('#f-site'), staffId = U.val('#f-staff'), from = U.val('#f-from'), to = U.val('#f-to');
      if (!siteId) return U.toast('工事現場を選んでください');
      if (!staffId) return U.toast('社員を選んでください');
      if (from && to && from > to) return U.toast('終了日は開始日より後にしてください');
      a.siteId = siteId;
      a.staffId = staffId;
      a.role = U.val('#f-role');
      a.from = from;
      a.to = to;
      a.note = U.val('#f-note');
      Store.put('assignments', a);
      U.toast('保存しました');
      U.go('#/site/' + encodeURIComponent(siteId) + '?tab=staff');
    });
    U.on('#b-del', 'click', function () {
      if (!confirm('この配置を削除します。よろしいですか？')) return;
      Store.remove('assignments', a.id);
      U.toast('削除しました');
      U.go(back);
    });
  }

  MT.route('assignment/new', { form: true }, function (m, params) { assignmentForm(null, params); });
  MT.route('assignment/([^/]+)/edit', { form: true }, function (m) {
    var a = Store.get('assignments', m[0]);
    if (!a) return MT.notFound('配置が見つかりません。');
    assignmentForm(a, {});
  });

  /* ------------------------------------------------------------------ *
   * 社員名簿
   * ------------------------------------------------------------------ */
  MT.route('staff', {}, function () {
    var today = U.todayStr();
    var list = M.staffList(true);
    var html = UI.backLink('#/staffing', '配置表へ') + UI.pageHead('STAFF', '社員名簿');
    if (!list.length) html += UI.empty('まだ社員が登録されていません。');
    html += '<ul class="list">' + list.map(function (s) {
      var now = M.assignments({ staffId: s.id, date: today });
      var tags = [];
      if (s.active === false) tags.push({ cls: 'none', text: '退職・休職' });
      else if (!now.length) tags.push({ cls: 'warn', text: '本日の配置なし' });
      now.forEach(function (a) { tags.push({ cls: 'ok', text: (a.role || '') + '：' + siteName(a.siteId) }); });
      return '<li>' + UI.rowLink('#/staff/' + encodeURIComponent(s.id) + '/edit', {
        count: (s.name || '？').charAt(0), unit: '',
        countClass: s.active === false ? 'idle' : (now.length ? 'done' : ''),
        main: s.name,
        subHtml: esc([s.position, s.qualifications ? String(s.qualifications).split('\n')[0] : ''].filter(Boolean).join(' ／ ')),
        tags: tags
      }) + '</li>';
    }).join('') + '</ul>';
    html += UI.btnRow('<a class="btn" href="#/staff/new">＋ 社員を登録</a>');
    U.app().innerHTML = html;
  });

  function staffForm(s) {
    var isNew = !s;
    s = s || { active: true };
    U.app().innerHTML = UI.backLink('#/staff', '社員名簿へ戻る') +
      UI.pageHead('STAFF', isNew ? '社員の登録' : '社員の編集') +
      '<div class="card">' +
      '<div class="field-row">' + UI.field('氏名', UI.text('f-name', s.name, '例：尾割 順一'), true) + UI.field('ふりがな', UI.text('f-kana', s.kana, '例：おわり じゅんいち')) + '</div>' +
      UI.field('役職', UI.text('f-position', s.position, '例：工事部 主任')) +
      UI.field('資格', UI.textarea('f-qual', s.qualifications, '1行に1つ（例：1級土木施工管理技士）')) +
      UI.field('電話番号', UI.text('f-phone', s.phone, '', ' inputmode="tel"')) +
      UI.checkbox('f-active', '在籍中（配置表に表示する）', s.active !== false) +
      UI.field('備考', UI.textarea('f-note', s.note)) +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="#/staff">キャンセル</a>') +
      (isNew ? '' : UI.btnRow('<button class="btn danger" id="b-del">この社員を削除</button>') +
        '<p class="muted">退職した社員は、削除せずに「在籍中」を外しておくと、過去の配置の記録が残ります。</p>');

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name');
      if (!name) return U.toast('氏名を入力してください');
      s.name = name;
      s.kana = U.val('#f-kana');
      s.position = U.val('#f-position');
      s.qualifications = U.val('#f-qual');
      s.phone = U.val('#f-phone');
      s.active = U.checked('#f-active');
      s.note = U.val('#f-note');
      Store.put('staff', s);
      U.toast('保存しました');
      U.go('#/staff');
    });
    U.on('#b-del', 'click', function () {
      var n = M.assignments({ staffId: s.id }).length;
      if (!confirm('「' + s.name + '」を削除します。' + (n ? '配置の記録 ' + n + ' 件も削除されます。' : '') + 'よろしいですか？')) return;
      M.assignments({ staffId: s.id }).forEach(function (a) { Store.remove('assignments', a.id); });
      Store.remove('staff', s.id);
      U.toast('削除しました');
      U.go('#/staff');
    });
  }

  MT.route('staff/new', { form: true }, function () { staffForm(null); });
  MT.route('staff/([^/]+)/edit', { form: true }, function (m) {
    var s = Store.get('staff', m[0]);
    if (!s) return MT.notFound('社員が見つかりません。');
    staffForm(s);
  });

  /* ------------------------------------------------------------------ *
   * 全社の配置表（月ごと）
   * ------------------------------------------------------------------ */
  function staffingHtml(ym, forPrint) {
    var days = U.daysInMonth(ym);
    var from = ym + '-01', to = ym + '-' + U.pad(days);
    var staff = M.staffList();
    var sites = M.sites();
    var colorOf = {};
    sites.forEach(function (s, i) { colorOf[s.id] = i % 8; });
    function pos(d) { return (U.diffDays(from, d) / days) * 100; }

    var head = '<div class="g-row g-head"><div class="g-name">社員</div><div class="g-track">';
    for (var d = 1; d <= days; d += (days > 20 ? 5 : 1)) {
      head += '<span class="g-tick" style="left:' + ((d - 1) / days * 100) + '%">' + d + '</span>';
    }
    var today = U.todayStr();
    var todayLine = today >= from && today <= to ? '<span class="g-today" style="left:' + pos(today) + '%"></span>' : '';
    head += '</div></div>';

    var usedSites = {};
    var rows = staff.map(function (s) {
      var bars = M.assignments({ staffId: s.id }).filter(function (a) {
        return (!a.from || a.from <= to) && (!a.to || a.to >= from);
      });
      var track = bars.map(function (a, i) {
        usedSites[a.siteId] = true;
        var start = !a.from || a.from < from ? from : a.from;
        var end = !a.to || a.to > to ? to : a.to;
        var l = pos(start), w = Math.max(1, pos(U.addDays(end, 1)) - l);
        var tip = siteName(a.siteId) + (a.role ? '（' + a.role + '）' : '') + '\n' + periodFull(a);
        return '<button type="button" class="s-bar c' + colorOf[a.siteId] + '"' +
          (forPrint ? '' : ' data-as="' + esc(a.id) + '" data-staff="' + esc(s.id) + '"') +
          ' style="left:' + l + '%;width:' + w + '%;top:' + (2 + (i % 3) * 7) + 'px" title="' +
          esc(tip) + '">' + esc(siteName(a.siteId)) + '</button>';
      }).join('');

      /* 帯をタッチ（またはカーソルを合わせて）開く、配置期間の明細 */
      var detail = '';
      if (!forPrint && bars.length) {
        detail = '<div class="s-detail" data-detail="' + esc(s.id) + '" hidden>' +
          '<div class="s-detail-head">' + esc(s.name) + ' の配置</div><ul class="s-detail-list">' +
          bars.map(function (a) {
            return '<li data-as="' + esc(a.id) + '"><span class="s-chip c' + colorOf[a.siteId] + '"></span>' +
              '<span class="s-d-body"><a href="#/site/' + encodeURIComponent(a.siteId) + '?tab=staff">' + esc(siteName(a.siteId)) + '</a>' +
              (a.role ? '<span class="s-d-role">' + esc(a.role) + '</span>' : '') +
              '<span class="s-d-term">' + esc(periodFull(a)) + '</span>' +
              (a.note ? '<span class="s-d-note">' + esc(a.note) + '</span>' : '') + '</span>' +
              '<a class="s-d-edit" href="#/assignment/' + encodeURIComponent(a.id) + '/edit">直す</a></li>';
          }).join('') + '</ul></div>';
      }

      var name = forPrint || !bars.length ? esc(s.name)
        : '<button type="button" class="s-name" data-staff="' + esc(s.id) + '">' + esc(s.name) + '</button>';
      return '<div class="g-row' + (bars.length ? '' : ' empty') + '"><div class="g-name">' + name +
        (bars.length ? '' : '<span class="g-pct">未配置</span>') + '</div><div class="g-track tall">' + track + todayLine + '</div></div>' +
        detail;
    }).join('');

    var legend = sites.filter(function (s) { return usedSites[s.id]; }).map(function (s) {
      return '<span class="s-legend c' + colorOf[s.id] + '">' + esc(s.name) + '</span>';
    }).join('');

    return '<div class="gantt staffing' + (forPrint ? ' print' : '') + '">' + head + (rows || '<p class="muted">社員が登録されていません。</p>') + '</div>' +
      (legend ? '<div class="legend-row">' + legend + '</div>' : '');
  }

  /*
   * 帯・氏名をタッチしたら、その社員の配置期間を開く。
   * 開いている相手を覚えておき、同期などで画面が描き直されても開いたままにする。
   */
  var openStaff = '';
  var openAs = '';

  function bindStaffing() {
    var root = U.qs('.gantt.staffing');
    if (!root) return;
    var panels = U.qsa('.s-detail');

    function apply() {
      panels.forEach(function (p) {
        var mine = p.getAttribute('data-detail') === openStaff;
        p.hidden = !mine;
        U.qsa('li', p).forEach(function (li) {
          li.classList.toggle('on', mine && !!openAs && li.getAttribute('data-as') === openAs);
        });
      });
      U.qsa('.s-bar', root).forEach(function (b) {
        b.classList.toggle('on', !!openAs && b.getAttribute('data-as') === openAs);
      });
    }

    root.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-staff]') : null;
      if (!t) return;
      var staffId = t.getAttribute('data-staff');
      var asId = t.getAttribute('data-as') || '';
      if (!asId && openStaff === staffId) { openStaff = ''; openAs = ''; }  // 氏名をもう一度押したら閉じる
      else { openStaff = staffId; openAs = asId; }
      apply();
    });

    apply();
  }

  MT.route('staffing', {}, function (m, params) {
    var ym = U.isYm(params.ym) ? params.ym : U.thisMonth();
    var today = U.todayStr();
    var staff = M.staffList();
    var unassigned = staff.filter(function (s) { return !M.assignments({ staffId: s.id, date: today }).length; });
    var sites = M.sites({ activeOnly: true });

    var html = UI.pageHead('STAFFING', '人員配置') +
      '<div class="month-nav">' +
      '<a class="btn small plain" href="#/staffing?ym=' + U.addMonths(ym, -1) + '">‹ 前の月</a>' +
      '<strong>' + esc(U.ymLabel(ym)) + '</strong>' +
      '<a class="btn small plain" href="#/staffing?ym=' + U.addMonths(ym, 1) + '">次の月 ›</a></div>' +
      '<div class="card">' + staffingHtml(ym) + '</div>';

    html += UI.h2('TODAY', '本日の配置（現場ごと）');
    html += '<div class="card"><table class="kv"><tbody>' + sites.map(function (s) {
      var list = M.assignments({ siteId: s.id, date: today });
      return '<tr><th><a href="#/site/' + encodeURIComponent(s.id) + '?tab=staff">' + esc(s.name) + '</a></th><td>' +
        (list.length ? list.map(function (a) { return esc(staffName(a.staffId)) + '<span class="muted">（' + esc(a.role || '') + '）</span>'; }).join('、') : '<span class="muted">配置なし</span>') + '</td></tr>';
    }).join('') + '</tbody></table>' +
      (unassigned.length ? '<p><strong>本日配置のない社員：</strong>' + unassigned.map(function (s) { return esc(s.name); }).join('、') + '</p>' : '') + '</div>';

    html += UI.btnRow('<a class="btn secondary" href="#/assignment/new">＋ 社員を配置する</a><a class="btn secondary" href="#/staff">社員名簿</a>') +
      UI.btnRow('<a class="btn plain" href="#/print/staffing?ym=' + ym + '">配置表を印刷</a>');
    U.app().innerHTML = html;
    bindStaffing();
  });

  MT.route('print/staffing', { print: true }, function (m, params) {
    var ym = U.isYm(params.ym) ? params.ym : U.thisMonth();
    U.app().innerHTML = UI.printBar('#/staffing?ym=' + ym, '用紙の向きは横がおすすめです。') +
      '<div class="print-sheet"><div class="doc">' +
      '<div class="doc-head"><div><div class="doc-title">人員配置表</div><div class="doc-sub">' + esc(U.ymLabel(ym)) + '</div></div>' +
      '<div class="doc-sub">' + esc((global.APP_CONFIG && global.APP_CONFIG.company) || '') + '</div></div>' +
      staffingHtml(ym, true) + '</div></div>';
    UI.bindPrint();
  });
})(window);
