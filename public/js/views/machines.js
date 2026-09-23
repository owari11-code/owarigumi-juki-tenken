/*
 * views/machines.js - 重機・機械（搬入・返却、リース、法定検査・保険の期限）
 *
 *   重機（category = heavy）… 日常点検の対象。点検の画面も持つ
 *   機械（category = equipment）… 発電機・仮設ハウスなど。搬入・返却と期限だけを管理する
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var M = MT.model;
  var Store = MT.store;
  var Session = MT.session;
  var Cat = MT.cat;
  var A = MT.assets;
  var esc = U.esc;

  function typeName(m) {
    return M.isHeavy(m) ? Cat.get('heavy').typeName(m.type) : A.nameOf(A.EQUIPMENT_TYPES, m.type, 'その他の機械');
  }

  function lastName() {
    try { return localStorage.getItem('maruten-last-inspector') || ''; } catch (e) { return ''; }
  }

  /** 期限のうち、いちばん近いもの */
  function nextDue(mc) {
    var best = null;
    [['inspectionExpiry', '特定自主検査'], ['shakenExpiry', '車検'], ['insuranceExpiry', '保険']].forEach(function (f) {
      if (!U.isDate(mc[f[0]])) return;
      var d = U.diffDays(U.todayStr(), mc[f[0]]);
      if (best === null || d < best.days) best = { days: d, label: f[1], date: mc[f[0]] };
    });
    return best;
  }

  /* ------------------------------------------------------------------ *
   * 重機・機械の一覧（事務所。ホームのタブから開く）
   * ------------------------------------------------------------------ */
  MT.route('machines', {}, function (m, params) {
    M.ensureDepot();
    var filter = params.f || 'all';
    var all = M.allMachines();
    var counts = { all: all.length, site: 0, depot: 0, due: 0 };
    all.forEach(function (mc) {
      if (M.isAtDepot(mc)) counts.depot++; else counts.site++;
      if (M.machineWarnings(mc).length) counts.due++;
    });
    var list = all.filter(function (mc) {
      if (filter === 'site') return !M.isAtDepot(mc);
      if (filter === 'depot') return M.isAtDepot(mc);
      if (filter === 'due') return M.machineWarnings(mc).length > 0;
      return true;
    });

    var html = UI.pageHead('MACHINES', '重機・機械') +
      UI.tabs(function (k) { return '#/machines?f=' + k; }, [
        ['all', 'すべて', String(counts.all)],
        ['site', '現場に出ている', String(counts.site)],
        ['depot', '置場', String(counts.depot)],
        ['due', '期限注意', counts.due ? String(counts.due) : '']
      ], filter);

    if (!list.length) html += UI.empty(all.length ? '該当する機械はありません。' : 'まだ重機・機械が登録されていません。');
    html += '<ul class="list">' + list.map(function (mc) {
      var where = M.machineWhere(mc);
      var due = nextDue(mc);
      var tags = [{ cls: M.isHeavy(mc) ? 'done' : 'none', text: M.isHeavy(mc) ? '重機' : '機械' }];
      if (mc.ownership === 'lease') tags.push({ cls: 'none', text: 'リース' });
      M.machineWarnings(mc).forEach(function (w) { tags.push(w); });
      return '<li>' + UI.rowLink('#/machine/' + encodeURIComponent(mc.id), {
        count: where.atDepot ? '置' : '出', unit: where.atDepot ? 'DEPOT' : 'ON SITE',
        countClass: where.atDepot ? 'idle' : 'done',
        main: mc.name,
        subHtml: esc([typeName(mc), ((mc.maker || '') + ' ' + (mc.model || '')).trim()].filter(Boolean).join('　／　')) +
          '<br>' + (where.atDepot ? '置場：' : '持出先：') + esc(where.label) +
          (due ? '　／　' + esc(due.label) + ' ' + esc(U.formatShort(due.date)) : ''),
        tags: tags
      }) + '</li>';
    }).join('') + '</ul>';

    html += UI.btnRow('<a class="btn" href="#/machine/new?cat=heavy">＋ 重機を登録</a>' +
      '<a class="btn secondary" href="#/machine/new?cat=equipment">＋ そのほかの機械を登録</a>') +
      UI.btnRow('<a class="btn secondary" href="#/print/machine-labels">QRラベルを印刷</a>') +
      '<p class="muted">持出先の現場は、それぞれの機械の画面から変えられます。変えると、その現場の「機械」「点検」にも出るようになります。</p>';
    U.app().innerHTML = html;
  });

  /* ------------------------------------------------------------------ *
   * 印刷：重機・機械のQRラベル（現場をまたいで全部）
   * ------------------------------------------------------------------ */
  MT.route('print/machine-labels', { print: true }, function () {
    var labels = [];
    M.allMachines().forEach(function (mc) {
      var site = Store.get('sites', mc.siteId);
      if (!site) return;
      labels.push({
        url: UI.qrUrl('m', site, mc),
        title: mc.name,
        sub: [typeName(mc), site.depot ? (mc.place || '置場') : site.name].filter(Boolean).join('／'),
        badge: M.isHeavy(mc) ? '重機' : '機械',
        guide: M.isHeavy(mc) ? '読み取って点検・搬入搬出を記録' : '読み取って搬入・搬出を記録'
      });
    });
    if (!labels.length) {
      U.app().innerHTML = UI.backLink('#/machines', '戻る') + UI.empty('印刷するラベルがありません。');
      return;
    }
    U.app().innerHTML = UI.printBar('#/machines',
      labels.length + '枚のラベルを印刷します。<strong>持出先を変えた機械は、貼り直してください</strong>（QRは現場ごとの鍵を持っているため）。') +
      UI.labelsHtml(labels);
    UI.drawLabels(labels);
    UI.bindPrint();
  });

  /* ------------------------------------------------------------------ *
   * 現場の「機械」タブ
   * ------------------------------------------------------------------ */
  MT.siteTabs.machines = {
    label: '機械',
    badge: function (site) {
      var n = Store.list('machines', null, site.id).reduce(function (c, m) {
        return c + M.machineWarnings(m).filter(function (w) { return w.level === 2; }).length;
      }, 0);
      return n ? '!' + n : '';
    },
    render: function (site) {
      var sid = encodeURIComponent(site.id);
      var list = Store.list('machines', null, site.id).sort(function (a, b) {
        if (M.isHeavy(a) !== M.isHeavy(b)) return M.isHeavy(a) ? -1 : 1;
        return U.byName(a, b);
      });
      var html = '<p class="muted">重機（日常点検の対象）と、発電機・仮設ハウスなどの機械の、搬入・返却とリース・法定検査・保険の期限をまとめて管理します。</p>';
      if (!list.length) html += UI.empty('まだ機械が登録されていません。');
      html += '<ul class="list">' + list.map(function (mc) {
        var st = M.machineState(mc);
        var warns = M.machineWarnings(mc);
        var tags = [{ cls: M.isHeavy(mc) ? 'done' : 'none', text: M.isHeavy(mc) ? '重機' : '機械' }];
        if (mc.ownership === 'lease') tags.push({ cls: 'none', text: 'リース' + (mc.leaseCompany ? '：' + mc.leaseCompany : '') });
        warns.forEach(function (w) { tags.push(w); });
        return '<li>' + UI.rowLink('#/machine/' + encodeURIComponent(mc.id), {
          count: st.state === 'in' ? '在' : st.state === 'out' ? '出' : '－', unit: st.state === 'in' ? 'ON SITE' : '',
          countClass: st.state === 'in' ? 'done' : 'idle',
          main: mc.name,
          subHtml: esc(typeName(mc)) + '<br>' + esc(st.label) +
            (mc.ownership === 'lease' && mc.returnPlanDate && st.state !== 'out' ? '　返却予定 ' + esc(U.formatShort(mc.returnPlanDate)) : ''),
          tags: tags
        }) + '</li>';
      }).join('') + '</ul>';
      html += UI.btnRow('<a class="btn small secondary" href="#/machine/new?site=' + sid + '&cat=heavy">＋ 重機を登録</a>' +
        '<a class="btn small secondary" href="#/machine/new?site=' + sid + '&cat=equipment">＋ そのほかの機械を登録</a>');
      html += UI.btnRow('<a class="btn small plain" href="#/print/labels?site=' + sid + '&kind=equipment">機械のQRラベルを印刷</a>' +
        '<a class="btn small plain" href="#/machines">重機・機械の一覧（全社）</a>');
      return html;
    }
  };

  /* ------------------------------------------------------------------ *
   * 登録・編集
   * ------------------------------------------------------------------ */
  function machineForm(machine, siteId, catParam) {
    var isNew = !machine;
    var heavy = isNew ? catParam !== 'equipment' : M.isHeavy(machine);
    var depot = M.ensureDepot();
    machine = machine || {
      siteId: siteId || depot.id, category: heavy ? 'heavy' : 'equipment',
      type: heavy ? 'backhoe_crawler' : 'generator', ownership: 'own'
    };
    var site = Store.get('sites', machine.siteId) || depot;
    var back = isNew
      ? (siteId ? '#/site/' + encodeURIComponent(site.id) + '?tab=' + (heavy ? 'inspect' : 'machines') : '#/machines')
      : '#/machine/' + encodeURIComponent(machine.id);
    var types = heavy ? Cat.get('heavy').types : A.EQUIPMENT_TYPES;
    var sites = [[depot.id, '置場（現場に出していない）']].concat(M.sites().map(function (s) { return [s.id, s.name]; }));

    U.app().innerHTML =
      UI.backLink(back, '戻る') +
      UI.pageHead(heavy ? 'MACHINE' : 'EQUIPMENT', (heavy ? '重機' : '機械') + (isNew ? 'の登録' : 'の編集')) +
      '<div class="card">' +
      UI.field('呼び名', UI.text('f-name', machine.name, heavy ? '例：バックホウ0.45m3 ①' : '例：発電機 25kVA'), true) +
      UI.field(heavy ? '機種' : '種類', UI.select('f-type', types.map(function (t) { return [t.id, t.name]; }), machine.type), true) +
      UI.field('いまある場所（持出先）', UI.select('f-site', sites, machine.siteId), true) +
      '<div id="place-box">' +
      UI.field('保管場所', UI.pickOther('f-place', A.PLACES, machine.place, '例：本社 車庫')) +
      '</div>' +
      '<div class="field-row">' +
      UI.field('メーカー', UI.text('f-maker', machine.maker, '例：コマツ')) +
      UI.field('型式', UI.text('f-model', machine.model, '例：PC138US')) +
      '</div>' +
      UI.field('機番・車両番号', UI.text('f-serial', machine.serial)) +
      '</div>' +

      UI.h2('LEASE', '所有・搬入・返却') + '<div class="card">' +
      UI.field('所有', UI.select('f-owner', [['own', '自社'], ['lease', 'リース・レンタル']], machine.ownership || 'own')) +
      '<div id="lease-box">' +
      UI.field('リース会社', UI.text('f-lease', machine.leaseCompany, '例：○○リース 豊田営業所')) +
      UI.field('リース会社の連絡先', UI.text('f-lease-tel', machine.leaseContact, '例：0565-00-0000（担当 ○○）')) +
      '</div>' +
      '<div class="field-row">' +
      UI.field('搬入日', UI.date('f-in', machine.carryInDate)) +
      UI.field('返却（搬出）予定日', UI.date('f-plan', machine.returnPlanDate)) +
      '</div>' +
      UI.field('返却（搬出）日', UI.date('f-out', machine.returnedDate), false, '現場で「搬入・搬出を記録」した場合は、そちらが優先されます') +
      '</div>' +

      UI.h2('LEGAL', '法定検査・保険の期限') + '<div class="card">' +
      '<p class="section-note">期限の30日前から、ホームと現場の画面でお知らせします（現場から搬出済みの機械は除く）。</p>' +
      UI.field('特定自主検査（年次）の有効期限', UI.date('f-insp', machine.inspectionExpiry)) +
      UI.field('車検の満了日', UI.date('f-shaken', machine.shakenExpiry)) +
      UI.field('任意保険の満了日', UI.date('f-ins', machine.insuranceExpiry)) +
      UI.field('備考', UI.textarea('f-note', machine.note)) +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="' + esc(back) + '">キャンセル</a>') +
      (isNew ? '' : UI.btnRow('<button class="btn danger" id="b-del">この' + (heavy ? '重機' : '機械') + 'を削除</button>') +
        '<p class="muted">削除すると、点検記録と搬入・搬出の記録も削除されます。</p>');

    function toggleLease() {
      var box = U.qs('#lease-box');
      if (box) box.hidden = U.val('#f-owner') !== 'lease';
    }
    U.on('#f-owner', 'change', toggleLease);
    toggleLease();

    /* 保管場所は、置場にあるときだけ使う */
    function togglePlace() {
      var box = U.qs('#place-box');
      if (box) box.hidden = U.val('#f-site') !== depot.id;
    }
    UI.bindPickOther('f-place');
    U.on('#f-site', 'change', togglePlace);
    togglePlace();

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name');
      if (!name) { U.toast('呼び名を入力してください'); return U.qs('#f-name').focus(); }
      var newSite = U.val('#f-site');
      if (!isNew && newSite !== machine.siteId) {
        if (!confirm('いまある場所を変更します。この機械の点検記録は元の現場に残り、QRラベルは貼り直しが必要です。よろしいですか？')) return;
      }
      machine.name = name;
      machine.category = heavy ? 'heavy' : 'equipment';
      machine.type = U.val('#f-type');
      machine.siteId = newSite;
      machine.place = UI.pickOtherValue('f-place');
      machine.maker = U.val('#f-maker');
      machine.model = U.val('#f-model');
      machine.serial = U.val('#f-serial');
      machine.ownership = U.val('#f-owner');
      machine.leaseCompany = U.val('#f-lease');
      machine.leaseContact = U.val('#f-lease-tel');
      machine.carryInDate = U.val('#f-in');
      machine.returnPlanDate = U.val('#f-plan');
      machine.returnedDate = U.val('#f-out');
      machine.inspectionExpiry = U.val('#f-insp');
      machine.shakenExpiry = U.val('#f-shaken');
      machine.insuranceExpiry = U.val('#f-ins');
      machine.note = U.val('#f-note');
      Store.put('machines', machine);
      U.toast('保存しました');
      U.go('#/machine/' + encodeURIComponent(machine.id));
    });

    U.on('#b-del', 'click', function () {
      if (!confirm('「' + machine.name + '」と、その記録をすべて削除します。よろしいですか？')) return;
      M.inspections({ siteId: machine.siteId, targetId: machine.id }).forEach(function (r) { Store.remove('inspections', r.id); });
      M.machineHistory(machine).forEach(function (l) { Store.remove('machine_logs', l.id); });
      Store.remove('machines', machine.id);
      U.toast('削除しました');
      U.go('#/machines');
    });
  }

  MT.route('machine/new', { form: true }, function (m, params) { machineForm(null, params.site, params.cat); });
  MT.route('machine/([^/]+)/edit', { form: true }, function (m) {
    var mc = Store.get('machines', m[0]);
    if (!mc) return MT.notFound('機械が見つかりません。');
    machineForm(mc);
  });

  /* ------------------------------------------------------------------ *
   * 機械の画面（QRから開く）
   * ------------------------------------------------------------------ */
  MT.route('machine/([^/]+)', { access: 'field' }, function (m, params) {
    var mc = Store.get('machines', m[0]);
    if (!mc) {
      if (MT.sync.status().running) return MT.loading();
      return MT.notFound('機械が見つかりません。');
    }
    if (!MT.requireSiteAccess(mc.siteId)) return;
    var site = Store.get('sites', mc.siteId) || {};
    var admin = Session.isAdmin();
    var heavy = M.isHeavy(mc);
    var st = M.machineState(mc);
    var where = M.machineWhere(mc);

    var backHref = admin && where.atDepot ? '#/machines'
      : '#/site/' + encodeURIComponent(mc.siteId) + (admin ? '?tab=' + (heavy ? 'inspect' : 'machines') : '');
    var html = UI.backLink(backHref, admin && where.atDepot ? '重機・機械の一覧へ' : '現場へ戻る') +
      UI.pageHead(heavy ? 'MACHINE' : 'EQUIPMENT', mc.name) +
      '<div class="card blueprint">' + UI.corners() + '<div class="meta-lines">' +
      esc((where.atDepot ? '置場：' : '持出先：') + where.label) + '<br>' +
      esc([typeName(mc), ((mc.maker || '') + ' ' + (mc.model || '')).trim(), mc.serial ? '機番 ' + mc.serial : ''].filter(Boolean).join('　／　')) +
      '</div></div>';

    if (heavy) html += MT.inspectPanelHtml(mc, 'heavy');

    /* 持出先（事務所だけが変えられる） */
    if (admin) {
      var depot2 = M.ensureDepot();
      var moveTo = [['', '（選ぶ）']];
      if (!where.atDepot) moveTo.push([depot2.id, '置場（現場から戻す）']);
      M.sites({ activeOnly: true }).forEach(function (s) {
        if (s.id !== mc.siteId) moveTo.push([s.id, s.name]);
      });
      html += UI.h2('MOVE', '持出先') + '<div class="card">' +
        '<p><strong>いま：' + esc((where.atDepot ? '置場　' : '現場　') + where.label) + '</strong></p>' +
        UI.field('移す先', UI.select('mv-site', moveTo, '')) +
        '<div class="field-row">' +
        UI.field('日付', UI.date('mv-date', U.todayStr()), true) +
        UI.field('記録者', UI.text('mv-person', lastName()), true) + '</div>' +
        UI.field('備考', UI.text('mv-note', '', '例：回送 ○○運輸')) +
        UI.btnRow('<button class="btn" id="b-move">ここへ移す</button>') +
        '<p class="muted">移す前の現場に「搬出」、移した先に「搬入」を記録します。' +
        'QRラベルは現場ごとの鍵を持っているため、<strong>移したら貼り直してください</strong>。</p></div>';
    }

    /* 搬入・搬出 */
    var logs = M.machineHistory(mc).slice().reverse();
    html += UI.h2('CARRY', '搬入・搬出') +
      '<div class="card"><p><strong>' + esc(where.atDepot ? '置場にあり（' + where.label + '）' : st.label) + '</strong></p>' +
      (mc.ownership === 'lease'
        ? '<p class="muted">リース：' + esc(mc.leaseCompany || '－') + (mc.leaseContact ? '（' + esc(mc.leaseContact) + '）' : '') +
          (mc.returnPlanDate ? '<br>返却予定：' + esc(U.formatDate(mc.returnPlanDate)) : '') + '</p>'
        : '') +
      UI.btnRow('<button class="btn secondary" data-carry="carry_in">搬入を記録</button><button class="btn secondary" data-carry="carry_out">搬出（返却）を記録</button>') +
      '<div id="carry-form"></div>' +
      (logs.length ? '<div class="table-scroll"><table class="data compact-table"><thead><tr><th>日付</th><th>区分</th><th>現場</th><th>記録者</th><th>備考</th></tr></thead><tbody>' +
        logs.slice(0, 15).map(function (l) {
          var ls = Store.get('sites', l.siteId);
          return '<tr><td>' + esc(U.formatShort(l.date)) + '</td><td>' + (l.type === 'carry_in' ? '搬入' : '搬出') + '</td>' +
            '<td>' + esc(ls ? (ls.depot ? '置場' : ls.name) : '') + '</td><td>' +
            esc(l.person || '') + '</td><td>' + esc(l.note || '') + (admin ? ' <button class="link-btn" data-dellog="' + esc(l.id) + '">削除</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">搬入・搬出の記録はまだありません。</p>') +
      '</div>';

    /* 期限 */
    var dues = [['inspectionExpiry', '特定自主検査'], ['shakenExpiry', '車検'], ['insuranceExpiry', '任意保険']].filter(function (f) { return mc[f[0]]; });
    if (dues.length) {
      html += UI.h2('LEGAL', '法定検査・保険の期限') + '<div class="card"><table class="kv"><tbody>' + dues.map(function (f) {
        var t = UI.dueTag(mc[f[0]], '', 30);
        return '<tr><th>' + esc(f[1]) + '</th><td>' + esc(U.formatDate(mc[f[0]])) + ' ' +
          (t && t.level ? UI.tag({ cls: t.cls, text: t.days < 0 ? '期限切れ' : 'あと' + t.days + '日' }) : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }

    if (admin) {
      html += UI.h2('QR', 'この機械のQRコード') +
        '<div class="card qr-box"><div id="qr"></div><div class="qr-url">読み取ると、この画面が開きます（ログイン不要）</div></div>' +
        UI.btnRow('<a class="btn secondary" href="#/print/labels?site=' + encodeURIComponent(site.id) + '&kind=' + (heavy ? 'one-machine' : 'one-equipment') +
          '&id=' + encodeURIComponent(mc.id) + '">QRラベルを印刷</a><a class="btn plain" href="#/machine/' + encodeURIComponent(mc.id) + '/edit">登録内容を編集</a>');
      if (mc.note) html += UI.h2('MEMO', '備考') + '<div class="card"><p>' + U.nl2br(mc.note) + '</p></div>';
    }

    U.app().innerHTML = html;
    if (admin) UI.drawQr(U.qs('#qr'), UI.qrUrl('m', site, mc), 220);

    U.qsa('[data-carry]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.getAttribute('data-carry');
        U.qs('#carry-form').innerHTML = '<div class="inline-form">' +
          '<div class="field-row">' + UI.field(type === 'carry_in' ? '搬入日' : '搬出日', UI.date('c-date', U.todayStr()), true) +
          UI.field('記録者', UI.text('c-person', (function () { try { return localStorage.getItem('maruten-last-inspector') || ''; } catch (e) { return ''; } })()), true) + '</div>' +
          UI.field('備考', UI.text('c-note', '', '例：回送業者 ○○運輸')) +
          UI.btnRow('<button class="btn" id="c-save">' + (type === 'carry_in' ? '搬入' : '搬出') + 'を記録する</button><button class="btn plain" id="c-cancel">やめる</button>') +
          '</div>';
        U.on('#c-cancel', 'click', function () { U.qs('#carry-form').innerHTML = ''; });
        U.on('#c-save', 'click', function () {
          var date = U.val('#c-date'), person = U.val('#c-person');
          if (!U.isDate(date)) return U.toast('日付を入力してください');
          if (!person) return U.toast('記録者を入力してください');
          Store.put('machine_logs', { siteId: mc.siteId, machineId: mc.id, type: type, date: date, person: person, note: U.val('#c-note') });
          try { localStorage.setItem('maruten-last-inspector', person); } catch (e) { /* 無視 */ }
          U.toast(type === 'carry_in' ? '搬入を記録しました' : '搬出を記録しました');
          MT.rerender();
        });
      });
    });

    U.on('#b-move', 'click', function () {
      var to = U.val('#mv-site');
      var date = U.val('#mv-date');
      var person = U.val('#mv-person');
      if (!to) return U.toast('移す先を選んでください');
      if (!U.isDate(date)) return U.toast('日付を入れてください');
      if (!person) return U.toast('記録者を入れてください');
      var toSite = Store.get('sites', to);
      if (!confirm('「' + mc.name + '」を ' + (toSite && toSite.depot ? '置場' : (toSite ? toSite.name : '')) +
        ' へ移します。\nQRラベルは貼り直しが必要です。よろしいですか？')) return;
      M.moveMachine(mc, to, date, person, U.val('#mv-note'));
      try { localStorage.setItem('maruten-last-inspector', person); } catch (e) { /* 無視 */ }
      U.toast('持出先を変えました');
      MT.rerender();
    });

    U.qsa('[data-dellog]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('この記録を削除します。よろしいですか？')) return;
        Store.remove('machine_logs', btn.getAttribute('data-dellog'));
        MT.rerender();
      });
    });
  });
})(window);
