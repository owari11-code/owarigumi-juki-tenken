/*
 * util.js - 画面側で共通に使う小道具
 */
(function (global) {
  'use strict';

  var U = {};

  U.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.nl2br = function (s) { return U.esc(s).replace(/\n/g, '<br>'); };

  U.pad = function (n) { return (n < 10 ? '0' : '') + n; };

  /* ---------------- 日付（端末の時刻で扱う） ---------------- */
  U.dateStr = function (d) {
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };
  U.todayStr = function () { return U.dateStr(new Date()); };
  U.nowTimeStr = function () {
    var d = new Date();
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  };
  U.isDate = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); };
  U.parseDate = function (s) {
    if (!U.isDate(s)) return null;
    return new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  };
  U.addDays = function (s, n) {
    var d = U.parseDate(s);
    if (!d) return '';
    d.setDate(d.getDate() + n);
    return U.dateStr(d);
  };
  /** a から b まで何日か（b が後なら正） */
  U.diffDays = function (a, b) {
    var x = U.parseDate(a), y = U.parseDate(b);
    if (!x || !y) return null;
    return Math.round((y - x) / 86400000);
  };
  U.formatDate = function (s) {
    if (!U.isDate(s)) return s || '';
    return Number(s.slice(0, 4)) + '年' + Number(s.slice(5, 7)) + '月' + Number(s.slice(8, 10)) + '日';
  };
  U.formatShort = function (s) {
    if (!U.isDate(s)) return s || '';
    return Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10));
  };
  U.weekday = function (s) {
    var d = U.parseDate(s);
    return d ? '日月火水木金土'.charAt(d.getDay()) : '';
  };
  U.isYm = function (v) { return /^\d{4}-\d{2}$/.test(v || ''); };
  U.thisMonth = function () { return U.todayStr().slice(0, 7); };
  U.ymLabel = function (ym) { return Number(ym.slice(0, 4)) + '年' + Number(ym.slice(5, 7)) + '月'; };
  U.daysInMonth = function (ym) {
    var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    return y && m ? new Date(y, m, 0).getDate() : 31;
  };
  U.addMonths = function (ym, n) {
    var d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1);
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1);
  };
  /** 確認時刻などのISO（世界時）を、端末の時刻で表示する */
  U.formatStamp = function (iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return { date: String(iso || '').slice(0, 10), time: '' };
    return {
      date: d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日',
      time: U.pad(d.getHours()) + ':' + U.pad(d.getMinutes())
    };
  };
  U.periodText = function (from, to) {
    if (!from && !to) return '';
    return U.formatDate(from) + ' 〜 ' + U.formatDate(to);
  };

  /* ---------------- 数値 ---------------- */
  U.num = function (v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  };
  U.fmtNum = function (n, maxDigits) {
    if (n === null || n === undefined || !isFinite(n)) return '－';
    var d = maxDigits === undefined ? 2 : maxDigits;
    var r = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return r.toLocaleString('ja-JP', { maximumFractionDigits: d });
  };
  U.clamp = function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); };

  /* ---------------- 識別子・鍵 ---------------- */
  function randomBytes(n) {
    var a = new Uint8Array(n);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return a;
  }
  /** 記録の識別子（時刻＋乱数。端末どうしで重ならない） */
  U.uid = function () {
    var r = randomBytes(6), s = '';
    for (var i = 0; i < r.length; i++) s += (r[i] % 36).toString(36);
    return Date.now().toString(36) + s;
  };
  function b64urlBytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  /** QRコードの鍵（推測できない長さの乱数） */
  U.randomKey = function () { return b64urlBytes(randomBytes(24)); };

  U.b64urlEncode = function (str) {
    return b64urlBytes(new TextEncoder().encode(str));
  };
  U.b64urlDecode = function (str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };

  /* ---------------- 画面 ---------------- */
  U.app = function () { return document.getElementById('app'); };
  U.qs = function (sel, root) { return (root || U.app()).querySelector(sel); };
  U.qsa = function (sel, root) { return Array.prototype.slice.call((root || U.app()).querySelectorAll(sel)); };
  U.val = function (sel, root) {
    var el = U.qs(sel, root);
    return el ? String(el.value).trim() : '';
  };
  U.checked = function (sel, root) {
    var el = U.qs(sel, root);
    return !!(el && el.checked);
  };
  U.on = function (sel, ev, fn, root) {
    var el = U.qs(sel, root);
    if (el) el.addEventListener(ev, fn);
    return el;
  };
  U.go = function (hash) { location.hash = hash; };

  U.toast = function (msg, kind) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(U.toast._t);
    U.toast._t = setTimeout(function () { el.hidden = true; }, 2800);
  };

  /** ハッシュを { path:[], params:{} } に分ける */
  U.parseHash = function () {
    var h = location.hash || '';
    if (h.indexOf('#q=') === 0) return { qr: h.slice(3), path: [], params: {} };
    if (h.indexOf('#i=') === 0) return { legacyQr: true, path: [], params: {} };
    h = h.replace(/^#\/?/, '');
    var parts = h.split('?');
    var path = parts[0] ? parts[0].split('/').filter(Boolean).map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    }) : [];
    var params = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        try {
          if (i < 0) params[decodeURIComponent(kv)] = '';
          else params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
        } catch (e) { /* 壊れた値は無視 */ }
      });
    }
    return { path: path, params: params };
  };

  U.query = function (obj) {
    var q = Object.keys(obj).filter(function (k) {
      return obj[k] !== undefined && obj[k] !== null && obj[k] !== '';
    }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
    });
    return q.length ? '?' + q.join('&') : '';
  };

  U.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  };

  /** 並べ替え（日本語の読み順） */
  U.byName = function (a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
  };
  U.byDateAsc = function (a, b) {
    var k1 = (a.date || '') + (a.time || '') + (a.createdAt || '');
    var k2 = (b.date || '') + (b.time || '') + (b.createdAt || '');
    return k1 < k2 ? -1 : k1 > k2 ? 1 : 0;
  };

  global.MT = global.MT || {};
  global.MT.util = U;
})(window);
