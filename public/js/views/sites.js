/*
 * views/sites.js - 工事現場（一覧・登録・現場の画面・QRの印刷）
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

  var TAB_ORDER = ['overview', 'inspect', 'ky', 'entrant', 'materials', 'machines', 'schedule', 'staff', 'qr'];

  /* ------------------------------------------------------------------ *
   * 一覧
   * ------------------------------------------------------------------ */
  MT.route('sites', {}, function (m, params) {
    var filter = params.status || 'open';
    var all = M.sites();
    var list = all.filter(function (s) {
      if (filter === 'open') return s.status !== 'done';
      if (filter === 'done') return s.status === 'done';
      return true;
    });
    var html = UI.pageHead('SITES', '工事現場') +
      UI.tabs(function (k) { return '#/sites?status=' + k; }, [
        ['open', '施工中・着工前', String(all.filter(function (s) { return s.status !== 'done'; }).length)],
        ['done', '完成', String(all.filter(function (s) { return s.status === 'done'; }).length)],
        ['all', 'すべて']
      ], filter);

    if (!list.length) html += UI.empty('該当する現場はありません。');
    html += '<ul class="list">';
    var today = U.todayStr();
    list.forEach(function (s) {
      var st = M.siteToday(s.id);
      var p = M.progress(s.id, today);
      var subs = [];
      if (s.contractNo) subs.push(esc(s.contractNo));
      if (s.client) subs.push(esc(s.client));
      if (s.periodFrom || s.periodTo) subs.push(esc(U.formatShort(s.periodFrom) + '〜' + U.formatShort(s.periodTo)));
      var tags = [{ cls: s.status === 'done' ? 'done' : s.status === 'planned' ? 'none' : 'ok', text: M.siteStatusName(s) }];
      if (s.status !== 'done') {
        if (st.ng) tags.push({ cls: 'ng', text: '否あり ' + st.ng });
        if (st.total) tags.push(st.done === st.total ? { cls: 'done', text: '本日点検 完了' } : { cls: 'none', text: '本日未点検 ' + (st.total - st.done) });
        if (p.actual !== null) tags.push(M.progressLabel(p));
      }
      html += '<li>' + UI.rowLink('#/site/' + encodeURIComponent(s.id), {
        count: p.actual === null ? '－' : Math.round(p.actual),
        unit: p.actual === null ? '' : '%進捗',
        countClass: s.status === 'done' ? 'done' : (p.actual === null ? 'idle' : ''),
        main: s.name,
        subHtml: subs.join(' ／ '),
        tags: tags
      }) + '</li>';
    });
    html += '</ul>';
    html += UI.btnRow('<a class="btn" href="#/site/new">＋ 工事現場を登録</a>');
    U.app().innerHTML = html;
  });

  /* ------------------------------------------------------------------ *
   * 登録・編集
   * ------------------------------------------------------------------ */
  function siteForm(site) {
    var isNew = !site;
    site = site || { status: 'active' };
    var back = isNew ? '#/sites' : '#/site/' + encodeURIComponent(site.id);
    U.app().innerHTML =
      UI.backLink(back, isNew ? '現場一覧へ戻る' : '現場へ戻る') +
      UI.pageHead('SITE', isNew ? '工事現場の登録' : '工事現場の編集') +
      '<div class="card">' +
      UI.field('工事番号', UI.text('f-contract', site.contractNo, '例：R8-道改-1234')) +
      UI.field('工事名（現場名）', UI.text('f-name', site.name, '例：○○川災害復旧工事'), true) +
      UI.field('発注者', UI.text('f-client', site.client, '例：愛知県○○建設事務所')) +
      UI.field('工事場所', UI.text('f-location', site.location, '例：豊田市○○町地内')) +
      UI.field('工事延長・数量', UI.text('f-extent', site.extent, '例：L=34.4m'), false, '実施工程表（Excel）の「工事延長」欄に入ります') +
      '<div class="field-row">' +
      UI.field('工期（開始）', UI.date('f-from', site.periodFrom)) +
      UI.field('工期（終了）', UI.date('f-to', site.periodTo)) +
      '</div>' +
      '<div class="field-row">' +
      UI.field('現場代理人', UI.text('f-manager', site.manager)) +
      UI.field('主任技術者', UI.text('f-engineer', site.engineer)) +
      '</div>' +
      UI.field('状態', UI.select('f-status', A.SITE_STATUS.map(function (x) { return [x.id, x.name]; }), site.status || 'active')) +
      UI.field('社内メモ', UI.textarea('f-note', site.note, '現場の端末（QR）には表示されません')) +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="' + esc(back) + '">キャンセル</a>') +
      (isNew ? '' :
        UI.h2('DANGER', '削除') +
        '<div class="card"><p class="muted">現場を削除すると、この現場の点検対象・点検記録・資材・工程・配置もすべて削除されます。完成した現場は、削除せずに状態を「完成」にしておくことをおすすめします。</p>' +
        UI.btnRow('<button class="btn danger" id="b-del">この現場を削除</button>') + '</div>');

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name');
      if (!name) { U.toast('工事名を入力してください'); return U.qs('#f-name').focus(); }
      var from = U.val('#f-from'), to = U.val('#f-to');
      if (from && to && from > to) return U.toast('工期の終了日は開始日より後にしてください');
      site.name = name;
      site.contractNo = U.val('#f-contract');
      site.client = U.val('#f-client');
      site.location = U.val('#f-location');
      site.extent = U.val('#f-extent');
      site.periodFrom = from;
      site.periodTo = to;
      site.manager = U.val('#f-manager');
      site.engineer = U.val('#f-engineer');
      site.status = U.val('#f-status');
      site.note = U.val('#f-note');
      if (!site.fieldKey) site.fieldKey = U.randomKey();
      Store.put('sites', site);
      U.toast('保存しました');
      U.go('#/site/' + encodeURIComponent(site.id));
    });

    U.on('#b-del', 'click', function () {
      if (!confirm('「' + site.name + '」と、この現場の記録をすべて削除します。よろしいですか？')) return;
      if (!confirm('本当に削除しますか？　元に戻せません。')) return;
      var kinds = ['machines', 'targets', 'inspections', 'materials', 'stock_logs', 'machine_logs', 'tasks', 'progress_logs', 'assignments'];
      kinds.forEach(function (k) {
        Store.list(k, null, site.id).forEach(function (o) { Store.remove(k, o.id); });
      });
      Store.remove('sites', site.id);
      U.toast('削除しました');
      U.go('#/sites');
    });
  }

  MT.route('site/new', { form: true }, function () { siteForm(null); });

  MT.route('site/([^/]+)/edit', { form: true }, function (m) {
    var site = Store.get('sites', m[0]);
    if (!site || site.depot) return MT.notFound('現場が見つかりません。');
    siteForm(site);
  });

  /* ------------------------------------------------------------------ *
   * 現場の画面
   * ------------------------------------------------------------------ */
  MT.route('site/([^/]+)', { access: 'field' }, function (m, params) {
    var id = m[0];
    if (!MT.requireSiteAccess(id)) return;
    var site = Store.get('sites', id);
    if (!site) {
      if (MT.sync.status().running) return MT.loading();
      return MT.notFound('現場が見つかりません。');
    }
    if (site.depot) return U.go(Session.isAdmin() ? '#/tools' : '#/tools-field');
    if (!Session.isAdmin()) return fieldSite(site);

    var tab = TAB_ORDER.indexOf(params.tab) >= 0 ? params.tab : 'overview';
    var html = UI.backLink('#/sites', '現場一覧へ戻る') +
      '<div class="site-title"><div class="st-name">' + esc(site.name) + '</div>' +
      '<div class="st-sub">' + esc([site.contractNo, M.siteStatusName(site)].filter(Boolean).join('　／　')) + '</div></div>' +
      UI.tabs(function (k) { return '#/site/' + encodeURIComponent(site.id) + '?tab=' + k; },
        TAB_ORDER.filter(function (k) { return MT.siteTabs[k]; }).map(function (k) {
          return [k, MT.siteTabs[k].label, MT.siteTabs[k].badge ? MT.siteTabs[k].badge(site) : ''];
        }), tab);
    var t = MT.siteTabs[tab];
    html += '<div class="tab-body">' + t.render(site, params) + '</div>';
    U.app().innerHTML = html;
    if (t.bind) t.bind(site, params);
  });

  /* ---------------- 概要タブ ---------------- */
  MT.siteTabs.overview = {
    label: '概要',
    render: function (site) {
      var today = U.todayStr();
      var st = M.siteToday(site.id);
      var p = M.progress(site.id, today);
      var alerts = M.alerts(site.id);
      var staff = M.assignments({ siteId: site.id, date: today });

      var html = '<div class="card blueprint">' + UI.corners() +
        '<table class="kv"><tbody>' +
        kv('工事番号', site.contractNo) + kv('発注者', site.client) + kv('工事場所', site.location) +
        kv('工事延長', site.extent) +
        kv('工期', U.periodText(site.periodFrom, site.periodTo)) +
        kv('現場代理人', site.manager) + kv('主任技術者', site.engineer) +
        '</tbody></table></div>';

      html += '<div class="kpi-grid">' +
        '<a class="kpi' + (st.ng ? ' alarm' : '') + '" href="#/site/' + encodeURIComponent(site.id) + '?tab=inspect">' +
        '<span class="kpi-fig">' + st.done + '<span class="of">/' + st.total + '</span></span><span class="kpi-label">本日の点検</span></a>' +
        '<a class="kpi" href="#/site/' + encodeURIComponent(site.id) + '?tab=schedule">' +
        '<span class="kpi-fig">' + (p.actual === null ? '－' : p.actual) + '<span class="kpi-unit">%</span></span>' +
        '<span class="kpi-label">進捗（予定 ' + (p.planned === null ? '－' : p.planned + '%') + '）</span></a>' +
        '<a class="kpi" href="#/site/' + encodeURIComponent(site.id) + '?tab=staff">' +
        '<span class="kpi-fig">' + staff.length + '<span class="kpi-unit">名</span></span><span class="kpi-label">本日の配置</span></a>' +
        '</div>';

      html += UI.h2('ALERT', '注意すべきこと');
      if (!alerts.length) html += UI.empty('いま対応が必要なことはありません。');
      else {
        html += '<ul class="alert-list">' + alerts.map(function (a) {
          return '<li class="lv' + a.level + '"><a href="' + esc(a.href) + '"><span class="al-mark">' +
            (a.level === 2 ? '要対応' : '確認') + '</span><span class="al-body">' + esc(a.text) + '</span></a></li>';
        }).join('') + '</ul>';
      }

      html += UI.h2('TODAY', '本日の点検');
      html += '<div class="card"><table class="kv"><tbody>' + Cat.ORDER.map(function (catId) {
        var c = st.byCat[catId];
        if (!c.total) return '';
        return '<tr><th>' + esc(Cat.get(catId).name) + '</th><td>' + c.done + ' / ' + c.total + ' ' + esc(Cat.get(catId).unit) +
          (c.ng ? '　<span class="tag ng">否あり ' + c.ng + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
        (st.total ? '' : '<p class="muted">点検の対象がまだ登録されていません。「点検」タブから登録してください。</p>') + '</div>';

      html += UI.h2('STAFF', '本日の配置');
      html += staff.length ? '<div class="card"><table class="kv"><tbody>' + staff.map(function (a) {
        var person = Store.get('staff', a.staffId);
        return '<tr><th>' + esc(a.role || '') + '</th><td>' + esc(person ? person.name : '（削除された社員）') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : UI.empty('本日配置されている社員はいません。');

      if (site.note) html += UI.h2('MEMO', '社内メモ') + '<div class="card"><p>' + U.nl2br(site.note) + '</p></div>';

      html += UI.btnRow('<a class="btn plain" href="#/site/' + encodeURIComponent(site.id) + '/edit">現場情報を編集</a>');
      return html;
    }
  };

  function kv(label, value) {
    if (!value) return '';
    return '<tr><th>' + esc(label) + '</th><td>' + esc(value) + '</td></tr>';
  }

  /* ---------------- QRタブ ---------------- */
  MT.siteTabs.qr = {
    label: 'QR',
    render: function (site) {
      var sid = encodeURIComponent(site.id);
      return UI.h2('POSTER', '現場QRコード（掲示用）') +
        '<div class="card"><p>詰所や朝礼の場所に掲示するQRコードです。読み取ると、この現場の点検・資材・機械の記録画面が開きます。</p>' +
        UI.btnRow('<a class="btn" href="#/print/site-qr?site=' + sid + '">現場QRコードを印刷</a>') + '</div>' +
        UI.h2('LABELS', '貼付用QRラベル') +
        '<div class="card"><p>重機・足場などの点検対象や、資材に貼るラベルです。読み取ると、その対象の画面が直接開きます。</p>' +
        UI.btnRow(
          '<a class="btn secondary" href="#/print/labels?site=' + sid + '&kind=inspect">点検対象（重機・足場・玉掛け・地山）</a>' +
          '<a class="btn secondary" href="#/print/labels?site=' + sid + '&kind=materials">資材</a>' +
          '<a class="btn secondary" href="#/print/labels?site=' + sid + '&kind=equipment">そのほかの機械</a>') + '</div>' +
        UI.h2('KEY', 'QRコードの作り直し') +
        '<div class="card"><p class="muted">QRコードの写真が外部に出回った場合などに使います。作り直すと、<strong>この現場のこれまでのQRコードはすべて使えなくなります</strong>（印刷し直して貼り替えが必要です）。</p>' +
        UI.btnRow('<button class="btn danger" id="b-rotate">この現場のQRコードを作り直す</button>') + '</div>';
    },
    bind: function (site) {
      U.on('#b-rotate', 'click', function () {
        if (!confirm('「' + site.name + '」のQRコードを作り直します。\n今貼ってあるQRコードは、すべて使えなくなります。よろしいですか？')) return;
        var fresh = Store.get('sites', site.id);
        fresh.fieldKey = U.randomKey();
        Store.put('sites', fresh);
        U.toast('QRコードを作り直しました。印刷し直してください');
        MT.rerender();
      });
    }
  };

  /* ------------------------------------------------------------------ *
   * 現場の端末（QR）で開いたときの画面
   * ------------------------------------------------------------------ */
  function fieldSite(site) {
    var html = '<div class="site-title"><div class="st-name">' + esc(site.name) + '</div>' +
      '<div class="st-sub">' + esc(U.formatDate(U.todayStr())) + '（' + U.weekday(U.todayStr()) + '）</div></div>';

    // 朝いちばんに使うものから並べる
    if (MT.kyFieldSection) html += MT.kyFieldSection(site);

    var any = false;
    Cat.ORDER.forEach(function (catId) {
      var cat = Cat.get(catId);
      var list = M.targets(site.id, catId);
      if (!list.length) return;
      any = true;
      html += UI.h2(cat.kicker, cat.name + 'の点検');
      html += '<ul class="list">';
      list.forEach(function (t) {
        var st = M.targetToday(t, catId);
        var tags = [];
        if (st.ng) tags.push({ cls: 'ng', text: '否あり' });
        tags.push(st.done ? { cls: 'done', text: '本日点検済' } : { cls: 'none', text: '本日未点検' });
        html += '<li>' + UI.rowLink(M.targetHref(catId, t.id), {
          count: st.done ? '済' : '未', unit: 'TODAY',
          countClass: st.done ? 'done' : 'idle',
          main: t.name,
          subHtml: esc(cat.typeName(t.type)),
          tags: tags
        }) + '</li>';
      });
      html += '</ul>';
    });

    var mats = Store.list('materials', null, site.id).sort(U.byName);
    if (mats.length) {
      any = true;
      html += UI.h2('MATERIAL', '資材の搬入・使用');
      html += '<ul class="list">' + mats.map(function (mat) {
        var s = M.stock(mat);
        return '<li>' + UI.rowLink('#/material/' + encodeURIComponent(mat.id), {
          count: U.fmtNum(s.qty), unit: mat.unit || '',
          countClass: M.stockLow(mat) ? '' : 'done',
          main: mat.name,
          subHtml: esc([mat.spec, mat.place].filter(Boolean).join(' ／ ')),
          tags: M.stockLow(mat) ? [{ cls: 'warn', text: '在庫少' }] : []
        }) + '</li>';
      }).join('') + '</ul>';
    }

    var equip = Store.list('machines', function (x) { return !M.isHeavy(x); }, site.id).sort(U.byName);
    if (equip.length) {
      any = true;
      html += UI.h2('EQUIP', '機械の搬入・搬出');
      html += '<ul class="list">' + equip.map(function (mc) {
        var st = M.machineState(mc);
        return '<li>' + UI.rowLink('#/machine/' + encodeURIComponent(mc.id), {
          count: st.state === 'in' ? '在' : st.state === 'out' ? '出' : '－', unit: '',
          countClass: st.state === 'in' ? 'done' : 'idle',
          main: mc.name,
          subHtml: esc(st.label)
        }) + '</li>';
      }).join('') + '</ul>';
    }

    if (!any) html += UI.empty('この現場には、まだ記録の対象が登録されていません。事務所にご確認ください。');
    if (MT.entrantFieldSection) html += MT.entrantFieldSection(site);
    html += UI.btnRow('<a class="btn secondary" href="#/scan">■ ほかのQRを読み取る</a>');
    U.app().innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * 印刷：現場QRコード（掲示用）
   * ------------------------------------------------------------------ */
  MT.route('print/site-qr', { print: true }, function (m, params) {
    var site = Store.get('sites', params.site);
    if (!site) return MT.notFound('現場が見つかりません。');
    var url = UI.qrUrl('site', site);
    var company = (global.APP_CONFIG && global.APP_CONFIG.company) || '';
    U.app().innerHTML = UI.printBar('#/site/' + encodeURIComponent(site.id) + '?tab=qr', 'A4の用紙1枚に大きく印刷します。') +
      '<div class="print-sheet"><div class="poster">' +
      '<div class="poster-kicker">SITE QR CODE</div>' +
      '<div class="poster-title">現場QRコード</div>' +
      '<div class="poster-site">' + esc(site.name) + '</div>' +
      '<div class="poster-qr" id="poster-qr"></div>' +
      '<ol class="poster-steps"><li>スマートフォンのカメラで読み取る</li><li>点検・資材・機械の記録画面が開きます</li><li>ログインは不要です</li></ol>' +
      '<div class="poster-foot">' + esc(company) + '　／　マル点</div>' +
      '</div></div>';
    UI.drawQr(U.qs('#poster-qr'), url, 420);
    UI.bindPrint();
  });

  /* ------------------------------------------------------------------ *
   * 印刷：貼付用QRラベル
   *   kind = inspect（点検対象）/ materials / equipment / one（id と type を指定）
   * ------------------------------------------------------------------ */
  MT.route('print/labels', { print: true }, function (m, params) {
    var site = Store.get('sites', params.site);
    if (!site) return MT.notFound('現場が見つかりません。');
    var labels = [];
    var back = '#/site/' + encodeURIComponent(site.id) + '?tab=qr';

    function add(type, item, badge, sub, guide) {
      labels.push({ url: UI.qrUrl(type, site, item), title: item.name, sub: sub, badge: badge, guide: guide });
    }

    if (params.kind === 'inspect' || params.kind === 'one-target' || params.kind === 'one-machine') {
      Cat.ORDER.forEach(function (catId) {
        var cat = Cat.get(catId);
        M.targets(site.id, catId).forEach(function (t) {
          if (params.kind !== 'inspect' && t.id !== params.id) return;
          add(catId === 'heavy' ? 'm' : 'g', t, cat.name + '点検', cat.typeName(t.type) + '／' + site.name, '読み取って点検');
        });
      });
      if (params.kind !== 'inspect') back = M.targetHref(Store.get('machines', params.id) ? 'heavy' : 'x', params.id);
    }
    if (params.kind === 'materials' || params.kind === 'one-material') {
      Store.list('materials', null, site.id).sort(U.byName).forEach(function (mat) {
        if (params.kind === 'one-material' && mat.id !== params.id) return;
        add('mat', mat, '資材', [mat.spec, site.name].filter(Boolean).join('／'), '読み取って搬入・使用を記録');
      });
      if (params.kind === 'one-material') back = '#/material/' + encodeURIComponent(params.id);
    }
    if (params.kind === 'equipment' || params.kind === 'one-equipment') {
      Store.list('machines', function (x) { return !M.isHeavy(x); }, site.id).sort(U.byName).forEach(function (mc) {
        if (params.kind === 'one-equipment' && mc.id !== params.id) return;
        add('m', mc, '機械', A.nameOf(A.EQUIPMENT_TYPES, mc.type, '機械') + '／' + site.name, '読み取って搬入・搬出を記録');
      });
      if (params.kind === 'one-equipment') back = '#/machine/' + encodeURIComponent(params.id);
    }

    if (!labels.length) {
      U.app().innerHTML = UI.backLink(back, '戻る') + UI.empty('印刷するラベルがありません。');
      return;
    }
    U.app().innerHTML = UI.printBar(back, labels.length + '枚のラベルを印刷します。ラミネート等で保護し、見やすい位置に貼ってください。') +
      UI.labelsHtml(labels);
    UI.drawLabels(labels);
    UI.bindPrint();
  });
})(window);
