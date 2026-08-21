/*
 * store.js - データ保存層（localStorage）
 *
 * ログイン不要で使えるよう、データはまず端末内(localStorage)に保存する。
 * 同期を設定している場合は sync.js がこの内容をサーバーとやり取りする。
 * そのため各レコードは
 *   updatedAt … 最終更新時刻（新しい方を採用して衝突を解決する）
 *   deleted   … 削除済みの印（削除も他端末へ伝えるため実体は残す）
 *   _dirty    … サーバー未送信の印
 * を持つ。
 */
(function (global) {
  'use strict';

  var KEY = 'juki-inspection-v1';
  var EPOCH = '1970-01-01T00:00:00.000Z';

  var state = null;
  var listeners = [];

  function emptyState() {
    return { sites: [], machines: [], inspections: [], settings: {} };
  }

  function load() {
    if (state) return state;
    try {
      var raw = localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : emptyState();
    } catch (e) {
      state = emptyState();
    }
    if (!state.sites) state.sites = [];
    if (!state.machines) state.machines = [];
    if (!state.inspections) state.inspections = [];
    if (!state.settings) state.settings = {};
    return state;
  }

  function persist(local) {
    try {
      localStorage.setItem(KEY, JSON.stringify(load()));
    } catch (e) {
      alert('保存できませんでした。端末の空き容量をご確認ください。\n' + e.message);
      return;
    }
    listeners.forEach(function (cb) {
      try { cb(local === undefined ? true : local); } catch (e) { /* 通知先の例外は無視 */ }
    });
  }

  /** データが変わったときに呼ばれる（引数 true = この端末の操作による変更） */
  function onChange(cb) { listeners.push(cb); }

  function nowIso() { return new Date().toISOString(); }

  function uid() {
    return (
      Date.now().toString(36).slice(-6) +
      Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0')
    );
  }

  function alive(o) { return o && !o.deleted; }

  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** 保存の共通処理。新規なら採番し、更新時刻と未送信フラグを立てる */
  function put(listName, obj) {
    var list = load()[listName];
    var existing = obj.id ? findIn(list, obj.id) : null;
    if (!obj.id) {
      obj.id = uid();
      obj.createdAt = nowIso();
    }
    obj.updatedAt = nowIso();
    obj.deleted = false;
    obj._dirty = true;
    if (existing) {
      list[list.indexOf(existing)] = obj;
    } else {
      list.push(obj);
    }
    return obj;
  }

  /** 削除は「削除済みの印」を付けて残す（他端末へ削除を伝えるため） */
  function tombstone(listName, id) {
    var obj = findIn(load()[listName], id);
    if (!obj || obj.deleted) return false;
    obj.deleted = true;
    obj.updatedAt = nowIso();
    obj._dirty = true;
    return true;
  }

  /* ---------------- 現場 ---------------- */
  function listSites() {
    return load().sites.filter(alive).sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '', 'ja');
    });
  }
  function getSite(id) {
    var s = findIn(load().sites, id);
    return alive(s) ? s : null;
  }
  function saveSite(site) {
    var r = put('sites', site);
    persist();
    return r;
  }
  function deleteSite(id) {
    tombstone('sites', id);
    load().machines.forEach(function (m) {
      if (m.siteId === id) tombstone('machines', m.id);
    });
    load().inspections.forEach(function (r) {
      if (r.siteId === id) tombstone('inspections', r.id);
    });
    persist();
  }

  /* ---------------- 重機 ---------------- */
  function listMachines(siteId) {
    return load().machines
      .filter(function (m) { return alive(m) && (!siteId || m.siteId === siteId); })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ja'); });
  }
  function getMachine(id) {
    var m = findIn(load().machines, id);
    return alive(m) ? m : null;
  }
  function saveMachine(machine) {
    var r = put('machines', machine);
    persist();
    return r;
  }
  function deleteMachine(id) {
    tombstone('machines', id);
    load().inspections.forEach(function (r) {
      if (r.machineId === id) tombstone('inspections', r.id);
    });
    persist();
  }

  /* ---------------- 点検記録 ---------------- */
  function listInspections(filter) {
    filter = filter || {};
    return load().inspections
      .filter(function (r) {
        if (!alive(r)) return false;
        if (filter.siteId && r.siteId !== filter.siteId) return false;
        if (filter.machineId && r.machineId !== filter.machineId) return false;
        if (filter.from && r.date < filter.from) return false;
        if (filter.to && r.date > filter.to) return false;
        return true;
      })
      .sort(function (a, b) {
        // 古い順（帳票は時系列、画面側は必要に応じて反転して新しい順に表示する）
        var k1 = (a.date || '') + (a.time || '');
        var k2 = (b.date || '') + (b.time || '');
        return k1 < k2 ? -1 : k1 > k2 ? 1 : 0;
      });
  }
  function getInspection(id) {
    var r = findIn(load().inspections, id);
    return alive(r) ? r : null;
  }
  function saveInspection(rec) {
    var r = put('inspections', rec);
    persist();
    return r;
  }
  function deleteInspection(id) {
    tombstone('inspections', id);
    persist();
  }

  /* ---------------- 設定 ---------------- */
  /** config.js の内容を既定値として、端末ごとの設定で上書きする */
  function getSettings() {
    var cfg = global.APP_CONFIG || {};
    var s = load().settings || {};
    return {
      baseUrl: s.baseUrl || cfg.baseUrl || '',
      company: s.company || cfg.company || '',
      // データのやり取り先。鍵はサーバー側にあり、ここには秘密の値を持たない
      apiBase: (s.apiBase !== undefined && s.apiBase !== null ? s.apiBase : cfg.apiBase) || '',
      turnstileSiteKey: s.turnstileSiteKey || cfg.turnstileSiteKey || '',
      syncEnabled: s.syncEnabled === undefined ? true : !!s.syncEnabled
    };
  }
  /** 端末ごとの上書き設定（config.js と同じ値なら保存しない） */
  function getLocalSettings() { return load().settings || {}; }
  function saveSettings(s) {
    load().settings = s;
    persist();
  }

  /* ---------------- QRペイロード ---------------- */
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(i + 1) - 0xdc00);
        i++;
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }
  function binaryToUtf8(bin) {
    var bytes = [];
    for (var i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i) & 0xff);
    var out = '';
    for (var j = 0; j < bytes.length; ) {
      var b = bytes[j];
      if (b < 0x80) { out += String.fromCharCode(b); j += 1; }
      else if (b < 0xe0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[j + 1] & 0x3f)); j += 2; }
      else if (b < 0xf0) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[j + 1] & 0x3f) << 6) | (bytes[j + 2] & 0x3f));
        j += 3;
      } else {
        var cp = ((b & 0x07) << 18) | ((bytes[j + 1] & 0x3f) << 12) | ((bytes[j + 2] & 0x3f) << 6) | (bytes[j + 3] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        j += 4;
      }
    }
    return out;
  }
  function b64urlEncode(str) {
    var bytes = utf8Bytes(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return binaryToUtf8(atob(s));
  }

  /**
   * QRに埋め込むペイロード。重機を特定できる情報を丸ごと入れることで、
   * サーバーもログインも無しに、初めての端末でも点検を開始できる。
   */
  function machinePayload(machine, site) {
    return {
      v: 1,
      s: site.id,
      sn: site.name,
      m: machine.id,
      mn: machine.name,
      t: machine.type,
      no: machine.serial || ''
    };
  }

  function machineUrl(machine, site) {
    var base = getSettings().baseUrl;
    if (!base) base = location.href.split('#')[0];
    return base + '#i=' + b64urlEncode(JSON.stringify(machinePayload(machine, site)));
  }

  /**
   * QRから開いたときに、その端末へ現場・重機を取り込む。
   * ここで作るのはQRに入っていた情報だけの「仮登録」なので、
   * updatedAt を最古にしておき、同期してきた正式なデータに必ず上書きされるようにする。
   */
  function importFromPayload(payload) {
    var st = load();
    var changed = false;
    var site = getSite(payload.s);
    if (!site) {
      site = {
        id: payload.s, name: payload.sn || '（現場名なし）',
        createdAt: nowIso(), updatedAt: EPOCH, deleted: false, _dirty: false
      };
      st.sites.push(site);
      changed = true;
    }
    var machine = getMachine(payload.m);
    if (!machine) {
      machine = {
        id: payload.m, siteId: payload.s, name: payload.mn || '（重機名なし）',
        type: payload.t || 'other', serial: payload.no || '',
        createdAt: nowIso(), updatedAt: EPOCH, deleted: false, _dirty: false
      };
      st.machines.push(machine);
      changed = true;
    }
    if (changed) persist(false);
    return { site: site, machine: machine };
  }

  /* ---------------- 取り込み（衝突の解決） ---------------- */
  /**
   * 1件分の取り込み。更新時刻の新しい方を採用しつつ、
   * 新しい側で空になっている項目は古い側の値で補う（QR仮登録で情報が消えないように）。
   * 取り込んだ内容で変化があれば true を返す。
   */
  function mergeRecord(listName, incoming) {
    var list = load()[listName];
    var cur = findIn(list, incoming.id);
    if (!cur) {
      incoming._dirty = false;
      list.push(incoming);
      return true;
    }
    var incNewer = (incoming.updatedAt || '') > (cur.updatedAt || '');
    if (!incNewer) return false;

    var newer = incoming, older = cur;
    var merged = {};
    Object.keys(older).forEach(function (k) { merged[k] = older[k]; });
    Object.keys(newer).forEach(function (k) {
      if (k === '_dirty') return;
      var v = newer[k];
      if (v === '' || v === null || v === undefined) return; // 空欄は古い方の値を残す
      merged[k] = v;
    });
    merged.deleted = !!newer.deleted;
    merged.updatedAt = newer.updatedAt;
    merged._dirty = false; // 新しい方（＝サーバー側）を採用したので送信不要
    list[list.indexOf(cur)] = merged;
    return true;
  }

  /** 同期・ファイル取り込みの両方から使う（local=false なら自分の変更ではない） */
  function mergeAll(records, local) {
    var changed = 0;
    ['sites', 'machines', 'inspections'].forEach(function (key) {
      (records[key] || []).forEach(function (o) {
        if (o && o.id && mergeRecord(key, o)) changed++;
      });
    });
    if (changed) persist(local === undefined ? false : local);
    return changed;
  }

  /** 未送信のレコードを取り出す */
  function pendingRecords() {
    var st = load();
    var out = [];
    ['sites', 'machines', 'inspections'].forEach(function (key) {
      st[key].forEach(function (o) {
        if (o._dirty) out.push({ kind: key, record: o });
      });
    });
    return out;
  }

  /** 送信済みにする */
  function markSynced(ids) {
    var st = load();
    var set = {};
    ids.forEach(function (id) { set[id] = true; });
    ['sites', 'machines', 'inspections'].forEach(function (key) {
      st[key].forEach(function (o) { if (set[o.id]) o._dirty = false; });
    });
    persist(false);
  }

  /* ---------------- バックアップ ---------------- */
  function exportJson() {
    return JSON.stringify(load(), null, 2);
  }

  function importJson(text, mode) {
    var incoming = JSON.parse(text);
    if (!incoming || !incoming.sites || !incoming.machines || !incoming.inspections) {
      throw new Error('このファイルはこのアプリのバックアップではありません。');
    }
    if (mode === 'replace') {
      state = {
        sites: incoming.sites, machines: incoming.machines,
        inspections: incoming.inspections, settings: incoming.settings || {}
      };
      persist();
      return { sites: incoming.sites.length, machines: incoming.machines.length, inspections: incoming.inspections.length };
    }
    var before = {
      sites: listSites().length, machines: listMachines().length, inspections: listInspections().length
    };
    // 古いバックアップには updatedAt が無いので、取り込めるように補う
    ['sites', 'machines', 'inspections'].forEach(function (key) {
      incoming[key].forEach(function (o) {
        if (!o.updatedAt) o.updatedAt = o.createdAt || EPOCH;
        o._dirty = true;
      });
    });
    mergeAll(incoming, true);
    return {
      sites: listSites().length - before.sites,
      machines: listMachines().length - before.machines,
      inspections: listInspections().length - before.inspections
    };
  }

  function clearAll() {
    state = emptyState();
    persist();
  }

  function counts() {
    return {
      sites: listSites().length,
      machines: listMachines().length,
      inspections: listInspections().length,
      pending: pendingRecords().length
    };
  }

  global.Store = {
    listSites: listSites, getSite: getSite, saveSite: saveSite, deleteSite: deleteSite,
    listMachines: listMachines, getMachine: getMachine, saveMachine: saveMachine, deleteMachine: deleteMachine,
    listInspections: listInspections, getInspection: getInspection, saveInspection: saveInspection,
    deleteInspection: deleteInspection,
    getSettings: getSettings, getLocalSettings: getLocalSettings, saveSettings: saveSettings,
    machineUrl: machineUrl, machinePayload: machinePayload, importFromPayload: importFromPayload,
    b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode,
    exportJson: exportJson, importJson: importJson, clearAll: clearAll,
    mergeAll: mergeAll, pendingRecords: pendingRecords, markSynced: markSynced,
    onChange: onChange, counts: counts, uid: uid
  };
})(window);
