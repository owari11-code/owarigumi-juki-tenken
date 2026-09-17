/*
 * store.js - 端末内のデータ保存（IndexedDB）
 *
 * 画面は、まず端末内のデータを読み書きする（電波が無い現場でも記録できるように）。
 * サーバーとのやり取りは sync.js が行う。各記録は
 *   updatedAt … 最終更新時刻（新しい方を採用して食い違いを解決する）
 *   deleted   … 削除済みの印（削除も他の端末へ伝えるため、実体は残す）
 *   _dirty    … サーバーへ未送信の印
 *   _rejected … サーバーが受け付けなかった理由（あれば画面で知らせる）
 * を持つ。
 */
(function (global) {
  'use strict';

  var DB_NAME = 'maruten-cloud';
  var DB_VERSION = 1;

  var KINDS = [
    'sites', 'machines', 'targets', 'inspections', 'materials', 'stock_logs', 'machine_logs',
    'tools', 'lends', 'tasks', 'progress_logs', 'staff', 'assignments'
  ];

  var maps = {};
  var cache = {};
  var meta = {};
  var listeners = [];
  var db = null;
  var persistent = false;
  var dirtyKeys = new Set();
  var dirtyMeta = new Set();
  var flushTimer = null;

  KINDS.forEach(function (k) { maps[k] = new Map(); });

  function nowIso() { return new Date().toISOString(); }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error('no indexedDB'));
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
  }

  function getAll(storeName) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readonly');
      var req = tx.objectStore(storeName).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var ready = openDb().then(function (d) {
    db = d;
    persistent = true;
    return Promise.all([getAll('records'), getAll('meta')]);
  }).then(function (res) {
    res[0].forEach(function (row) {
      if (maps[row.kind] && row.rec && row.rec.id) maps[row.kind].set(row.rec.id, row.rec);
    });
    res[1].forEach(function (row) { meta[row.k] = row.v; });
  })['catch'](function (e) {
    // 保存できない環境（一部のプライベートモード等）では、開いている間だけ使える
    persistent = false;
    if (global.console) console.warn('IndexedDB を使えません', e);
  });

  function scheduleFlush() {
    if (!persistent) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 40);
  }

  function flush() {
    if (!persistent || (!dirtyKeys.size && !dirtyMeta.size)) return Promise.resolve();
    var keys = Array.from(dirtyKeys);
    var metaKeys = Array.from(dirtyMeta);
    dirtyKeys.clear();
    dirtyMeta.clear();
    return new Promise(function (resolve) {
      var tx;
      try {
        tx = db.transaction(['records', 'meta'], 'readwrite');
      } catch (e) {
        resolve();
        return;
      }
      var rs = tx.objectStore('records');
      var ms = tx.objectStore('meta');
      keys.forEach(function (key) {
        var p = key.indexOf('|');
        var kind = key.slice(0, p), id = key.slice(p + 1);
        var rec = maps[kind] && maps[kind].get(id);
        if (rec) rs.put({ key: key, kind: kind, rec: rec });
        else rs['delete'](key);
      });
      metaKeys.forEach(function (k) {
        if (meta[k] === undefined) ms['delete'](k);
        else ms.put({ k: k, v: meta[k] });
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () {
        if (global.console) console.error('保存に失敗しました', tx.error);
        resolve();
      };
    });
  }

  function touched(kind, id) {
    cache[kind] = null;
    dirtyKeys.add(kind + '|' + id);
    scheduleFlush();
  }

  function notify(local) {
    listeners.forEach(function (cb) {
      try { cb(local); } catch (e) { if (global.console) console.error(e); }
    });
  }

  function check(kind) {
    if (!maps[kind]) throw new Error('unknown kind ' + kind);
  }

  /* ---------------- 読む ---------------- */
  function alive(o) { return !!o && !o.deleted; }

  function built(kind) {
    check(kind);
    if (!cache[kind]) {
      var list = [];
      var bySite = new Map();
      maps[kind].forEach(function (o) {
        if (!alive(o)) return;
        list.push(o);
        if (o.siteId) {
          if (!bySite.has(o.siteId)) bySite.set(o.siteId, []);
          bySite.get(o.siteId).push(o);
        }
      });
      cache[kind] = { list: list, bySite: bySite };
    }
    return cache[kind];
  }

  function get(kind, id) {
    check(kind);
    var o = maps[kind].get(id);
    return alive(o) ? o : null;
  }

  /** 生きている記録の一覧。pred で絞り込み、siteId を渡すとその現場のものだけ */
  function list(kind, pred, siteId) {
    var b = built(kind);
    var base = siteId ? (b.bySite.get(siteId) || []) : b.list;
    return pred ? base.filter(pred) : base.slice();
  }

  function raw(kind, id) {
    check(kind);
    return maps[kind].get(id) || null;
  }

  /* ---------------- 書く（この端末の操作） ---------------- */
  function put(kind, obj) {
    check(kind);
    if (!obj.id) {
      obj.id = MT.util.uid();
      obj.createdAt = nowIso();
    }
    obj.updatedAt = nowIso();
    obj.deleted = false;
    obj._dirty = true;
    delete obj._rejected;
    maps[kind].set(obj.id, obj);
    touched(kind, obj.id);
    notify(true);
    return obj;
  }

  /** 複数をまとめて保存（通知は1回） */
  function putMany(items) {
    items.forEach(function (it) {
      var obj = it.record;
      if (!obj.id) {
        obj.id = MT.util.uid();
        obj.createdAt = nowIso();
      }
      obj.updatedAt = nowIso();
      obj.deleted = false;
      obj._dirty = true;
      delete obj._rejected;
      maps[it.kind].set(obj.id, obj);
      touched(it.kind, obj.id);
    });
    if (items.length) notify(true);
  }

  function remove(kind, id) {
    check(kind);
    var o = maps[kind].get(id);
    if (!o || o.deleted) return false;
    o.deleted = true;
    o.updatedAt = nowIso();
    o._dirty = true;
    touched(kind, id);
    notify(true);
    return true;
  }

  /* ---------------- 取り込み（サーバーから） ---------------- */
  /**
   * 1件分の取り込み。更新時刻の新しい方を採用する（丸ごと置き換える）。
   * この端末に未送信の新しい変更があれば、そちらを残して後で送る。
   * 同じ時刻でも、送信済みならサーバー側の内容（記録者の名前など）にそろえる。
   */
  function mergeOne(kind, incoming) {
    var cur = maps[kind].get(incoming.id);
    incoming._dirty = false;
    if (!cur) {
      maps[kind].set(incoming.id, incoming);
      touched(kind, incoming.id);
      return true;
    }
    var incT = incoming.updatedAt || '';
    var curT = cur.updatedAt || '';
    if (incT < curT) return false;
    if (incT === curT) {
      if (cur._dirty) return false;
      var a = Object.assign({}, cur);
      delete a._dirty;
      delete a._rejected;
      var b = Object.assign({}, incoming);
      delete b._dirty;
      if (JSON.stringify(a) === JSON.stringify(b)) return false;
    }
    maps[kind].set(incoming.id, incoming);
    touched(kind, incoming.id);
    return true;
  }

  /** rows = [{ id, kind, data, deleted }]（サーバーの形のまま） */
  function mergeRows(rows) {
    var changed = 0;
    rows.forEach(function (row) {
      if (!maps[row.kind] || !row.data) return;
      var rec = {};
      Object.keys(row.data).forEach(function (k) { rec[k] = row.data[k]; });
      rec.id = row.id;
      rec.deleted = !!row.deleted;
      if (!rec.updatedAt) rec.updatedAt = '1970-01-01T00:00:00.000Z';
      if (mergeOne(row.kind, rec)) changed++;
    });
    if (changed) notify(false);
    return changed;
  }

  function pending(kinds) {
    var out = [];
    (kinds || KINDS).forEach(function (kind) {
      maps[kind].forEach(function (o) {
        if (o._dirty) out.push({ kind: kind, record: o });
      });
    });
    return out;
  }

  function markSynced(ids, kindById) {
    ids.forEach(function (id) {
      var kind = kindById[id];
      var o = kind && maps[kind].get(id);
      if (o) {
        o._dirty = false;
        delete o._rejected;
        delete o._unapprove;   // 取り消しの指示は、送った時点で役目を終える
        touched(kind, id);
      }
    });
    notify(false);
  }

  function markRejected(list, kindById) {
    list.forEach(function (r) {
      var kind = kindById[r.id];
      var o = kind && maps[kind].get(r.id);
      if (o) {
        o._dirty = false;
        o._rejected = r.code || 'rejected';
        touched(kind, r.id);
      }
    });
    if (list.length) notify(false);
  }

  function rejected() {
    var out = [];
    KINDS.forEach(function (kind) {
      maps[kind].forEach(function (o) { if (o._rejected) out.push({ kind: kind, record: o }); });
    });
    return out;
  }

  /* ---------------- 端末ごとの控え（同期の位置など） ---------------- */
  function getMeta(k) { return meta[k]; }
  function setMeta(k, v) {
    if (v === undefined) delete meta[k];
    else meta[k] = v;
    dirtyMeta.add(k);
    scheduleFlush();
  }

  /** すべて消す（keepPending なら未送信の記録だけ残す） */
  function clear(keepPending) {
    KINDS.forEach(function (kind) {
      maps[kind].forEach(function (o, id) {
        if (keepPending && o._dirty) return;
        maps[kind]['delete'](id);
        dirtyKeys.add(kind + '|' + id);
      });
      cache[kind] = null;
    });
    Object.keys(meta).forEach(function (k) {
      delete meta[k];
      dirtyMeta.add(k);
    });
    scheduleFlush();
    notify(false);
  }

  /**
   * ある現場のデータを、この端末からだけ消す（サーバーには何も送らない）。
   * QRが使えなくなった現場や、端末から外した現場のデータを残さないため。
   * 未送信の記録は消さない。
   */
  function purgeSite(siteId) {
    var n = 0;
    KINDS.forEach(function (kind) {
      maps[kind].forEach(function (o, id) {
        var mine = kind === 'sites' ? id === siteId : o.siteId === siteId;
        if (!mine || o._dirty) return;
        maps[kind]['delete'](id);
        dirtyKeys.add(kind + '|' + id);
        n++;
      });
      cache[kind] = null;
    });
    if (n) {
      scheduleFlush();
      notify(false);
    }
    return n;
  }

  function counts() {
    var c = {};
    KINDS.forEach(function (k) { c[k] = built(k).list.length; });
    c.pending = pending().length;
    return c;
  }

  function onChange(cb) { listeners.push(cb); }

  function exportAll() {
    var out = { exportedAt: nowIso(), app: 'maruten-cloud', data: {} };
    KINDS.forEach(function (kind) {
      out.data[kind] = [];
      maps[kind].forEach(function (o) { out.data[kind].push(o); });
    });
    return JSON.stringify(out, null, 1);
  }

  global.MT = global.MT || {};
  global.MT.store = {
    KINDS: KINDS,
    ready: ready,
    isPersistent: function () { return persistent; },
    get: get,
    raw: raw,
    list: list,
    put: put,
    putMany: putMany,
    remove: remove,
    mergeRows: mergeRows,
    pending: pending,
    markSynced: markSynced,
    markRejected: markRejected,
    rejected: rejected,
    getMeta: getMeta,
    setMeta: setMeta,
    clear: clear,
    purgeSite: purgeSite,
    counts: counts,
    onChange: onChange,
    flush: flush,
    exportAll: exportAll
  };
})(window);
