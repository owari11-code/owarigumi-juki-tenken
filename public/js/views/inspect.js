/*
 * views/inspect.js - 点検（重機・足場・玉掛け・地山/土留）
 *
 *   ・現場の「点検」タブ
 *   ・点検対象（足場・玉掛け・地山/土留）の登録と画面   ※重機は machines.js
 *   ・点検フォーム（4種類共通）
 *   ・点検記録の画面（元請の確認・足場の是正）
 *   ・帳票：月間点検表（重機・玉掛け・地山/土留）、足場点検表（1回1枚）
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
  var esc = U.esc;

  var APPROVAL_ROLES = [
    { key: 'manager', name: '現場代理人' },
    { key: 'engineer', name: '主任技術者' }
  ];

  function remember(key, v) { try { localStorage.setItem('maruten-last-' + key, v); } catch (e) { /* 無視 */ } }
  function recall(key) { try { return localStorage.getItem('maruten-last-' + key) || ''; } catch (e) { return ''; } }

  function kindOf(catId) { return catId === 'heavy' ? 'machine' : 'target'; }

  function judgementTag(rec) {
    var open = M.openFixes(rec);
    if (rec.judgement === 'ng') return open ? { cls: 'ng', text: '否あり（要是正）' } : { cls: rec.category === 'scaffold' ? 'ok' : 'ng', text: rec.category === 'scaffold' ? '是正済' : '要整備・要対応' };
    if (rec.judgement === 'fix') return open ? { cls: 'ng', text: '即時改善' } : { cls: 'ok', text: '改善済' };
    return { cls: 'ok', text: '良' };
  }

  function judgementText(rec) {
    if (rec.category === 'scaffold') {
      if (rec.judgement === 'ng') return '否あり（要是正）';
      if (rec.judgement === 'fix') return '即時改善あり';
      return '良（異常なし）';
    }
    return rec.judgement === 'ng' ? '要対応（不具合あり）' : '良（異常なし）';
  }

  /* ------------------------------------------------------------------ *
   * 現場の「点検」タブ
   * ------------------------------------------------------------------ */
  MT.siteTabs.inspect = {
    label: '点検',
    badge: function (site) {
      var st = M.siteToday(site.id);
      return st.total ? st.done + '/' + st.total : '';
    },
    render: function (site) {
      var sid = encodeURIComponent(site.id);
      var html = '';
      Cat.ORDER.forEach(function (catId) {
        var cat = Cat.get(catId);
        var list = M.targets(site.id, catId);
        var done = list.filter(function (t) { return M.targetToday(t, catId).done; }).length;
        html += UI.h2(cat.kicker, cat.name + '（' + list.length + cat.unit + '）',
          list.length ? '<span class="muted">本日 ' + done + '/' + list.length + '</span>' : '');
        if (list.length) {
          html += '<ul class="list">';
          list.forEach(function (t) {
            var st = M.targetToday(t, catId);
            var recs = M.inspections({ siteId: site.id, targetId: t.id });
            var last = recs.length ? recs[recs.length - 1] : null;
            var tags = [];
            if (st.ng) tags.push({ cls: 'ng', text: '否あり' });
            tags.push(st.done ? { cls: 'done', text: '本日点検済' } : { cls: 'none', text: '本日未点検' });
            if (catId === 'scaffold') {
              var open = recs.reduce(function (n, r) { return n + M.openFixes(r); }, 0);
              if (open) tags.push({ cls: 'ng', text: '要是正 ' + open });
            }
            if (catId === 'excavation') {
              var age = M.shoringAge(t);
              if (age && age.days > 7) tags.push({ cls: 'ng', text: '土止め点検 超過' });
            }
            html += '<li>' + UI.rowLink(M.targetHref(catId, t.id), {
              count: st.done ? '済' : '未', unit: 'TODAY',
              countClass: st.done ? 'done' : (st.ng ? '' : 'idle'),
              main: t.name,
              subHtml: esc(cat.typeName(t.type)) + '<br>' +
                (last ? '最終点検 ' + esc(U.formatDate(last.date)) : '点検記録なし'),
              tags: tags
            }) + '</li>';
          });
          html += '</ul>';
        }
        var addHref = catId === 'heavy'
          ? '#/machine/new?site=' + sid + '&cat=heavy'
          : '#/target/new?site=' + sid + '&cat=' + catId;
        html += UI.btnRow('<a class="btn small secondary" href="' + addHref + '">＋ ' + esc(cat.name) + 'を登録</a>' +
          (list.length ? '<a class="btn small plain" href="#/records?site=' + sid + '&cat=' + catId + '">記録・帳票</a>' : ''));
      });
      html += UI.btnRow('<a class="btn secondary" href="#/print/labels?site=' + sid + '&kind=inspect">点検対象のQRラベルを印刷</a>');
      return html;
    }
  };

  /* ------------------------------------------------------------------ *
   * 点検対象（足場・玉掛け・地山/土留）の登録
   * ------------------------------------------------------------------ */
  function targetForm(target, siteId, catId) {
    var isNew = !target;
    var cat = Cat.get(isNew ? catId : target.category);
    if (!cat || cat.id === 'heavy') return MT.notFound('点検の種類が正しくありません。');
    target = target || { siteId: siteId, category: cat.id, type: cat.types[0].id };
    var site = Store.get('sites', target.siteId);
    if (!site) return MT.notFound('現場が見つかりません。');
    var back = isNew ? '#/site/' + encodeURIComponent(site.id) + '?tab=inspect' : '#/target/' + encodeURIComponent(target.id);

    var placeholder = { scaffold: '例：北側 外部足場（1〜3層）', rigging: '例：25tラフター（鉄筋荷揚げ）', excavation: '例：No.12〜No.15 床掘り' }[cat.id];
    U.app().innerHTML =
      UI.backLink(back, '戻る') +
      UI.pageHead(cat.kicker, cat.name + (isNew ? 'の登録' : 'の編集')) +
      '<div class="card">' +
      UI.field('呼び名', UI.text('f-name', target.name, placeholder), true, 'QRラベルと帳票に表示されます') +
      UI.field('種類', UI.select('f-type', cat.types.map(function (t) { return [t.id, t.name]; }), target.type), true) +
      UI.field('設置場所・範囲', UI.text('f-place', target.place, '例：本体工 左岸側')) +
      (cat.id === 'scaffold' ? UI.field('組立業者', UI.text('f-builder', target.builder)) : '') +
      UI.field('備考', UI.textarea('f-note', target.note)) +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="' + esc(back) + '">キャンセル</a>') +
      (isNew ? '' : UI.btnRow('<button class="btn danger" id="b-del">この' + esc(cat.name) + 'を削除</button>') +
        '<p class="muted">削除すると、この対象の点検記録もすべて削除されます。</p>');

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name');
      if (!name) { U.toast('呼び名を入力してください'); return U.qs('#f-name').focus(); }
      target.name = name;
      target.type = U.val('#f-type');
      target.place = U.val('#f-place');
      if (cat.id === 'scaffold') target.builder = U.val('#f-builder');
      target.note = U.val('#f-note');
      Store.put('targets', target);
      U.toast('保存しました');
      U.go('#/target/' + encodeURIComponent(target.id));
    });
    U.on('#b-del', 'click', function () {
      if (!confirm('「' + target.name + '」と、その点検記録をすべて削除します。よろしいですか？')) return;
      M.inspections({ siteId: target.siteId, targetId: target.id }).forEach(function (r) { Store.remove('inspections', r.id); });
      Store.remove('targets', target.id);
      U.toast('削除しました');
      U.go('#/site/' + encodeURIComponent(target.siteId) + '?tab=inspect');
    });
  }

  MT.route('target/new', { form: true }, function (m, params) { targetForm(null, params.site, params.cat); });
  MT.route('target/([^/]+)/edit', { form: true }, function (m) {
    var t = Store.get('targets', m[0]);
    if (!t) return MT.notFound('点検対象が見つかりません。');
    targetForm(t);
  });

  /* ------------------------------------------------------------------ *
   * 点検対象の画面（重機の画面からも使う）
   * ------------------------------------------------------------------ */
  MT.inspectPanelHtml = function (target, catId) {
    var cat = Cat.get(catId);
    var kind = kindOf(catId);
    var html = '';
    var phases = cat.phasesFor(target.type);
    var st = M.targetToday(target, catId);

    html += st.ng ? UI.alert('error', '<strong>本日の点検で「否」があります。</strong>整備・措置が済むまで使用しないでください。')
      : st.done ? UI.alert('info', '本日の' + esc(Cat.phase(cat, cat.dailyPhase, target.type).name) + 'は記録済みです。')
      : '';

    if (catId === 'excavation') {
      var age = M.shoringAge(target);
      if (age) {
        html += age.days > 7
          ? UI.alert('error', '<strong>土止め支保工の点検が' + (age.last ? age.days + '日行われていません' : 'まだ一度も行われていません') + '。</strong>7日を超えない期間ごとに点検してください。')
          : UI.alert('info', '土止め支保工の前回点検：' + esc(U.formatDate(age.last)) + '（' + age.days + '日前）');
      }
    }

    phases.forEach(function (ph, i) {
      html += '<div class="btn-row"><a class="btn ' + (i === 0 ? 'lead' : 'secondary') + ' phase-btn" href="#/inspect/' + kind + '/' +
        encodeURIComponent(target.id) + '?phase=' + ph.id + '">' +
        '<span class="pb-name">' + esc(ph.name) + 'を行う</span>' +
        (ph.sub ? '<span class="pb-sub">' + esc(ph.sub) + '</span>' : '') + '</a></div>';
    });

    var recs = M.inspections({ siteId: target.siteId, targetId: target.id }).reverse();
    html += UI.h2('RECORDS', '点検記録（' + recs.length + '件）');
    if (!recs.length) html += UI.empty('まだ点検記録がありません。');
    else {
      html += '<ul class="list">' + recs.slice(0, 8).map(function (r) {
        var tags = [judgementTag(r)];
        if (r.approvals && r.approvals.manager) tags.push({ cls: 'done', text: '元請確認済' });
        return '<li>' + UI.rowLink('#/record/' + encodeURIComponent(r.id), {
          count: Number((r.date || '').slice(8)) || '', unit: (Number((r.date || '').slice(5, 7)) || '') + '月',
          countClass: r.judgement === 'ok' ? 'done' : '',
          main: U.formatDate(r.date) + ' ' + (r.time || ''),
          subHtml: esc(Cat.phase(cat, r.phase, target.type).name) + '　点検者：' + esc(r.inspector || '－'),
          tags: tags
        }) + '</li>';
      }).join('') + '</ul>';
      if (Session.isAdmin()) {
        html += UI.btnRow('<a class="btn secondary" href="#/records?site=' + encodeURIComponent(target.siteId) +
          '&target=' + encodeURIComponent(target.id) + '">すべての記録・帳票</a>');
      }
    }
    return html;
  };

  MT.route('target/([^/]+)', { access: 'field' }, function (m) {
    var target = Store.get('targets', m[0]);
    if (!target) {
      if (MT.sync.status().running) return MT.loading();
      return MT.notFound('点検対象が見つかりません。');
    }
    if (!MT.requireSiteAccess(target.siteId)) return;
    var cat = Cat.of(target);
    var site = Store.get('sites', target.siteId) || {};
    var admin = Session.isAdmin();

    var html = UI.backLink('#/site/' + encodeURIComponent(target.siteId) + (admin ? '?tab=inspect' : ''), '現場へ戻る') +
      UI.pageHead(cat.kicker, target.name) +
      '<div class="card blueprint">' + UI.corners() +
      '<div class="meta-lines">' + esc(site.name || '') + '<br>' +
      esc([cat.name, cat.typeName(target.type), target.place, target.builder ? '組立：' + target.builder : ''].filter(Boolean).join('　／　')) +
      '</div></div>';

    html += MT.inspectPanelHtml(target, cat.id);

    if (admin) {
      var url = UI.qrUrl('g', site, target);
      html += UI.h2('QR', 'この' + cat.name + 'のQRコード') +
        '<div class="card qr-box"><div id="qr"></div><div class="qr-url">読み取ると、この画面が開きます（ログイン不要）</div></div>' +
        UI.btnRow('<a class="btn secondary" href="#/print/labels?site=' + encodeURIComponent(site.id) + '&kind=one-target&id=' + encodeURIComponent(target.id) + '">QRラベルを印刷</a>' +
          '<a class="btn plain" href="#/target/' + encodeURIComponent(target.id) + '/edit">登録内容を編集</a>');
      U.app().innerHTML = html;
      UI.drawQr(U.qs('#qr'), url, 220);
      return;
    }
    U.app().innerHTML = html;
  });

  /* ------------------------------------------------------------------ *
   * 点検フォーム
   * ------------------------------------------------------------------ */
  function choiceHtml(itemId, r) {
    return '<label><input type="radio" name="i_' + esc(itemId) + '" value="' + esc(r.id) + '">' +
      '<span class="' + r.cls + '"><span class="mk">' + esc(r.mark) + '</span><span class="lb">' + esc(r.label) + '</span></span></label>';
  }

  MT.route('inspect/(machine|target)/([^/]+)', { access: 'field', form: true }, function (m, params) {
    var kind = m[0] === 'machine' ? 'machines' : 'targets';
    var target = Store.get(kind, m[1]);
    if (!target) return MT.notFound('点検対象が見つかりません。');
    if (!MT.requireSiteAccess(target.siteId)) return;
    var site = Store.get('sites', target.siteId);
    if (!site) return MT.notFound('現場が見つかりません。');
    var cat = kind === 'machines' ? Cat.get('heavy') : Cat.of(target);
    var phases = cat.phasesFor(target.type);
    var phase = Cat.phase(cat, params.phase, target.type);
    var sections = cat.sectionsFor(phase.id, target.type);
    if (!sections.length) return MT.notFound('この点検の項目が見つかりません。');
    var isScaffold = cat.id === 'scaffold';
    var isPrime = isScaffold && phase.id === 'prime';
    var fourChoices = cat.results.length === 4;
    var backHref = (kind === 'machines' ? '#/machine/' : '#/target/') + encodeURIComponent(target.id);

    var html = UI.backLink(backHref, '戻る') +
      UI.pageHead(phase.kicker || cat.kicker, phase.name) +
      '<div class="insp-head"><div class="m-name">' + esc(target.name) + '</div>' +
      '<div class="m-sub">' + esc(cat.typeName(target.type)) + (target.serial ? '／機番 ' + esc(target.serial) : '') +
      (target.place ? '／' + esc(target.place) : '') + '</div>' +
      '<div class="m-sub">' + esc(site.name) + '</div></div>';

    var totalItems = sections.reduce(function (n, s) { return n + s.items.length; }, 0);
    html += '<div class="progress-bar">' +
      '<div class="figure"><span id="p-done">0</span><span class="of">/' + totalItems + '</span></div>' +
      '<div class="meter"><div class="track"><div class="fill" id="p-fill"></div></div>' +
      '<div class="left" id="p-left">残り ' + totalItems + ' 項目</div></div>' +
      '<button class="btn secondary small" id="b-allok" style="flex:none">全て良</button></div>';

    html += '<div class="card">' +
      '<div class="field-row">' +
      UI.field('点検日', UI.date('f-date', U.todayStr()), true) +
      UI.field('時刻', '<input type="time" id="f-time" value="' + U.nowTimeStr() + '">') +
      '</div>';

    if (phase.timings || isPrime) {
      var timings = isPrime ? cat.timings : phase.timings;
      html += '<label class="field"><span>点検の時期<span class="required">必須</span></span></label>' +
        '<div class="chips" id="timings">' + timings.map(function (t, i) {
          return '<label><input type="checkbox" data-timing value="' + esc(t) + '"' + (!isPrime && i === 0 ? ' checked' : '') + '><span>' + esc(t) + '</span></label>';
        }).join('') + '</div><div class="gap"></div>';
      if (isPrime) html += UI.field('その他の内容', UI.text('f-timingother', '', '「その他」を選んだ場合に記入'));
    }

    if (cat.id !== 'heavy') {
      html += UI.field('会社名（事業者）', UI.text('f-company', recall('company')), isScaffold);
    }
    html += UI.field(cat.id === 'excavation' ? '点検者氏名（指名された点検者）' : '点検者氏名', UI.text('f-inspector', recall('inspector')), true);

    if (isPrime) {
      html += '<label class="field"><span>点検者の区分</span></label><div class="chips">' +
        cat.inspectorKinds.map(function (k, i) {
          return '<label><input type="radio" name="ikind" value="' + esc(k) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(k) + '</span></label>';
        }).join('') + '</div><div class="gap"></div>' +
        '<label class="field"><span>点検資格（当てはまるもの）</span></label><div class="chips wrapy">' +
        cat.qualifications.map(function (q, i) {
          return '<label><input type="checkbox" data-qual="' + i + '"><span>' + '①②③④'.charAt(i) + '　' + esc(q) + '</span></label>';
        }).join('') + '</div>';
    }
    html += '</div>';

    var no = 0;
    sections.forEach(function (sec, si) {
      html += UI.h2(String.fromCharCode(65 + si), sec.title);
      if (sec.note) html += '<p class="section-note">' + esc(sec.note) + '</p>';
      html += '<div class="card">';
      sec.items.forEach(function (it) {
        no++;
        html += '<div class="check-item" data-item="' + esc(it.id) + '">' +
          '<div class="head"><span class="no">' + no + '</span><div class="label">' + esc(it.label) +
          (it.hint ? '<span class="hint">※' + esc(it.hint) + '</span>' : '') + '</div></div>' +
          '<div class="choices' + (fourChoices ? ' four' : ' three') + '">' + cat.results.map(function (r) { return choiceHtml(it.id, r); }).join('') + '</div>' +
          (isScaffold ?
            '<div class="fix-box" data-fix="' + esc(it.id) + '" hidden>' +
            '<div class="fix-label">是正の記入（状況及び不良箇所を明記）</div>' +
            '<input type="text" data-fixnote="' + esc(it.id) + '" placeholder="是正内容・不良箇所">' +
            '<div class="field-row">' +
            UI.field('是正日', '<input type="date" data-fixdate="' + esc(it.id) + '">') +
            UI.field('確認者', '<input type="text" data-fixwho="' + esc(it.id) + '">') +
            '</div></div>' : '') +
          '</div>';
      });
      html += '</div>';
    });

    html += UI.h2('NOTES', isScaffold ? '備考' : '不具合・措置') + '<div class="card">' +
      (isScaffold
        ? UI.field('特記事項・連絡事項', UI.textarea('f-note', '', '例：№15付近の壁つなぎを増し締めした'))
        : UI.field('不具合の内容', UI.textarea('f-ngnote', '', '「否」があった場合に記入')) +
          UI.field('措置・連絡事項', UI.textarea('f-action', '', '例：補給した／整備会社へ連絡した'))) +
      '</div>';

    html += '<div class="sticky-actions"><button class="btn submit wait" id="b-save">未選択 ' + totalItems + ' 項目</button></div>' +
      '<p class="muted">※「全て良」は入力の補助です。必ず現物を確認してください。</p>';

    U.app().innerHTML = html;

    function refresh() {
      var items = U.qsa('.check-item');
      var done = 0, bad = 0;
      items.forEach(function (el) {
        var sel = el.querySelector('input[type="radio"]:checked');
        var box = el.querySelector('.fix-box');
        if (!sel) { if (box) box.hidden = true; return; }
        done++;
        var needFix = sel.value === 'ng' || sel.value === 'fix';
        if (needFix) bad++;
        if (box) box.hidden = !needFix;
      });
      var total = items.length;
      U.qs('#p-done').textContent = done;
      U.qs('#p-fill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
      U.qs('#p-left').innerHTML = done < total
        ? '残り ' + (total - done) + ' 項目' + (bad ? '　／　<span class="ng">否 ' + bad + ' 件</span>' : '')
        : (bad ? '<span class="ng">否・要是正 ' + bad + ' 件</span>' : 'すべて選択済み');
      var btn = U.qs('#b-save');
      btn.className = 'btn submit' + (done < total ? ' wait' : (bad ? ' ng' : ''));
      btn.textContent = done < total ? '未選択 ' + (total - done) + ' 項目'
        : (bad ? '否ありとして記録する（' + bad + ' 件）' : '点検を記録する');
    }

    U.app().addEventListener('change', function (ev) {
      if (ev.target && ev.target.type === 'radio' && ev.target.name && ev.target.name.indexOf('i_') === 0) refresh();
    });
    U.on('#b-allok', 'click', function () {
      U.qsa('.check-item input[type="radio"][value="ok"]').forEach(function (b) { b.checked = true; });
      refresh();
      U.toast('すべて「良」を選択しました');
    });
    refresh();

    U.on('#b-save', 'click', function () {
      var date = U.val('#f-date');
      var inspector = U.val('#f-inspector');
      var company = U.val('#f-company');
      if (!U.isDate(date)) return U.toast('点検日を入力してください');
      if (!inspector) { U.toast('点検者氏名を入力してください'); return U.qs('#f-inspector').focus(); }
      if (isScaffold && !company) { U.toast('会社名（事業者）を入力してください'); return U.qs('#f-company').focus(); }

      var timings = U.qsa('[data-timing]:checked').map(function (el) { return el.value; });
      if ((phase.timings || isPrime) && !timings.length) return U.toast('点検の時期を選んでください');

      var results = {}, fixes = {}, missing = null;
      U.qsa('.check-item').forEach(function (el) {
        var id = el.getAttribute('data-item');
        var sel = el.querySelector('input[type="radio"]:checked');
        if (!sel) { if (!missing) missing = el; return; }
        results[id] = sel.value;
        if (isScaffold && (sel.value === 'ng' || sel.value === 'fix')) {
          fixes[id] = {
            note: (el.querySelector('[data-fixnote]') || {}).value || '',
            date: (el.querySelector('[data-fixdate]') || {}).value || '',
            checker: (el.querySelector('[data-fixwho]') || {}).value || ''
          };
        }
      });
      if (missing) {
        missing.scrollIntoView({ block: 'center' });
        missing.classList.add('missing');
        return U.toast('未選択の項目があります');
      }

      var vals = Object.keys(results).map(function (k) { return results[k]; });
      var rec = {
        category: cat.id,
        siteId: site.id,
        targetId: target.id,
        siteName: site.name,
        siteContractNo: site.contractNo || '',
        targetName: target.name,
        targetType: target.type || '',
        place: target.place || '',
        phase: phase.id,
        date: date,
        time: U.val('#f-time'),
        inspector: inspector,
        results: results,
        judgement: vals.indexOf('ng') >= 0 ? 'ng' : (vals.indexOf('fix') >= 0 ? 'fix' : 'ok')
      };
      if (cat.id === 'heavy') {
        // 以前の重機アプリの記録と同じ項目も入れておく
        rec.machineId = target.id;
        rec.machineName = target.name;
        rec.machineType = target.type;
        rec.serial = target.serial || '';
      }
      if (cat.id !== 'heavy') rec.company = company;
      if (timings.length) rec.timings = timings;
      if (isPrime) {
        rec.timingOther = U.val('#f-timingother');
        rec.inspectorKind = (U.qs('[name="ikind"]:checked') || {}).value || '';
        rec.quals = U.qsa('[data-qual]:checked').map(function (el) { return Number(el.getAttribute('data-qual')); });
      }
      if (isScaffold) {
        rec.fixes = fixes;
        rec.note = U.val('#f-note');
      } else {
        rec.ngNote = U.val('#f-ngnote');
        rec.action = U.val('#f-action');
      }
      Store.put('inspections', rec);
      remember('inspector', inspector);
      if (company) remember('company', company);
      U.toast(rec.judgement === 'ok' ? '記録しました' : '記録しました（否あり）');
      U.go('#/record/' + encodeURIComponent(rec.id));
    });

    // 足場：区分の選び直し（使業者／元請）を案内
    if (phases.length > 1 && !params.phase) U.toast(phase.name + 'の画面です');
  });

  /* ------------------------------------------------------------------ *
   * 記録の表示（帳票と同じ並び）
   * ------------------------------------------------------------------ */
  function resultCell(cat, v) {
    var r = Cat.result(cat, v);
    if (!r) return '－';
    return v === 'ng' ? '<strong class="ng-text">' + esc(r.mark + ' ' + r.label) + '</strong>' : esc(r.mark + ' ' + r.label);
  }

  /** 重機・玉掛け・地山の1回分（画面表示用） */
  function dailyDocHtml(rec, target) {
    var cat = Cat.of(rec);
    var type = rec.targetType || rec.machineType || (target && target.type);
    var sections = cat.sectionsFor(rec.phase, type);
    var html = '<div class="record-doc card">' +
      '<div class="doc-head"><div><div class="doc-title">' + esc(cat.name) + '　点検記録</div>' +
      '<div class="doc-sub">' + esc(Cat.phase(cat, rec.phase, type).name) + '</div></div>' + approvalBoxHtml(rec) + '</div>' +
      '<table class="meta"><tbody>' +
      '<tr><th>工事名</th><td colspan="3">' + esc(rec.siteName || '') + (rec.siteContractNo ? '（工事番号：' + esc(rec.siteContractNo) + '）' : '') + '</td></tr>' +
      '<tr><th>対象</th><td>' + esc(rec.targetName || rec.machineName || (target && target.name) || '') + '</td>' +
      '<th>種類</th><td>' + esc(cat.typeName(type)) + '</td></tr>' +
      '<tr><th>点検日時</th><td>' + esc(U.formatDate(rec.date) + ' ' + (rec.time || '')) + '</td>' +
      '<th>点検者</th><td>' + esc([rec.company, rec.inspector].filter(Boolean).join('　')) + '</td></tr>' +
      (rec.timings && rec.timings.length ? '<tr><th>時期</th><td colspan="3">' + esc(rec.timings.join('・')) + '</td></tr>' : '') +
      '<tr><th>判定</th><td colspan="3">' + esc(judgementText(rec)) + '</td></tr>' +
      '</tbody></table>';
    sections.forEach(function (sec) {
      html += '<h3>' + esc(sec.title) + '</h3><div class="table-scroll"><table class="data items"><tbody>' +
        sec.items.map(function (it) {
          return '<tr><td class="i-label">' + esc(it.label) + '</td><td class="i-res">' + resultCell(cat, (rec.results || {})[it.id]) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    });
    html += '<h3>不具合の内容</h3><div class="note-box">' + (rec.ngNote ? U.nl2br(rec.ngNote) : '－') + '</div>' +
      '<h3>措置・連絡事項</h3><div class="note-box">' + (rec.action ? U.nl2br(rec.action) : '－') + '</div>';
    return html + '</div>';
  }

  /** 足場点検表（1回＝A4・1枚）。社内様式と同じ並び */
  function scaffoldDocHtml(rec, target, compact) {
    var cat = Cat.get('scaffold');
    var type = rec.targetType || (target && target.type);
    var sections = cat.sectionsFor(rec.phase, type);
    var phase = Cat.phase(cat, rec.phase, type);
    var timing = (rec.timings || []).join('　□ ');
    if (timing) timing = '□ ' + timing;
    if (rec.timingOther) timing += '（' + rec.timingOther + '）';
    var quals = (rec.quals || []).map(function (i) { return '①②③④'.charAt(i) + ' ' + cat.qualifications[i]; });
    var open = M.openFixes(rec);

    var html = '<div class="sheet-doc card' + (compact ? ' compact' : '') + '">' +
      '<div class="doc-head"><div><div class="doc-title">' + esc(cat.typeName(type)) + '　点検チェックリスト</div>' +
      '<div class="doc-sub">' + esc(phase.name) + '　／　点検日 ' + esc(U.formatDate(rec.date)) + ' ' + esc(rec.time || '') + '</div></div>' +
      approvalBoxHtml(rec) + '</div>' +
      '<table class="meta"><tbody>' +
      '<tr><th>工事名</th><td colspan="3">' + esc(rec.siteName || '') + (rec.siteContractNo ? '（工事番号：' + esc(rec.siteContractNo) + '）' : '') + '</td></tr>' +
      '<tr><th>足場</th><td>' + esc(rec.targetName || (target && target.name) || '') + '</td><th>種類</th><td>' + esc(cat.typeName(type)) + '</td></tr>' +
      '<tr><th>設置場所</th><td>' + esc(rec.place || (target && target.place) || '－') + '</td><th>組立業者</th><td>' + esc((target && target.builder) || '－') + '</td></tr>' +
      '<tr><th>点検時期</th><td colspan="3">' + esc(timing || '作業開始前') + '</td></tr>' +
      '<tr><th>点検者職氏名</th><td colspan="3">事業者：' + esc(rec.company || '－') + '　／　氏名：' + esc(rec.inspector || '－') +
      (rec.inspectorKind ? '　／　□ ' + esc(rec.inspectorKind) : '') + '</td></tr>' +
      (rec.phase === 'prime' ? '<tr><th>点検資格</th><td colspan="3">' + (quals.length ? esc(quals.join('　')) : '－') + '</td></tr>' : '') +
      '<tr><th>判定</th><td colspan="3">' + esc(judgementText(rec)) + (open ? '　／　未是正 ' + open + ' 件' : '') + '</td></tr>' +
      '</tbody></table>' +
      '<p class="legend">点検結果は、良：○　即時改善：△　否：×　該当なし：／　／　是正内容は状況及び不良箇所を明記</p>' +
      '<div class="table-scroll"><table class="sheet-grid">' +
      '<colgroup><col class="c-cat"><col style="width:5%"><col><col style="width:7%"><col style="width:24%"><col style="width:9%"><col style="width:10%"></colgroup>' +
      '<thead><tr><th>点検項目</th><th>№</th><th>点　検　内　容</th><th>良否</th><th>是正内容</th><th>是正日</th><th>確認者</th></tr></thead><tbody>';
    sections.forEach(function (sec) {
      sec.items.forEach(function (it, i) {
        var v = (rec.results || {})[it.id];
        var f = (rec.fixes || {})[it.id] || {};
        var r = Cat.result(cat, v);
        html += '<tr>' + (i === 0 ? '<td class="g-cat" rowspan="' + sec.items.length + '">' + esc(sec.title) + '</td>' : '') +
          '<td class="g-no">' + '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'.charAt(i) + '</td>' +
          '<td class="g-item">' + esc(it.label) + '</td>' +
          '<td class="g-res' + (v === 'ng' ? ' ng' : '') + '">' + esc(r ? r.mark : '') + '</td>' +
          '<td class="g-fix">' + esc(f.note || '') + '</td>' +
          '<td class="g-day">' + esc(f.date ? U.formatShort(f.date) : '') + '</td>' +
          '<td class="g-who">' + esc(f.checker || '') + '</td></tr>';
      });
    });
    html += '</tbody></table></div>' +
      '<div class="foot"><div class="notes"><strong>備考</strong>　' + (rec.note ? U.nl2br(rec.note) : '－') + '</div></div></div>';
    return html;
  }

  function approvalBoxHtml(rec) {
    return '<table class="approval"><thead><tr>' +
      APPROVAL_ROLES.map(function (r) { return '<th>' + esc(r.name) + '</th>'; }).join('') +
      '</tr></thead><tbody><tr>' + APPROVAL_ROLES.map(function (role) {
        var a = rec.approvals && rec.approvals[role.key];
        return '<td>' + (a ? '<span class="ap-name">' + esc(a.name) + '</span><span class="ap-date">' + esc(U.formatStamp(a.at).date) + '</span>' : '') + '</td>';
      }).join('') + '</tr></tbody></table>';
  }

  /* ------------------------------------------------------------------ *
   * 点検記録の画面
   * ------------------------------------------------------------------ */
  MT.route('record/([^/]+)', { access: 'field' }, function (m) {
    var rec = Store.get('inspections', m[0]);
    if (!rec) return MT.notFound('点検記録が見つかりません。');
    if (!MT.requireSiteAccess(rec.siteId)) return;
    var cat = Cat.of(rec);
    var target = M.targetOf(rec);
    var admin = Session.isAdmin();
    var backHref = M.targetHref(cat.id, M.targetIdOf(rec));
    var open = M.openFixes(rec);

    var html = UI.backLink(backHref, '戻る') + UI.pageHead('RECORD', U.formatDate(rec.date) + ' ' + (rec.time || ''));
    if (rec._rejected) html += UI.alert('error', '<strong>この記録はサーバーに受け付けられませんでした</strong>（' + esc(rec._rejected) + '）。事務所にご連絡ください。');
    else if (rec._dirty) html += UI.alert('warn', 'この記録はまだ送信されていません。電波の届く場所で画面を開くと、自動で送信されます。');

    if (rec.judgement === 'ok') html += UI.alert('info', '異常なし（すべて良／該当なし）');
    else if (cat.id === 'scaffold') {
      html += open ? UI.alert('error', '<strong>是正が済んでいない項目が ' + open + ' 件あります。</strong>是正が済むまで足場を使用しないでください。下の「是正の記入」で是正日を入れると是正済になります。')
        : UI.alert('info', '指摘のあった項目は、すべて是正が記入されています。');
    } else {
      html += UI.alert('error', '<strong>「否」の項目があります。</strong>整備・措置が済むまで使用しないでください。');
    }

    html += cat.id === 'scaffold' ? scaffoldDocHtml(rec, target, false) : dailyDocHtml(rec, target);

    if (cat.id === 'scaffold') html += fixFormHtml(rec, cat);
    if (admin) html += approvalFormHtml(rec);

    if (admin) {
      var ym = (rec.date || '').slice(0, 7);
      html += UI.btnRow(cat.sheet === 'monthly'
        ? '<a class="btn" href="#/print/month?target=' + encodeURIComponent(M.targetIdOf(rec)) + '&cat=' + cat.id + '&ym=' + ym + '">この月の点検表を印刷</a>'
        : '<a class="btn" href="#/print/sheet?record=' + encodeURIComponent(rec.id) + '">この点検表を印刷</a>') +
        UI.btnRow('<button class="btn danger" id="b-del">この記録を削除</button>');
    }

    U.app().innerHTML = html;

    if (cat.id === 'scaffold') bindFixForm(rec, cat);
    if (admin) {
      bindApprovals(rec);
      U.on('#b-del', 'click', function () {
        if (!confirm('この点検記録を削除します。よろしいですか？')) return;
        Store.remove('inspections', rec.id);
        U.toast('削除しました');
        U.go(backHref);
      });
    }
  });

  function badItems(rec) {
    var r = rec.results || {};
    return Object.keys(r).filter(function (k) { return r[k] === 'ng' || r[k] === 'fix'; });
  }

  function fixFormHtml(rec, cat) {
    var bad = badItems(rec);
    if (!bad.length) return '';
    return UI.h2('FIX', '是正の記入') +
      '<p class="section-note">「否」「即時改善」の項目です。是正が済んだら、内容・是正日・確認者を入れてください。</p>' +
      '<div class="card">' + bad.map(function (id) {
        var f = (rec.fixes && rec.fixes[id]) || {};
        var r = Cat.result(cat, rec.results[id]);
        return '<div class="check-item"><div class="head"><span class="no">' + esc(r ? r.mark : '') + '</span>' +
          '<div class="label">' + esc(cat.itemLabel(id)) + '</div></div>' +
          '<input type="text" data-fixnote="' + esc(id) + '" value="' + esc(f.note || '') + '" placeholder="是正内容・不良箇所">' +
          '<div class="field-row">' +
          UI.field('是正日', '<input type="date" data-fixdate="' + esc(id) + '" value="' + esc(f.date || '') + '">') +
          UI.field('確認者', '<input type="text" data-fixwho="' + esc(id) + '" value="' + esc(f.checker || '') + '">') +
          '</div></div>';
      }).join('') + UI.btnRow('<button class="btn" id="b-fixsave">是正の内容を保存</button>') + '</div>';
  }

  function bindFixForm(rec) {
    U.on('#b-fixsave', 'click', function () {
      var fresh = Store.get('inspections', rec.id);
      if (!fresh) return U.toast('この記録は削除されています');
      fresh.fixes = fresh.fixes || {};
      badItems(fresh).forEach(function (id) {
        fresh.fixes[id] = {
          note: (U.qs('[data-fixnote="' + id + '"]') || {}).value || '',
          date: (U.qs('[data-fixdate="' + id + '"]') || {}).value || '',
          checker: (U.qs('[data-fixwho="' + id + '"]') || {}).value || ''
        };
      });
      Store.put('inspections', fresh);
      U.toast('保存しました');
      MT.rerender();
    });
  }

  /* 元請の確認（ログイン中の本人の名前で付く） */
  function approvalFormHtml(rec) {
    var user = Session.user;
    var site = Store.get('sites', rec.siteId) || {};
    var html = UI.h2('APPROVAL', '元請の確認') +
      '<p class="section-note">確認すると、ログイン中のあなたの名前（' + esc(user.name) + '）と日時が記録され、帳票に反映されます。' +
      '紙に押印する場合は、確認しなくても構いません。</p><div class="card">';
    APPROVAL_ROLES.forEach(function (role) {
      var a = rec.approvals && rec.approvals[role.key];
      var registered = role.key === 'manager' ? site.manager : site.engineer;
      html += '<div class="approve-row"><div class="approve-role">' + esc(role.name) + '</div>';
      if (a) {
        var st = U.formatStamp(a.at);
        var canUndo = Session.isManager() || a.userId === user.id;
        html += '<div class="approve-done"><span class="badge ok">確認済</span> ' + esc(a.name) +
          '<span class="muted">（' + esc(st.date + ' ' + st.time) + '）</span></div>' +
          (canUndo ? '<button class="btn small plain" data-unapprove="' + role.key + '">取消</button>' : '');
      } else {
        html += '<div class="approve-done muted">' + (registered ? '登録：' + esc(registered) : '未確認') + '</div>' +
          '<button class="btn small" data-approve="' + role.key + '">' + esc(user.name) + ' として確認</button>';
      }
      html += '</div>';
    });
    return html + '</div>';
  }

  function bindApprovals(rec) {
    U.qsa('[data-approve]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-approve');
        var role = APPROVAL_ROLES.filter(function (r) { return r.key === key; })[0];
        var site = Store.get('sites', rec.siteId) || {};
        var registered = key === 'manager' ? site.manager : site.engineer;
        var user = Session.user;
        if (registered && registered.replace(/\s/g, '') !== user.name.replace(/\s/g, '') &&
            !confirm('この現場の' + role.name + 'は「' + registered + '」さんで登録されています。\n' + user.name + ' さんの名前で確認しますか？')) return;
        var fresh = Store.get('inspections', rec.id);
        if (!fresh) return U.toast('この記録は削除されています');
        fresh.approvals = Object.assign({}, fresh.approvals || {});
        fresh.approvals[key] = { name: user.name, userId: user.id, at: new Date().toISOString() };
        if (fresh._unapprove) fresh._unapprove = fresh._unapprove.filter(function (k) { return k !== key; });
        Store.put('inspections', fresh);
        U.toast(role.name + 'の確認を記録しました');
        MT.rerender();
      });
    });
    U.qsa('[data-unapprove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-unapprove');
        if (!confirm('確認を取り消します。よろしいですか？')) return;
        var fresh = Store.get('inspections', rec.id);
        if (!fresh) return;
        fresh.approvals = Object.assign({}, fresh.approvals || {});
        delete fresh.approvals[key];
        fresh._unapprove = (fresh._unapprove || []).concat([key]);
        Store.put('inspections', fresh);
        U.toast('取り消しました');
        MT.rerender();
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 記録の一覧（事務所）
   * ------------------------------------------------------------------ */
  function monthsOf(recs) {
    var set = {};
    recs.forEach(function (r) { if (U.isYm((r.date || '').slice(0, 7))) set[r.date.slice(0, 7)] = true; });
    var list = Object.keys(set).sort().reverse();
    if (list.indexOf(U.thisMonth()) < 0) list.unshift(U.thisMonth());
    return list;
  }

  MT.route('records', {}, function (m, params) {
    var site = Store.get('sites', params.site);
    if (!site) return MT.notFound('現場が見つかりません。');
    var target = params.target ? (Store.get('machines', params.target) || Store.get('targets', params.target)) : null;
    var catId = target ? (Store.get('machines', params.target) ? 'heavy' : target.category) : (Cat.get(params.cat) ? params.cat : 'heavy');
    var cat = Cat.get(catId);
    var all = M.inspections({ siteId: site.id, category: catId, targetId: target ? target.id : '' });
    var months = monthsOf(all);
    var ym = U.isYm(params.ym) ? params.ym : months[0];
    var recs = all.filter(function (r) { return (r.date || '').slice(0, 7) === ym; }).reverse();
    var back = target ? M.targetHref(catId, target.id) : '#/site/' + encodeURIComponent(site.id) + '?tab=inspect';

    var html = UI.backLink(back, '戻る') +
      UI.pageHead('RECORDS', cat.name + 'の点検記録') +
      '<p class="muted">' + esc(site.name) + (target ? '　／　' + esc(target.name) : '　／　すべての' + esc(cat.name)) + '</p>' +
      '<div class="card">' + UI.field('月', UI.select('f-ym', UI.monthOptions(months), ym)) +
      UI.btnRow(cat.sheet === 'monthly'
        ? '<a class="btn" href="#/print/month?site=' + encodeURIComponent(site.id) + '&cat=' + catId + (target ? '&target=' + encodeURIComponent(target.id) : '') + '&ym=' + ym + '">月間点検表を印刷' + (target ? '' : '（全' + esc(cat.unit) + '）') + '</a>'
        : '<a class="btn" href="#/print/sheet?site=' + encodeURIComponent(site.id) + (target ? '&target=' + encodeURIComponent(target.id) : '') + '&ym=' + ym + '">この月の点検表をまとめて印刷</a>') +
      '</div>';

    html += '<p class="muted">' + recs.length + ' 件</p>';
    if (!recs.length) html += UI.empty(U.ymLabel(ym) + 'の点検記録はありません。');
    html += '<ul class="list">' + recs.map(function (r) {
      var tags = [judgementTag(r)];
      if (r.approvals && r.approvals.manager) tags.push({ cls: 'done', text: '元請確認済' });
      return '<li>' + UI.rowLink('#/record/' + encodeURIComponent(r.id), {
        count: Number((r.date || '').slice(8)) || '', unit: U.weekday(r.date),
        countClass: r.judgement === 'ok' ? 'done' : '',
        main: (r.targetName || r.machineName || '') + '　' + (r.time || ''),
        subHtml: esc(Cat.phase(cat, r.phase, r.targetType || r.machineType).name) + '　点検者：' + esc(r.inspector || '－'),
        tags: tags
      }) + '</li>';
    }).join('') + '</ul>';

    U.app().innerHTML = html;
    U.on('#f-ym', 'change', function () {
      U.go('#/records' + U.query({ site: site.id, cat: catId, target: target ? target.id : '', ym: U.val('#f-ym') }));
    });
  });

  /* ------------------------------------------------------------------ *
   * 印刷：月間点検表（1対象・1か月＝1枚）
   * ------------------------------------------------------------------ */
  function markOf(v) {
    if (v === 'ok') return '<span class="mk">○</span>';
    if (v === 'ng') return '<span class="mk ng">×</span>';
    if (v === 'fix') return '<span class="mk ng">△</span>';
    if (v === 'na') return '<span class="mk na">／</span>';
    return '';
  }

  function dayClass(ym, d) {
    var w = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, d).getDay();
    return w === 0 ? ' sun' : (w === 6 ? ' sat' : '');
  }

  var MONTH_TITLES = {
    heavy: '建設機械　日常点検記録表',
    rigging: '玉掛け作業　点検記録表',
    excavation: '地山の掘削・土止め支保工　点検記録表'
  };

  function monthApprovalHtml(recs) {
    return '<table class="approval"><thead><tr>' + APPROVAL_ROLES.map(function (r) { return '<th>' + esc(r.name) + '</th>'; }).join('') +
      '</tr></thead><tbody><tr>' + APPROVAL_ROLES.map(function (role) {
        var done = recs.map(function (r) { return r.approvals && r.approvals[role.key]; }).filter(Boolean);
        if (!done.length) return '<td></td>';
        var last = done[done.length - 1];
        return '<td><span class="ap-name">' + esc(last.name) + '</span><span class="ap-date">' +
          (done.length === recs.length ? esc(U.formatStamp(last.at).date) : done.length + '／' + recs.length + '件 確認済') + '</span></td>';
      }).join('') + '</tr></tbody></table>';
  }

  function monthDocHtml(target, catId, ym) {
    var cat = Cat.get(catId);
    var site = Store.get('sites', target.siteId) || {};
    var days = U.daysInMonth(ym);
    var recs = M.inspections({ siteId: target.siteId, targetId: target.id, from: ym + '-01', to: ym + '-' + U.pad(days) });
    var byKey = {};
    recs.forEach(function (r) { byKey[r.phase + '|' + Number((r.date || '').slice(8, 10))] = r; });
    function recAt(ph, d) { return byKey[ph + '|' + d] || null; }
    var phases = cat.phasesFor(target.type);
    function recsOn(d) { return phases.map(function (ph) { return recAt(ph.id, d); }).filter(Boolean); }

    var html = '<div class="month-doc"><div class="doc-head"><div><div class="doc-title">' + esc(MONTH_TITLES[catId]) + '</div>' +
      '<div class="doc-sub">' + esc(U.ymLabel(ym)) + '分</div></div>' + monthApprovalHtml(recs) + '</div>';

    html += '<table class="meta"><tbody>' +
      '<tr><th>工事名</th><td colspan="3">' + esc(site.name || '') + (site.contractNo ? '（工事番号：' + esc(site.contractNo) + '）' : '') + '</td></tr>';
    if (catId === 'heavy') {
      html += '<tr><th>機械名</th><td>' + esc(target.name) + '</td><th>機種</th><td>' + esc(cat.typeName(target.type)) + '</td></tr>' +
        '<tr><th>機番</th><td>' + esc(target.serial || '－') + '</td><th>メーカー・型式</th><td>' +
        esc(((target.maker || '') + ' ' + (target.model || '')).trim() || '－') + '</td></tr>';
    } else {
      html += '<tr><th>' + (catId === 'rigging' ? '対象' : '箇所') + '</th><td>' + esc(target.name) + '</td><th>種類</th><td>' + esc(cat.typeName(target.type)) + '</td></tr>' +
        '<tr><th>場所・範囲</th><td colspan="3">' + esc(target.place || '－') + '</td></tr>';
    }
    html += '</tbody></table>';

    var d;
    var grid = '<div class="table-scroll"><table class="month-grid"><thead><tr><th class="i-label">点　検　項　目</th>';
    for (d = 1; d <= days; d++) grid += '<th class="i-day' + dayClass(ym, d) + '">' + d + '</th>';
    grid += '</tr></thead><tbody>';

    phases.forEach(function (ph) {
      cat.sectionsFor(ph.id, target.type).forEach(function (sec) {
        grid += '<tr class="sec-row"><th colspan="' + (days + 1) + '">' + esc(ph.name) + '　―　' + esc(sec.title) + '</th></tr>';
        sec.items.forEach(function (it) {
          grid += '<tr><th class="i-label">' + esc(it.label) + '</th>';
          for (d = 1; d <= days; d++) {
            var r = recAt(ph.id, d);
            grid += '<td class="i-day' + dayClass(ym, d) + '">' + markOf(r && r.results ? r.results[it.id] : undefined) + '</td>';
          }
          grid += '</tr>';
        });
      });
    });

    grid += '<tr class="sec-row"><th colspan="' + (days + 1) + '">記録・確認</th></tr>';
    grid += '<tr><th class="i-label">点　検　者</th>';
    for (d = 1; d <= days; d++) {
      var names = [];
      recsOn(d).forEach(function (r) { if (r.inspector && names.indexOf(r.inspector) < 0) names.push(r.inspector); });
      grid += '<td class="i-day vtext who' + dayClass(ym, d) + '">' + esc(names.join('／')) + '</td>';
    }
    grid += '</tr><tr><th class="i-label">判　定</th>';
    for (d = 1; d <= days; d++) {
      var on = recsOn(d);
      var mark = '';
      if (on.length) mark = on.some(function (r) { return r.judgement === 'ng'; }) ? '<span class="mk ng">×</span>' : '<span class="mk">○</span>';
      grid += '<td class="i-day' + dayClass(ym, d) + '">' + mark + '</td>';
    }
    grid += '</tr><tr><th class="i-label">元　請　確　認</th>';
    for (d = 1; d <= days; d++) {
      var who = '';
      recsOn(d).forEach(function (r) { var a = r.approvals && r.approvals.manager; if (!who && a && a.name) who = a.name; });
      grid += '<td class="i-day vtext who' + dayClass(ym, d) + '">' + esc(who) + '</td>';
    }
    grid += '</tr></tbody></table></div>';
    html += grid;
    html += '<p class="legend">○＝良　　×＝否（要対応）　　／＝該当なし　　空欄＝点検の記録なし</p>';

    var notes = recs.filter(function (r) { return r.judgement !== 'ok' || r.ngNote || r.action; }).map(function (r) {
      var line = '<strong>' + Number((r.date || '').slice(8, 10)) + '日</strong>　' + esc(Cat.phase(cat, r.phase, target.type).name);
      if (r.ngNote) line += '　不具合：' + esc(r.ngNote).replace(/\n/g, ' ');
      if (r.action) line += '　措置：' + esc(r.action).replace(/\n/g, ' ');
      return '<li>' + line + '</li>';
    });
    html += '<h3>不具合・措置の記録</h3>' + (notes.length ? '<ul class="note-list">' + notes.join('') + '</ul>' :
      '<div class="note-empty">この月に記録された不具合はありません。</div>');
    return html + '</div>';
  }

  MT.route('print/month', { print: true }, function (m, params) {
    var ym = U.isYm(params.ym) ? params.ym : U.thisMonth();
    var catId = Cat.get(params.cat) ? params.cat : 'heavy';
    if (Cat.get(catId).sheet !== 'monthly') return U.go('#/print/sheet' + U.query({ site: params.site, target: params.target, ym: ym }));
    var targets;
    var back;
    if (params.target) {
      var t = Store.get(M.targetKind(catId), params.target);
      if (!t) return MT.notFound('点検対象が見つかりません。');
      targets = [t];
      back = M.targetHref(catId, t.id);
    } else {
      var site = Store.get('sites', params.site);
      if (!site) return MT.notFound('現場が見つかりません。');
      targets = M.targets(site.id, catId);
      back = '#/site/' + encodeURIComponent(site.id) + '?tab=inspect';
    }
    if (!targets.length) return MT.notFound('印刷する対象がありません。');
    U.app().innerHTML = UI.printBar(back, esc(U.ymLabel(ym)) + '分・' + targets.length + '枚（1対象につき1枚、A4縦に収まります）。') +
      '<div class="print-sheet">' + targets.map(function (t) {
        return '<div class="month-page">' + monthDocHtml(t, catId, ym) + '</div>';
      }).join('') + '</div>';
    UI.bindPrint();
  });

  /* ------------------------------------------------------------------ *
   * 印刷：足場点検表（1回＝1枚）
   * ------------------------------------------------------------------ */
  MT.route('print/sheet', { print: true }, function (m, params) {
    var recs, back;
    if (params.record) {
      var r = Store.get('inspections', params.record);
      if (!r) return MT.notFound('点検記録が見つかりません。');
      recs = [r];
      back = '#/record/' + encodeURIComponent(r.id);
    } else {
      var ym = U.isYm(params.ym) ? params.ym : U.thisMonth();
      recs = M.inspections({
        siteId: params.site, category: 'scaffold', targetId: params.target || '',
        from: ym + '-01', to: ym + '-' + U.pad(U.daysInMonth(ym))
      });
      back = params.target ? '#/target/' + encodeURIComponent(params.target) : '#/site/' + encodeURIComponent(params.site) + '?tab=inspect';
    }
    if (!recs.length) {
      U.app().innerHTML = UI.backLink(back, '戻る') + UI.empty('印刷する点検記録がありません。');
      return;
    }
    U.app().innerHTML = UI.printBar(back, recs.length + '件を、1件につきA4縦1枚で印刷します。') +
      '<div class="print-sheet">' + recs.map(function (rec) {
        return '<div class="sheet-page">' + scaffoldDocHtml(rec, M.targetOf(rec), true) + '</div>';
      }).join('') + '</div>';
    UI.bindPrint();
  });
})(window);
