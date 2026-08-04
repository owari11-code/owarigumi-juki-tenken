/*
 * app.js - 画面遷移と描画
 * ハッシュルーティングの単一ページ構成。ログイン不要。
 *   #/                     現場一覧
 *   #/site/new             現場の新規登録
 *   #/site/<id>            現場詳細（重機一覧）
 *   #/site/<id>/edit       現場の編集
 *   #/machine/new?site=    重機の新規登録
 *   #/machine/<id>         重機詳細（QRコード・点検開始）
 *   #/machine/<id>/edit    重機の編集
 *   #/inspect/<machineId>?phase=pre|post   点検フォーム
 *   #/record/<id>          点検記録の詳細
 *   #/records?site=&machine=  点検記録の一覧
 *   #/print/labels?site=&machine=  QRラベル印刷
 *   #/print/records?site=&machine=&from=&to=  点検記録の印刷(PDF)
 *   #/settings             設定・バックアップ
 *   #i=<データ>            QRコードからの入口
 */
(function () {
  'use strict';

  var D = window.InspectionData;
  var app = document.getElementById('app');

  /* ------------------------------------------------------------------ *
   * 小道具
   * ------------------------------------------------------------------ */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function nowTimeStr() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function formatDate(s) {
    if (!s) return '';
    var p = s.split('-');
    return p.length === 3 ? p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日' : s;
  }

  /** 工期の表示（旧形式の自由入力 period も表示できるようにしておく） */
  function periodText(site) {
    if (!site) return '';
    if (site.periodFrom || site.periodTo) {
      return formatDate(site.periodFrom) + ' 〜 ' + formatDate(site.periodTo);
    }
    return site.period || '';
  }

  function go(hash) { location.hash = hash; }

  /* Supabase側で最初に1回だけ実行するSQL（設定画面からコピーできる） */
  var SETUP_SQL = [
    '-- 点検データの置き場（1テーブルだけ）',
    'create table if not exists public.juki_records (',
    '  id         text primary key,',
    '  space      text not null,',
    '  kind       text not null,',
    '  data       jsonb not null,',
    '  deleted    boolean not null default false,',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'create index if not exists juki_records_space_updated_idx',
    '  on public.juki_records (space, updated_at);',
    '',
    '-- 更新のたびにサーバー側の時刻を打ち直す（取りこぼし防止）',
    'create or replace function public.juki_touch()',
    'returns trigger language plpgsql as $$',
    'begin',
    '  new.updated_at = now();',
    '  return new;',
    'end $$;',
    '',
    'drop trigger if exists juki_touch_trg on public.juki_records;',
    'create trigger juki_touch_trg',
    '  before insert or update on public.juki_records',
    '  for each row execute function public.juki_touch();',
    '',
    '-- ログインを使わないため、匿名キーでの読み書きを許可する',
    'alter table public.juki_records enable row level security;',
    '',
    'drop policy if exists "app access" on public.juki_records;',
    'create policy "app access" on public.juki_records',
    '  for all to anon using (true) with check (true);'
  ].join('\n');

  function qs(sel) { return app.querySelector(sel); }
  function val(sel) {
    var el = qs(sel);
    return el ? el.value.trim() : '';
  }

  /* ハッシュを {path:[], params:{}} に分解 */
  function parseHash() {
    var h = location.hash || '';
    if (h.indexOf('#i=') === 0) return { entry: h.slice(3), path: [], params: {} };
    h = h.replace(/^#\/?/, '');
    var parts = h.split('?');
    var path = parts[0] ? parts[0].split('/').filter(Boolean).map(decodeURIComponent) : [];
    var params = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i < 0) params[decodeURIComponent(kv)] = '';
        else params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
    }
    return { path: path, params: params };
  }

  /** 画面上部に置く戻る導線 */
  function backLink(href, label) {
    return '<a class="back-link" href="' + href + '">‹ ' + esc(label) + '</a>';
  }

  function crumbs(items) {
    return '<div class="breadcrumb">' + items.map(function (it, i) {
      var text = esc(it.text);
      var link = it.href ? '<a href="' + it.href + '">' + text + '</a>' : text;
      return (i ? ' &rsaquo; ' : '') + link;
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * 現場一覧
   * ------------------------------------------------------------------ */
  function renderHome() {
    var sites = Store.listSites();
    var html = '<h1>工事現場一覧</h1>';

    if (!sites.length) {
      html +=
        '<div class="card">' +
        '<p><strong>はじめに</strong></p>' +
        '<p>①工事現場を登録　→　②その現場の重機を登録　→　③重機のQRコードを印刷して機体に貼付　→　④現場ではQRを読むだけで点検できます。</p>' +
        '<p class="muted">記録はいつでもPDF（印刷）で出力できます。' +
        (Sync.isActive()
          ? '記録は他の端末とも自動で共有されます。'
          : '（いまは<a href="#/settings">この端末だけ</a>に保存されます）') + '</p>' +
        '</div>';
    }

    html += '<ul class="list">';
    sites.forEach(function (s) {
      var machines = Store.listMachines(s.id);
      var recs = Store.listInspections({ siteId: s.id });
      var last = recs.length ? recs[recs.length - 1] : null;
      html +=
        '<li><a class="row-link" href="#/site/' + encodeURIComponent(s.id) + '">' +
        '<span><span class="main">' + esc(s.name) + '</span><br>' +
        '<span class="sub">重機 ' + machines.length + ' 台 ／ 点検記録 ' + recs.length + ' 件' +
        (last ? '　最終点検 ' + esc(formatDate(last.date)) : '') + '</span></span>' +
        '<span class="arrow">›</span></a></li>';
    });
    html += '</ul>';

    html +=
      '<div class="btn-row">' +
      '<a class="btn" href="#/site/new">＋ 工事現場を登録</a>' +
      '</div>';

    app.innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * 現場の登録・編集
   * ------------------------------------------------------------------ */
  function renderSiteForm(site) {
    var isNew = !site;
    site = site || { name: '', contractNo: '', client: '', periodFrom: '', periodTo: '', manager: '' };
    app.innerHTML =
      crumbs([{ text: '現場一覧', href: '#/' }, { text: isNew ? '現場の登録' : '現場の編集' }]) +
      '<h1>' + (isNew ? '工事現場の登録' : '工事現場の編集') + '</h1>' +
      '<div class="card">' +
      field('工事番号', '<input type="text" id="f-contractno" value="' + esc(site.contractNo || '') + '" placeholder="例：R8-道改-1234">') +
      field('工事名（現場名）', '<input type="text" id="f-name" value="' + esc(site.name) + '" placeholder="例：○○川災害復旧工事">', true) +
      field('発注者', '<input type="text" id="f-client" value="' + esc(site.client || '') + '" placeholder="例：○○県○○事務所">') +
      '<div class="field-row">' +
      field('工期（開始）', '<input type="date" id="f-from" value="' + esc(site.periodFrom || '') + '">') +
      field('工期（終了）', '<input type="date" id="f-to" value="' + esc(site.periodTo || '') + '">') +
      '</div>' +
      '<div class="field-row">' +
      field('現場代理人', '<input type="text" id="f-manager" value="' + esc(site.manager || '') + '">') +
      field('主任技術者', '<input type="text" id="f-engineer" value="' + esc(site.engineer || '') + '">') +
      '</div>' +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn" id="b-save">保存</button>' +
      '<a class="btn plain" href="' + (isNew ? '#/' : '#/site/' + encodeURIComponent(site.id)) + '">キャンセル</a>' +
      '</div>' +
      (isNew ? '' :
        '<div class="btn-row"><button class="btn danger" id="b-del">この現場を削除</button></div>' +
        '<p class="muted">削除すると、この現場の重機と点検記録もすべて削除されます。</p>');

    qs('#b-save').onclick = function () {
      var name = val('#f-name');
      if (!name) { toast('工事名を入力してください'); qs('#f-name').focus(); return; }
      var from = val('#f-from');
      var to = val('#f-to');
      if (from && to && from > to) { toast('工期の終了日は開始日より後にしてください'); return; }
      site.name = name;
      site.contractNo = val('#f-contractno');
      site.client = val('#f-client');
      site.periodFrom = from;
      site.periodTo = to;
      site.manager = val('#f-manager');
      site.engineer = val('#f-engineer');
      Store.saveSite(site);
      toast('保存しました');
      go('#/site/' + encodeURIComponent(site.id));
    };
    if (!isNew) {
      qs('#b-del').onclick = function () {
        if (!confirm('「' + site.name + '」と、その重機・点検記録をすべて削除します。よろしいですか？')) return;
        Store.deleteSite(site.id);
        toast('削除しました');
        go('#/');
      };
    }
  }

  function field(label, input, required) {
    return '<label class="field"><span>' + esc(label) +
      (required ? '<span class="required">必須</span>' : '') + '</span>' + input + '</label>';
  }

  /* ------------------------------------------------------------------ *
   * 現場詳細
   * ------------------------------------------------------------------ */
  function renderSite(site) {
    var machines = Store.listMachines(site.id);
    var html = backLink('#/', '現場一覧へ戻る');
    html += '<h1>' + esc(site.name) + '</h1>';

    var meta = [];
    if (site.contractNo) meta.push('工事番号：' + site.contractNo);
    if (site.client) meta.push('発注者：' + site.client);
    var period = periodText(site);
    if (period) meta.push('工期：' + period);
    if (site.manager) meta.push('現場代理人：' + site.manager);
    if (site.engineer) meta.push('主任技術者：' + site.engineer);
    if (meta.length) html += '<p class="muted">' + esc(meta.join('　／　')) + '</p>';

    html += '<h2>登録重機（' + machines.length + '台）</h2>';
    if (!machines.length) {
      html += '<div class="card"><p>まだ重機が登録されていません。</p></div>';
    }
    html += '<ul class="list">';
    machines.forEach(function (m) {
      var recs = Store.listInspections({ machineId: m.id });
      var last = recs.length ? recs[recs.length - 1] : null;
      html +=
        '<li><a class="row-link" href="#/machine/' + encodeURIComponent(m.id) + '">' +
        '<span><span class="main">' + esc(m.name) + '</span><br>' +
        '<span class="sub">' + esc(D.machineTypeName(m.type)) +
        (m.serial ? '　機番 ' + esc(m.serial) : '') + '<br>' +
        (last ? '最終点検 ' + esc(formatDate(last.date)) + '（' + esc(D.phaseName(last.phase)) + '・' +
          (last.judgement === 'ng' ? '<span class="badge ng">要整備</span>' : '<span class="badge ok">良</span>') + '）'
          : '<span class="badge none">点検記録なし</span>') +
        '</span></span><span class="arrow">›</span></a></li>';
    });
    html += '</ul>';

    html +=
      '<div class="btn-row">' +
      '<a class="btn" href="#/machine/new?site=' + encodeURIComponent(site.id) + '">＋ 重機を登録</a>' +
      '</div>' +
      '<div class="btn-row">' +
      '<a class="btn secondary" href="#/print/labels?site=' + encodeURIComponent(site.id) + '">QRラベルを印刷</a>' +
      '<a class="btn secondary" href="#/records?site=' + encodeURIComponent(site.id) + '">点検記録を見る</a>' +
      '</div>' +
      '<div class="btn-row">' +
      '<a class="btn plain" href="#/site/' + encodeURIComponent(site.id) + '/edit">現場情報を編集</a>' +
      '</div>' +
      // 重機が多い現場では画面が長くなるため、下にも戻る導線を置く
      '<div class="btn-row">' +
      '<a class="btn secondary" href="#/">‹ 現場一覧へ戻る</a>' +
      '</div>';

    app.innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * 重機の登録・編集
   * ------------------------------------------------------------------ */
  function renderMachineForm(machine, siteId) {
    var isNew = !machine;
    machine = machine || { name: '', type: 'backhoe_crawler', maker: '', model: '', serial: '', siteId: siteId };
    var site = Store.getSite(machine.siteId);
    if (!site) return renderNotFound('現場が見つかりません。');

    var typeOptions = D.MACHINE_TYPES.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === machine.type ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');

    var siteOptions = Store.listSites().map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === machine.siteId ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');

    app.innerHTML =
      crumbs([{ text: '現場一覧', href: '#/' }, { text: site.name, href: '#/site/' + encodeURIComponent(site.id) },
        { text: isNew ? '重機の登録' : '重機の編集' }]) +
      '<h1>' + (isNew ? '重機の登録' : '重機の編集') + '</h1>' +
      '<div class="card">' +
      field('重機の呼び名', '<input type="text" id="f-name" value="' + esc(machine.name) + '" placeholder="例：バックホウ0.45m3 ①">', true) +
      field('機種', '<select id="f-type">' + typeOptions + '</select>', true) +
      field('工事現場', '<select id="f-site">' + siteOptions + '</select>', true) +
      '<div class="field-row">' +
      field('メーカー', '<input type="text" id="f-maker" value="' + esc(machine.maker || '') + '" placeholder="例：コマツ">') +
      field('型式', '<input type="text" id="f-model" value="' + esc(machine.model || '') + '" placeholder="例：PC138US">') +
      '</div>' +
      field('機番・車両番号', '<input type="text" id="f-serial" value="' + esc(machine.serial || '') + '">') +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn" id="b-save">保存</button>' +
      '<a class="btn plain" href="' + (isNew ? '#/site/' + encodeURIComponent(site.id) : '#/machine/' + encodeURIComponent(machine.id)) + '">キャンセル</a>' +
      '</div>' +
      (isNew ? '' :
        '<div class="btn-row"><button class="btn danger" id="b-del">この重機を削除</button></div>' +
        '<p class="muted">削除すると、この重機の点検記録もすべて削除されます。</p>');

    qs('#b-save').onclick = function () {
      var name = val('#f-name');
      if (!name) { toast('重機の呼び名を入力してください'); qs('#f-name').focus(); return; }
      machine.name = name;
      machine.type = val('#f-type');
      machine.siteId = val('#f-site');
      machine.maker = val('#f-maker');
      machine.model = val('#f-model');
      machine.serial = val('#f-serial');
      Store.saveMachine(machine);
      toast('保存しました');
      go('#/machine/' + encodeURIComponent(machine.id));
    };
    if (!isNew) {
      qs('#b-del').onclick = function () {
        if (!confirm('「' + machine.name + '」と、その点検記録をすべて削除します。よろしいですか？')) return;
        var sid = machine.siteId;
        Store.deleteMachine(machine.id);
        toast('削除しました');
        go('#/site/' + encodeURIComponent(sid));
      };
    }
  }

  /* ------------------------------------------------------------------ *
   * 重機詳細（QRコードから開いたときの着地点）
   * ------------------------------------------------------------------ */
  function renderMachine(machine) {
    var site = Store.getSite(machine.siteId);
    if (!site) return renderNotFound('現場が見つかりません。');
    var url = Store.machineUrl(machine, site);
    var recs = Store.listInspections({ machineId: machine.id }).reverse();

    var html = crumbs([{ text: '現場一覧', href: '#/' },
      { text: site.name, href: '#/site/' + encodeURIComponent(site.id) }, { text: machine.name }]);

    html += '<h1>' + esc(machine.name) + '</h1>';
    var meta = [D.machineTypeName(machine.type)];
    if (machine.maker || machine.model) meta.push((machine.maker || '') + ' ' + (machine.model || ''));
    if (machine.serial) meta.push('機番 ' + machine.serial);
    html += '<p class="muted">' + esc(meta.join('　／　')) + '</p>';

    html +=
      '<div class="btn-row">' +
      '<a class="btn" href="#/inspect/' + encodeURIComponent(machine.id) + '?phase=pre">作業開始前点検を行う</a>' +
      '</div>' +
      '<div class="btn-row">' +
      '<a class="btn secondary" href="#/inspect/' + encodeURIComponent(machine.id) + '?phase=post">作業終了時点検を行う</a>' +
      '</div>';

    html += '<h2>この重機のQRコード</h2>' +
      '<div class="card qr-box">' +
      '<div id="qr"></div>' +
      '<div class="qr-url">' + esc(url) + '</div>' +
      '</div>' +
      '<div class="btn-row">' +
      '<a class="btn secondary" href="#/print/labels?machine=' + encodeURIComponent(machine.id) + '">QRラベルを印刷</a>' +
      '</div>';

    html += '<h2>点検記録（' + recs.length + '件）</h2>';
    if (!recs.length) {
      html += '<div class="card"><p>まだ点検記録がありません。</p></div>';
    } else {
      html += '<ul class="list">';
      recs.slice(0, 10).forEach(function (r) {
        html += '<li><a class="row-link" href="#/record/' + encodeURIComponent(r.id) + '">' +
          '<span><span class="main">' + esc(formatDate(r.date)) + ' ' + esc(r.time || '') + '</span><br>' +
          '<span class="sub">' + esc(D.phaseName(r.phase)) + '　点検者：' + esc(r.inspector || '－') + '</span></span>' +
          (r.judgement === 'ng' ? '<span class="badge ng">要整備</span>' : '<span class="badge ok">良</span>') +
          '</a></li>';
      });
      html += '</ul>';
      html += '<div class="btn-row">' +
        '<a class="btn secondary" href="#/records?machine=' + encodeURIComponent(machine.id) + '">すべての記録・印刷</a>' +
        '</div>';
    }

    html += '<div class="btn-row"><a class="btn plain" href="#/machine/' + encodeURIComponent(machine.id) + '/edit">重機情報を編集</a></div>';

    app.innerHTML = html;
    drawQr(qs('#qr'), url, 260);
  }

  function drawQr(container, text, maxWidth) {
    try {
      container.innerHTML = QRCode.toSVG(text, { ecl: 'M', border: 2 });
      if (maxWidth) container.firstChild.style.maxWidth = maxWidth + 'px';
    } catch (e) {
      container.innerHTML = '<div class="alert error">QRコードを生成できませんでした：' + esc(e.message) + '</div>';
    }
  }

  /* ------------------------------------------------------------------ *
   * 点検フォーム
   * ------------------------------------------------------------------ */
  function renderInspect(machine, phase) {
    var site = Store.getSite(machine.siteId);
    if (!site) return renderNotFound('現場が見つかりません。');
    var sections = D.sectionsFor(phase, machine.type);

    var html = crumbs([{ text: '現場一覧', href: '#/' },
      { text: site.name, href: '#/site/' + encodeURIComponent(site.id) },
      { text: machine.name, href: '#/machine/' + encodeURIComponent(machine.id) },
      { text: D.phaseName(phase) }]);

    html += '<h1>' + esc(D.phaseName(phase)) + '</h1>' +
      '<div class="card tight">' +
      '<div><strong>' + esc(machine.name) + '</strong>（' + esc(D.machineTypeName(machine.type)) + '）</div>' +
      '<div class="muted">' + esc(site.name) + (machine.serial ? '　機番 ' + esc(machine.serial) : '') + '</div>' +
      '</div>';

    html += '<div class="card">' +
      '<div class="field-row">' +
      field('点検日', '<input type="date" id="f-date" value="' + todayStr() + '">', true) +
      field('時刻', '<input type="time" id="f-time" value="' + nowTimeStr() + '">') +
      '</div>' +
      field('点検者氏名', '<input type="text" id="f-inspector" value="' + esc(lastInspector()) + '">', true) +
      field('アワーメータ（h）', '<input type="number" id="f-hour" inputmode="decimal" step="0.1" placeholder="任意">') +
      '</div>';

    sections.forEach(function (sec) {
      html += '<h2>' + esc(sec.title) + '</h2>';
      if (sec.note) html += '<p class="section-note">' + esc(sec.note) + '</p>';
      html += '<div class="card">';
      sec.items.forEach(function (it) {
        html +=
          '<div class="check-item" data-item="' + esc(it.id) + '">' +
          '<div class="label">' + esc(it.label) +
          (it.hint ? '<br><span class="hint">※' + esc(it.hint) + '</span>' : '') + '</div>' +
          '<div class="choices">' +
          choice(it.id, 'ok', '良', 'c-ok') +
          choice(it.id, 'ng', '否', 'c-ng') +
          choice(it.id, 'na', '該当なし', 'c-na') +
          '</div></div>';
      });
      html += '</div>';
    });

    html += '<h2>備考・処置</h2>' +
      '<div class="card">' +
      field('不具合の内容', '<textarea id="f-ngnote" placeholder="「否」があった場合に記入"></textarea>') +
      field('処置・連絡事項', '<textarea id="f-action" placeholder="例：○○を補給した／整備会社へ連絡"></textarea>') +
      '</div>';

    html +=
      '<div class="sticky-actions">' +
      '<button class="btn block" id="b-save">点検を記録する</button>' +
      '</div>' +
      '<div class="btn-row"><button class="btn plain" id="b-allok">すべて「良」にする</button></div>' +
      '<p class="muted">※「すべて良」は入力補助です。必ず現物を確認してください。</p>';

    app.innerHTML = html;

    qs('#b-allok').onclick = function () {
      var boxes = app.querySelectorAll('input[type="radio"][value="ok"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
      toast('すべて「良」を選択しました');
    };

    qs('#b-save').onclick = function () {
      var date = val('#f-date');
      var inspector = val('#f-inspector');
      if (!date) { toast('点検日を入力してください'); return; }
      if (!inspector) { toast('点検者氏名を入力してください'); qs('#f-inspector').focus(); return; }

      var results = {};
      var missing = null;
      var itemEls = app.querySelectorAll('.check-item');
      for (var i = 0; i < itemEls.length; i++) {
        var id = itemEls[i].getAttribute('data-item');
        var sel = itemEls[i].querySelector('input[type="radio"]:checked');
        if (!sel) { if (!missing) missing = itemEls[i]; continue; }
        results[id] = sel.value;
      }
      if (missing) {
        missing.scrollIntoView({ block: 'center' });
        missing.style.background = '#fff8e1';
        toast('未選択の項目があります');
        return;
      }

      var hasNg = Object.keys(results).some(function (k) { return results[k] === 'ng'; });
      var rec = {
        siteId: site.id,
        machineId: machine.id,
        siteName: site.name,
        siteContractNo: site.contractNo || '',
        machineName: machine.name,
        machineType: machine.type,
        serial: machine.serial || '',
        phase: phase,
        date: date,
        time: val('#f-time'),
        inspector: inspector,
        hourMeter: val('#f-hour'),
        results: results,
        ngNote: val('#f-ngnote'),
        action: val('#f-action'),
        judgement: hasNg ? 'ng' : 'ok'
      };
      Store.saveInspection(rec);
      try { localStorage.setItem('juki-last-inspector', inspector); } catch (e) { /* 無視 */ }
      toast(hasNg ? '記録しました（要整備）' : '記録しました');
      go('#/record/' + encodeURIComponent(rec.id));
    };
  }

  function choice(itemId, value, label, cls) {
    return '<label><input type="radio" name="i_' + esc(itemId) + '" value="' + value + '">' +
      '<span class="' + cls + '">' + esc(label) + '</span></label>';
  }

  function lastInspector() {
    try { return localStorage.getItem('juki-last-inspector') || ''; } catch (e) { return ''; }
  }

  /* ------------------------------------------------------------------ *
   * 点検記録の詳細
   * ------------------------------------------------------------------ */
  function renderRecord(rec) {
    var html = crumbs([{ text: '現場一覧', href: '#/' },
      { text: rec.siteName || '現場', href: '#/site/' + encodeURIComponent(rec.siteId) },
      { text: rec.machineName || '重機', href: '#/machine/' + encodeURIComponent(rec.machineId) },
      { text: '点検記録' }]);

    html += '<h1>点検記録</h1>';
    if (rec.judgement === 'ng') {
      html += '<div class="alert error"><strong>要整備の項目があります。</strong>整備・処置が済むまで使用しないでください。</div>';
    } else {
      html += '<div class="alert info">異常なし（すべて良／該当なし）</div>';
    }
    html += recordDocHtml(rec);
    html += approvalFormHtml(rec);
    html +=
      '<div class="btn-row">' +
      '<a class="btn" href="#/print/records?record=' + encodeURIComponent(rec.id) + '">この記録を印刷／PDF保存</a>' +
      '</div>' +
      '<div class="btn-row">' +
      '<a class="btn plain" href="#/machine/' + encodeURIComponent(rec.machineId) + '">重機のページへ</a>' +
      '<button class="btn danger" id="b-del">この記録を削除</button>' +
      '</div>';

    app.innerHTML = html;
    bindApprovalForm(rec);
    qs('#b-del').onclick = function () {
      if (!confirm('この点検記録を削除します。よろしいですか？')) return;
      Store.deleteInspection(rec.id);
      toast('削除しました');
      go('#/machine/' + encodeURIComponent(rec.machineId));
    };
  }

  /* ------------------------------------------------------------------ *
   * 点検内容の確認（現場代理人・主任技術者）
   * ------------------------------------------------------------------ */
  function approvalFormHtml(rec) {
    var site = Store.getSite(rec.siteId);
    var html = '<h2>確認</h2>' +
      '<p class="section-note">点検内容を確認した方が入力してください。' +
      '印刷した用紙に押印する場合は、空欄のままで構いません。</p>' +
      '<div class="card">';
    APPROVAL_ROLES.forEach(function (role) {
      var a = approvalOf(rec, role.key);
      html += '<div class="approve-row">' +
        '<div class="approve-role">' + esc(role.name) + '</div>';
      if (a) {
        var st = formatStamp(a.at);
        html += '<div class="approve-done">' +
          '<span class="badge ok">確認済</span> ' + esc(a.name) +
          '<span class="muted">（' + esc(st.date) + ' ' + esc(st.time) + '）</span>' +
          '</div>' +
          '<button class="btn small plain" data-unapprove="' + esc(role.key) + '">取消</button>';
      } else {
        var def = (site && site[role.siteField]) || '';
        html += '<input type="text" data-approve-name="' + esc(role.key) + '" value="' + esc(def) + '" placeholder="氏名">' +
          '<button class="btn small" data-approve="' + esc(role.key) + '">確認</button>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function bindApprovalForm(rec) {
    APPROVAL_ROLES.forEach(function (role) {
      var okBtn = app.querySelector('[data-approve="' + role.key + '"]');
      if (okBtn) {
        okBtn.onclick = function () {
          var input = app.querySelector('[data-approve-name="' + role.key + '"]');
          var name = input.value.trim();
          if (!name) { toast('氏名を入力してください'); input.focus(); return; }
          var fresh = Store.getInspection(rec.id);
          if (!fresh) { toast('この記録は削除されています'); return; }
          fresh.approvals = fresh.approvals || {};
          fresh.approvals[role.key] = { name: name, at: new Date().toISOString() };
          Store.saveInspection(fresh);
          toast(role.name + 'の確認を記録しました');
          renderRecord(Store.getInspection(rec.id));
        };
      }
      var undoBtn = app.querySelector('[data-unapprove="' + role.key + '"]');
      if (undoBtn) {
        undoBtn.onclick = function () {
          if (!confirm(role.name + 'の確認を取り消します。よろしいですか？')) return;
          var fresh = Store.getInspection(rec.id);
          if (!fresh) { toast('この記録は削除されています'); return; }
          if (fresh.approvals) delete fresh.approvals[role.key];
          Store.saveInspection(fresh);
          toast('取り消しました');
          renderRecord(Store.getInspection(rec.id));
        };
      }
    });
  }

  /**
   * 点検項目の表。
   * compact=true（印刷用）では2項目を横に並べ、A4・1ページに収める。
   * 並びは左の列を上から下、続いて右の列（画面の並び順と同じ）。
   */
  function itemsTableHtml(items, results, compact) {
    function cells(it) {
      if (!it) return '<td class="i-label"></td><td class="i-res"></td>';
      var v = results ? results[it.id] : undefined;
      return '<td class="i-label">' + esc(it.label) + '</td>' +
        '<td class="i-res">' + resultLabel(v) + '</td>';
    }
    var html = '<div class="table-scroll"><table class="data items' +
      (compact ? ' two-up' : '') + '"><tbody>';
    if (compact) {
      var rows = Math.ceil(items.length / 2);
      for (var i = 0; i < rows; i++) {
        html += '<tr>' + cells(items[i]) + cells(items[i + rows]) + '</tr>';
      }
    } else {
      items.forEach(function (it) { html += '<tr>' + cells(it) + '</tr>'; });
    }
    return html + '</tbody></table></div>';
  }

  /** 記録1件分の帳票HTML（画面表示・印刷で共用。compact=印刷用の詰めた体裁） */
  function recordDocHtml(rec, compact) {
    var site = Store.getSite(rec.siteId);
    var sections = D.sectionsFor(rec.phase, rec.machineType);
    var html = '<div class="record-doc card' + (compact ? ' compact' : '') + '">';
    html +=
      '<div class="doc-head">' +
      '<div><div class="doc-title">建設機械　日常点検記録表</div>' +
      '<div class="doc-sub">' + esc(D.phaseName(rec.phase)) + '</div></div>' +
      approvalBoxHtml(rec) +
      '</div>';

    var contractNo = rec.siteContractNo || (site ? site.contractNo : '') || '';
    html += '<table class="meta"><tbody>' +
      '<tr><th>工事名</th><td colspan="3">' + esc(rec.siteName || (site ? site.name : '')) +
      (contractNo ? '（工事番号：' + esc(contractNo) + '）' : '') + '</td></tr>' +
      '<tr><th>機械名</th><td>' + esc(rec.machineName) + '</td><th>機種</th><td>' + esc(D.machineTypeName(rec.machineType)) + '</td></tr>' +
      '<tr><th>機番</th><td>' + esc(rec.serial || '－') + '</td><th>アワーメータ</th><td>' + esc(rec.hourMeter ? rec.hourMeter + ' h' : '－') + '</td></tr>' +
      '<tr><th>点検日時</th><td>' + esc(formatDate(rec.date) + ' ' + (rec.time || '')) + '</td><th>点検者</th><td>' + esc(rec.inspector || '') + '</td></tr>' +
      '<tr><th>判定</th><td colspan="3">' + (rec.judgement === 'ng' ? '要整備（不具合あり）' : '良（異常なし）') + '</td></tr>' +
      '</tbody></table>';

    sections.forEach(function (sec) {
      html += '<h3>' + esc(sec.title) + '</h3>' + itemsTableHtml(sec.items, rec.results, compact);
    });

    html += '<h3>不具合の内容</h3><div class="table-scroll"><table class="data"><tbody><tr><td>' +
      (rec.ngNote ? esc(rec.ngNote).replace(/\n/g, '<br>') : '－') + '</td></tr></tbody></table></div>';
    html += '<h3>処置・連絡事項</h3><div class="table-scroll"><table class="data"><tbody><tr><td>' +
      (rec.action ? esc(rec.action).replace(/\n/g, '<br>') : '－') + '</td></tr></tbody></table></div>';
    html += '</div>';
    return html;
  }

  /* 確認欄で使う役職の定義 */
  var APPROVAL_ROLES = [
    { key: 'manager', name: '現場代理人', siteField: 'manager' },
    { key: 'engineer', name: '主任技術者', siteField: 'engineer' }
  ];

  function approvalOf(rec, key) {
    return (rec.approvals && rec.approvals[key]) || null;
  }

  /** 確認時刻は保存はISO（世界時）、表示は端末の時刻に直す */
  function formatStamp(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) {
      return { date: String(iso || '').slice(0, 10), time: String(iso || '').slice(11, 16) };
    }
    return {
      date: d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日',
      time: pad(d.getHours()) + ':' + pad(d.getMinutes())
    };
  }

  /** 帳票右上の確認欄。アプリで確認済みなら氏名と日付、未確認なら押印用の空欄になる */
  function approvalBoxHtml(rec) {
    var cells = APPROVAL_ROLES.map(function (role) {
      var a = approvalOf(rec, role.key);
      return '<td>' + (a
        ? '<span class="ap-name">' + esc(a.name) + '</span>' +
          '<span class="ap-date">' + esc(formatStamp(a.at).date) + '</span>'
        : '') + '</td>';
    }).join('');
    return '<table class="approval"><thead><tr>' +
      APPROVAL_ROLES.map(function (r) { return '<th>' + esc(r.name) + '</th>'; }).join('') +
      '</tr></thead><tbody><tr>' + cells + '</tr></tbody></table>';
  }

  function resultLabel(v) {
    if (v === 'ok') return '良';
    if (v === 'ng') return '<strong>否</strong>';
    if (v === 'na') return '該当なし';
    return '－';
  }

  /* ------------------------------------------------------------------ *
   * 点検記録の一覧
   * ------------------------------------------------------------------ */
  function renderRecords(params) {
    var siteId = params.site || '';
    var machineId = params.machine || '';
    var machine = machineId ? Store.getMachine(machineId) : null;
    if (machine) siteId = machine.siteId;
    var site = siteId ? Store.getSite(siteId) : null;

    var from = params.from || '';
    var to = params.to || '';
    var recs = Store.listInspections({ siteId: siteId || undefined, machineId: machineId || undefined, from: from, to: to }).reverse();

    var machines = Store.listMachines(siteId || undefined);
    var machineOptions = '<option value="">すべての重機</option>' + machines.map(function (m) {
      return '<option value="' + esc(m.id) + '"' + (m.id === machineId ? ' selected' : '') + '>' + esc(m.name) + '</option>';
    }).join('');

    var html = crumbs([{ text: '現場一覧', href: '#/' }]
      .concat(site ? [{ text: site.name, href: '#/site/' + encodeURIComponent(site.id) }] : [])
      .concat([{ text: '点検記録' }]));

    html += '<h1>点検記録' + (site ? '（' + esc(site.name) + '）' : '') + '</h1>';

    html += '<div class="card">' +
      field('重機', '<select id="f-machine">' + machineOptions + '</select>') +
      '<div class="field-row">' +
      field('期間（開始）', '<input type="date" id="f-from" value="' + esc(from) + '">') +
      field('期間（終了）', '<input type="date" id="f-to" value="' + esc(to) + '">') +
      '</div>' +
      '<div class="btn-row"><button class="btn small" id="b-filter">絞り込む</button>' +
      '<button class="btn small plain" id="b-clear">条件をクリア</button></div>' +
      '</div>';

    html += '<p class="muted">' + recs.length + ' 件</p>';
    if (recs.length) {
      html += '<div class="btn-row"><a class="btn" id="b-print">この一覧をまとめて印刷／PDF保存</a></div>';
      html += '<ul class="list">';
      recs.forEach(function (r) {
        html += '<li><a class="row-link" href="#/record/' + encodeURIComponent(r.id) + '">' +
          '<span><span class="main">' + esc(formatDate(r.date)) + ' ' + esc(r.time || '') + '　' + esc(r.machineName) + '</span><br>' +
          '<span class="sub">' + esc(D.phaseName(r.phase)) + '　点検者：' + esc(r.inspector || '－') + '</span></span>' +
          (r.judgement === 'ng' ? '<span class="badge ng">要整備</span>' : '<span class="badge ok">良</span>') +
          '</a></li>';
      });
      html += '</ul>';
    } else {
      html += '<div class="card"><p>該当する点検記録がありません。</p></div>';
    }

    app.innerHTML = html;

    function buildQuery(base) {
      var q = [];
      if (siteId) q.push('site=' + encodeURIComponent(siteId));
      var m = val('#f-machine');
      if (m) q.push('machine=' + encodeURIComponent(m));
      var f = val('#f-from');
      if (f) q.push('from=' + encodeURIComponent(f));
      var t = val('#f-to');
      if (t) q.push('to=' + encodeURIComponent(t));
      return base + (q.length ? '?' + q.join('&') : '');
    }

    qs('#b-filter').onclick = function () { go(buildQuery('#/records')); };
    qs('#b-clear').onclick = function () { go(siteId ? '#/records?site=' + encodeURIComponent(siteId) : '#/records'); };
    if (qs('#b-print')) {
      qs('#b-print').onclick = function () { go(buildQuery('#/print/records')); };
    }
  }

  /* ------------------------------------------------------------------ *
   * 印刷：QRラベル
   * ------------------------------------------------------------------ */
  function renderPrintLabels(params) {
    var machines, title;
    if (params.machine) {
      var m = Store.getMachine(params.machine);
      if (!m) return renderNotFound('重機が見つかりません。');
      machines = [m];
      title = m.name;
    } else {
      var site = Store.getSite(params.site);
      if (!site) return renderNotFound('現場が見つかりません。');
      machines = Store.listMachines(site.id);
      title = site.name;
    }
    if (!machines.length) return renderNotFound('この現場には重機が登録されていません。');

    var settings = Store.getSettings();
    var warn = '';
    if (!settings.baseUrl && location.protocol === 'file:') {
      warn = '<div class="alert warn no-print"><strong>ご注意：</strong>いまアプリをファイルとして開いているため、' +
        'QRコードにはこのパソコン内のパスが入ります。スマートフォンで読み取れるようにするには、' +
        '<a href="#/settings">設定</a>で公開URLを登録してください。</div>';
    }

    var html = crumbs([{ text: '現場一覧', href: '#/' }, { text: title }, { text: 'QRラベル印刷' }]) +
      '<h1 class="no-print">QRラベルの印刷</h1>' + warn +
      '<div class="btn-row no-print">' +
      '<button class="btn" id="b-print">印刷する（PDF保存も可）</button>' +
      '<button class="btn plain" id="b-back">戻る</button>' +
      '</div>' +
      '<p class="muted no-print">A4に貼付用ラベルを並べて印刷します。印刷後はラミネート等で保護し、運転席から見える位置に貼り付けてください。</p>' +
      '<div class="print-sheet"><div class="label-grid" id="grid"></div></div>';

    app.innerHTML = html;

    var grid = qs('#grid');
    machines.forEach(function (m) {
      var site = Store.getSite(m.siteId);
      var url = Store.machineUrl(m, site || { id: m.siteId, name: '' });
      var cell = document.createElement('div');
      cell.className = 'qr-label';
      var qrHost = document.createElement('div');
      cell.appendChild(qrHost);
      var cap = document.createElement('div');
      cap.innerHTML =
        '<div class="m-name">' + esc(m.name) + '</div>' +
        '<div class="m-sub">' + esc(D.machineTypeName(m.type)) + (m.serial ? '／機番 ' + esc(m.serial) : '') + '</div>' +
        '<div class="m-sub">' + esc(site ? site.name : '') + '</div>' +
        '<div class="m-guide">作業前・作業後にスマートフォンで読み取り、日常点検を記録してください</div>';
      cell.appendChild(cap);
      grid.appendChild(cell);
      drawQr(qrHost, url, 150);
    });

    qs('#b-print').onclick = function () { window.print(); };
    qs('#b-back').onclick = function () { history.back(); };
  }

  /* ------------------------------------------------------------------ *
   * 印刷：点検記録
   * ------------------------------------------------------------------ */
  function renderPrintRecords(params) {
    var recs;
    if (params.record) {
      var r = Store.getInspection(params.record);
      if (!r) return renderNotFound('点検記録が見つかりません。');
      recs = [r];
    } else {
      recs = Store.listInspections({
        siteId: params.site || undefined,
        machineId: params.machine || undefined,
        from: params.from || '',
        to: params.to || ''
      });
    }
    if (!recs.length) return renderNotFound('該当する点検記録がありません。');

    var html =
      '<h1 class="no-print">点検記録の印刷</h1>' +
      '<div class="btn-row no-print">' +
      '<button class="btn" id="b-print">印刷する（PDF保存も可）</button>' +
      '<button class="btn plain" id="b-back">戻る</button>' +
      '</div>' +
      '<p class="muted no-print">印刷ダイアログで「送信先／プリンター」を<strong>「PDFに保存」</strong>にすると、PDFファイルとして保存できます（' + recs.length + '件・1件1ページ）。</p>' +
      '<div class="print-sheet">';
    recs.forEach(function (r) {
      html += '<div class="record-page">' + recordDocHtml(r, true) + '</div>';
    });
    html += '</div>';

    app.innerHTML = html;
    qs('#b-print').onclick = function () { window.print(); };
    qs('#b-back').onclick = function () { history.back(); };
  }

  /* ------------------------------------------------------------------ *
   * 設定・バックアップ
   * ------------------------------------------------------------------ */
  function renderSettings() {
    var s = Store.getSettings();
    var defaultUrl = location.href.split('#')[0];
    var counts = Store.counts();
    var st = Sync.status();

    app.innerHTML =
      crumbs([{ text: '現場一覧', href: '#/' }, { text: '設定' }]) +
      '<h1>設定・バックアップ</h1>' +

      '<h2>端末間の自動共有</h2>' +
      '<div class="card">' +
      '<p id="sync-state">' + syncStateText(st) + '</p>' +
      field('Supabase の Project URL', '<input type="url" id="f-supaurl" value="' + esc(s.supabaseUrl) + '" placeholder="https://xxxxxxxx.supabase.co">') +
      field('anon public キー', '<input type="text" id="f-supakey" value="' + esc(s.supabaseAnonKey) + '" placeholder="eyJhbGciOi...">') +
      field('共有コード', '<input type="text" id="f-space" value="' + esc(s.space) + '" placeholder="default">') +
      '<label class="field"><span>自動同期</span>' +
      '<select id="f-syncon"><option value="1"' + (s.syncEnabled ? ' selected' : '') + '>する</option>' +
      '<option value="0"' + (s.syncEnabled ? '' : ' selected') + '>しない（この端末だけで使う）</option></select></label>' +
      '<div class="btn-row">' +
      '<button class="btn" id="b-syncsave">保存して接続</button>' +
      '<button class="btn secondary" id="b-syncnow">今すぐ同期</button>' +
      '</div>' +
      '<p class="muted">同じ「共有コード」を使う端末どうしでデータが共有されます。' +
      'この3項目を <code>js/config.js</code> に書いて公開しておくと、QRから開いた端末すべてに自動で設定されます。<br>' +
      'URLは <code>https://〇〇.supabase.co</code> まで。末尾の <code>/rest/v1/</code> は付けても自動で取り除きます。</p>' +
      '<details class="sql-box"><summary>Supabase側の準備（初回だけ必要なSQL）</summary>' +
      '<p class="muted">Supabaseの左メニュー <strong>SQL Editor</strong> を開き、下のSQLを貼り付けて <strong>Run</strong> を押してください。' +
      'これを実行しないと「テーブル juki_records がまだありません」と表示されます。</p>' +
      '<div class="btn-row"><button class="btn small secondary" id="b-copysql">SQLをコピー</button></div>' +
      '<pre id="sql-text">' + esc(SETUP_SQL) + '</pre></details>' +
      '</div>' +

      '<h2>QRコードに埋め込むURL</h2>' +
      '<div class="card">' +
      '<p class="muted">スマートフォンでQRを読み取ったときに開くアドレスです。社内サーバーや共有フォルダ、' +
      'GitHub Pages などにこのアプリ一式を置き、そのURLを入れてください。</p>' +
      field('公開URL', '<input type="url" id="f-base" value="' + esc(s.baseUrl || '') + '" placeholder="' + esc(defaultUrl) + '">') +
      '<p class="muted">未入力の場合は、いま開いているURL（' + esc(defaultUrl) + '）を使います。</p>' +
      field('会社名（帳票の表示用）', '<input type="text" id="f-company" value="' + esc(s.company || '') + '">') +
      '<div class="btn-row"><button class="btn" id="b-save">設定を保存</button></div>' +
      '</div>' +

      '<h2>データのバックアップ</h2>' +
      '<div class="card">' +
      '<p>現在の保存件数：現場 ' + counts.sites + ' 件／重機 ' + counts.machines + ' 台／点検記録 ' + counts.inspections + ' 件</p>' +
      '<p class="muted">自動共有を設定していない場合や、控えを手元に残したい場合に使います。' +
      '書き出したファイルを別の端末で読み込むと、記録を持ち寄れます。</p>' +
      '<div class="btn-row">' +
      '<button class="btn secondary" id="b-export">データを書き出す</button>' +
      '<label class="btn secondary" style="position:relative;overflow:hidden">データを読み込む' +
      '<input type="file" id="f-import" accept="application/json,.json" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>' +
      '</div>' +
      '<p class="muted">読み込みは「追加（マージ）」です。同じ記録は重複しません。</p>' +
      '</div>' +

      '<h2>このアプリについて</h2>' +
      '<div class="card">' +
      '<p class="muted">点検項目は、厚生労働省「外国人労働者に対する安全衛生教育教材作成事業（建設業）／' +
      'トンネル推進工業務、建設機械施工業務及び土工業務　安全衛生のポイント　建設機械の基本と点検等」(2020.3) ' +
      'の作業開始前点検・エンジン始動後点検・作業終了時点検に基づいています。</p>' +
      '</div>' +

      '<div class="btn-row"><button class="btn danger" id="b-clear">すべてのデータを削除</button></div>';

    qs('#b-save').onclick = function () {
      var base = val('#f-base');
      if (base && !/^https?:\/\//i.test(base) && base.indexOf('file:') !== 0) {
        toast('URLは http:// または https:// で始めてください');
        return;
      }
      var local = Store.getLocalSettings();
      local.baseUrl = base;
      local.company = val('#f-company');
      Store.saveSettings(local);
      toast('保存しました');
    };

    qs('#b-syncsave').onclick = function () {
      // 管理画面から /rest/v1/ 付きでコピーされることがあるので整えて保存する
      var url = Sync.normalizeUrl(val('#f-supaurl'));
      qs('#f-supaurl').value = url;
      var key = val('#f-supakey');
      var space = val('#f-space') || 'default';
      var on = val('#f-syncon') === '1';
      var local = Store.getLocalSettings();
      local.supabaseUrl = url;
      local.supabaseAnonKey = key;
      local.space = space;
      local.syncEnabled = on;
      Store.saveSettings(local);

      if (!on) { Sync.stop(); toast('自動同期を停止しました'); renderSettings(); return; }
      if (!url || !key) { toast('URLとキーを入力してください'); return; }
      qs('#sync-state').textContent = '接続を確認しています…';
      Sync.test(url, key, space).then(function () {
        Sync.start();
        toast('接続しました。同期を開始します');
        renderSettings();
      }).catch(function (e) {
        qs('#sync-state').innerHTML = '<span style="color:var(--red)">接続できません：' + esc(e.message) + '</span>';
      });
    };

    qs('#b-copysql').onclick = function () {
      var text = SETUP_SQL;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('SQLをコピーしました'); },
          function () { selectSql(); });
      } else {
        selectSql();
      }
    };
    function selectSql() {
      var pre = qs('#sql-text');
      var range = document.createRange();
      range.selectNodeContents(pre);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('SQLを選択しました。コピーしてください');
    }

    qs('#b-syncnow').onclick = function () {
      if (!Sync.isActive()) { toast('先に接続設定を保存してください'); return; }
      qs('#sync-state').textContent = '同期しています…';
      Sync.syncNow(true).then(function () { renderSettings(); });
    };

    qs('#b-export').onclick = function () {
      var blob = new Blob([Store.exportJson()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '重機点検データ_' + todayStr() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };

    qs('#f-import').onchange = function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var added = Store.importJson(String(reader.result), 'merge');
          toast('読み込みました（現場+' + added.sites + '／重機+' + added.machines + '／記録+' + added.inspections + '）');
          renderSettings();
        } catch (e) {
          alert('読み込みに失敗しました：' + e.message);
        }
      };
      reader.readAsText(file);
    };

    qs('#b-clear').onclick = function () {
      if (!confirm('この端末に保存されているすべてのデータを削除します。よろしいですか？')) return;
      if (!confirm('本当に削除しますか？　書き出し（バックアップ）は済んでいますか？')) return;
      Store.clearAll();
      toast('削除しました');
      go('#/');
    };
  }

  /* ------------------------------------------------------------------ *
   * 同期の状態表示
   * ------------------------------------------------------------------ */
  function syncStateText(st) {
    if (!st.configured) return '未設定です。下の3項目を入力すると、他の端末と自動で共有されます。';
    if (!st.enabled) return '自動同期は「しない」に設定されています（この端末だけで記録します）。';
    if (st.lastError) return '同期できていません：' + st.lastError;
    var t = st.lastSyncAt ? new Date(st.lastSyncAt) : null;
    return '同期しています。最終同期：' +
      (t ? t.getHours() + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()) : '－') +
      (st.pending ? '（未送信 ' + st.pending + ' 件）' : '');
  }

  function updateSyncChip(st) {
    var chip = document.getElementById('sync-chip');
    if (!chip) return;
    var cls = 'sync-chip ', label;
    if (!st.configured || !st.enabled) { cls += 'off'; label = '端末内のみ'; }
    else if (st.lastError) { cls += 'error'; label = '同期エラー'; }
    else if (st.running) { cls += 'busy'; label = '同期中'; }
    else { cls += 'ok'; label = st.pending ? '未送信 ' + st.pending : '同期済'; }
    chip.className = cls;
    chip.textContent = label;
  }

  /* ------------------------------------------------------------------ *
   * QRコードからの入口
   * ------------------------------------------------------------------ */
  function handleEntry(encoded) {
    var payload;
    try {
      payload = JSON.parse(Store.b64urlDecode(encoded));
    } catch (e) {
      return renderNotFound('QRコードの内容を読み取れませんでした。');
    }
    if (!payload || !payload.m) return renderNotFound('QRコードの内容が正しくありません。');

    // QRから開けたということは、いま開いているURLが配布用の正しいURL
    if (!Store.getSettings().baseUrl && location.protocol !== 'file:') {
      var local = Store.getLocalSettings();
      local.baseUrl = location.href.split('#')[0];
      Store.saveSettings(local);
    }

    function land() {
      var res = Store.importFromPayload(payload);
      location.replace(location.href.split('#')[0] + '#/machine/' + encodeURIComponent(res.machine.id));
    }

    // 同期が使えるなら、まずサーバーから正式なデータを取り寄せてから開く
    if (Sync.isActive() && !Store.getMachine(payload.m)) {
      app.innerHTML = '<div class="card"><p>データを読み込んでいます…</p></div>';
      Sync.syncNow(true).then(land, land);
      return;
    }
    land();
  }

  /* ------------------------------------------------------------------ *
   * 404
   * ------------------------------------------------------------------ */
  function renderNotFound(msg) {
    app.innerHTML =
      '<h1>表示できません</h1>' +
      '<div class="alert error">' + esc(msg || 'ページが見つかりません。') + '</div>' +
      '<div class="btn-row"><a class="btn" href="#/">現場一覧へ戻る</a></div>';
  }

  /* ------------------------------------------------------------------ *
   * ルーター
   * ------------------------------------------------------------------ */
  function route() {
    var r = parseHash();
    window.scrollTo(0, 0);

    if (r.entry !== undefined) return handleEntry(r.entry);

    var p = r.path;
    if (!p.length) return renderHome();

    switch (p[0]) {
      case 'site':
        if (p[1] === 'new') return renderSiteForm(null);
        var site = Store.getSite(p[1]);
        if (!site) return renderNotFound('現場が見つかりません。');
        if (p[2] === 'edit') return renderSiteForm(site);
        return renderSite(site);

      case 'machine':
        if (p[1] === 'new') return renderMachineForm(null, r.params.site);
        var machine = Store.getMachine(p[1]);
        if (!machine) return renderNotFound('重機が見つかりません。');
        if (p[2] === 'edit') return renderMachineForm(machine);
        return renderMachine(machine);

      case 'inspect':
        var m2 = Store.getMachine(p[1]);
        if (!m2) return renderNotFound('重機が見つかりません。');
        return renderInspect(m2, r.params.phase === 'post' ? 'post' : 'pre');

      case 'record':
        var rec = Store.getInspection(p[1]);
        if (!rec) return renderNotFound('点検記録が見つかりません。');
        return renderRecord(rec);

      case 'records':
        return renderRecords(r.params);

      case 'print':
        if (p[1] === 'labels') return renderPrintLabels(r.params);
        if (p[1] === 'records') return renderPrintRecords(r.params);
        return renderNotFound();

      case 'settings':
        return renderSettings();

      default:
        return renderNotFound();
    }
  }

  window.addEventListener('hashchange', route);

  /* ------------------------------------------------------------------ *
   * 起動
   * ------------------------------------------------------------------ */
  // 入力中の画面を勝手に描き直さないよう、フォーム系の画面では再描画しない
  function isFormView() {
    var p = parseHash().path;
    return p[0] === 'inspect' || (p[0] === 'site' && (p[1] === 'new' || p[2] === 'edit')) ||
      (p[0] === 'machine' && (p[1] === 'new' || p[2] === 'edit')) || p[0] === 'settings';
  }

  Store.onChange(function (local) {
    if (local) Sync.schedulePush();
    updateSyncChip(Sync.status());
  });

  Sync.onStatus(function (st, changed) {
    updateSyncChip(st);
    if (changed && !isFormView()) route();
    var box = document.getElementById('sync-state');
    if (box) box.textContent = syncStateText(st);
  });

  route();
  updateSyncChip(Sync.status());
  Sync.start();
})();
