/*
 * ui/sign.js - 自筆サイン（タッチペン・指・マウス）
 *
 * 自筆の欄をタッチすると全画面の記入台が開き、書き終えると欄に戻る。
 * 保存するのは画像ではなく「線の通り道」（SVGのパス）にしている。
 *   ・1人分が数キロバイトで済むため、KY活動表の12人分でも1件に収まる
 *   ・拡大しても印刷しても、線がぼやけない
 * 書いた線の外側は切り落とすので、記入台のどこに書いても、欄いっぱいに入る。
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var esc = U.esc;

  var MAX_SIDE = 480;      // 保存する座標の大きさ（長い方をこの値にそろえる）
  var MAX_PATH = 3000;     // サイン1つの上限（文字数）。超えるときは点を間引く
  var INK = '#101418';
  var D_OK = /^[MLCQmlcq0-9 .,-]+$/;

  var values = {};         // 欄の名前 → サイン
  var labels = {};

  /* ------------------------------------------------------------------ *
   * 保存されている値の点検（他の端末から届いた値も通すため）
   * ------------------------------------------------------------------ */
  function posNum(v, max) {
    var n = U.num(v);
    return n !== null && n > 0 && n <= max ? n : null;
  }

  function norm(sig) {
    if (!sig || typeof sig !== 'object') return null;
    var w = posNum(sig.w, 4000), h = posNum(sig.h, 4000), lw = posNum(sig.lw, 200);
    var d = typeof sig.d === 'string' ? sig.d : '';
    if (!w || !h || !lw || !d || d.length > 9000 || !D_OK.test(d)) return null;
    return { w: w, h: h, lw: lw, d: d };
  }

  /* ------------------------------------------------------------------ *
   * 線の通り道を短くする（ダグラス・ポーカー法）
   * ------------------------------------------------------------------ */
  function distToSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = dx * dx + dy * dy;
    var t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var ex = a.x + t * dx - p.x, ey = a.y + t * dy - p.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  function thin(pts, eps) {
    if (pts.length < 3) return pts.slice();
    var keep = [];
    var i;
    for (i = 0; i < pts.length; i++) keep.push(false);
    keep[0] = keep[pts.length - 1] = true;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1], best = -1, bd = eps;
      for (i = a + 1; i < b; i++) {
        var d = distToSeg(pts[i], pts[a], pts[b]);
        if (d > bd) { bd = d; best = i; }
      }
      if (best >= 0) { keep[best] = true; stack.push([a, best]); stack.push([best, b]); }
    }
    return pts.filter(function (p, k) { return keep[k]; });
  }

  /**
   * 点の並びを、なめらかな曲線のパスにする。
   * 曲線は必ず元の点の上を通す（間引いたあとでも、書いた形がくずれないように）。
   */
  function pathOf(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return 'M' + pts[0].x + ' ' + pts[0].y + 'l0 0';   // 点（丸い線端で丸くなる）
    var d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (var i = 0; i < pts.length - 1; i++) {
      var back = pts[i - 1] || pts[i];
      var a = pts[i], b = pts[i + 1];
      var fwd = pts[i + 2] || b;
      d += 'C' + Math.round(a.x + (b.x - back.x) / 6) + ' ' + Math.round(a.y + (b.y - back.y) / 6) +
        ' ' + Math.round(b.x - (fwd.x - a.x) / 6) + ' ' + Math.round(b.y - (fwd.y - a.y) / 6) +
        ' ' + b.x + ' ' + b.y;
    }
    return d;
  }

  /** 書かれた線を、書いた範囲だけ切り取って保存の形にする */
  function toSig(strokes, lw) {
    var all = [];
    strokes.forEach(function (s) { all = all.concat(s); });
    if (!all.length) return null;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    var pad = lw / 2 + 1;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    var k = MAX_SIDE / Math.max(maxX - minX, maxY - minY);
    var w = Math.max(1, Math.round((maxX - minX) * k));
    var h = Math.max(1, Math.round((maxY - minY) * k));
    var moved = strokes.map(function (s) {
      return s.map(function (p) {
        return { x: Math.round((p.x - minX) * k), y: Math.round((p.y - minY) * k) };
      });
    });

    var eps = 1, d = '';
    for (var tries = 0; tries < 6; tries++) {
      d = moved.map(function (s) { return pathOf(thin(s, eps)); }).join('');
      if (d.length <= MAX_PATH) break;
      eps *= 1.8;
    }
    return { w: w, h: h, lw: Math.round(lw * k * 10) / 10, d: d };
  }

  /* ------------------------------------------------------------------ *
   * 表示（画面・印刷とも同じ形）
   * ------------------------------------------------------------------ */
  var Sign = {};

  Sign.isEmpty = function (sig) { return !norm(sig); };

  /** サインをそのまま出す。色は文字色に合わせる（印刷は黒になる） */
  Sign.svg = function (sig, cls) {
    var s = norm(sig);
    if (!s) return '';
    return '<svg class="sign-ink' + (cls ? ' ' + esc(cls) : '') + '" viewBox="0 0 ' + s.w + ' ' + s.h +
      '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="サイン" focusable="false">' +
      '<path d="' + esc(s.d) + '" fill="none" stroke="currentColor" stroke-width="' + s.lw +
      '" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  };

  /** サインが無ければ、入力された氏名を代わりに出す */
  Sign.inkOr = function (sig, name) {
    var s = norm(sig);
    return s ? '<span class="sign-cell">' + Sign.svg(s) + '</span>' : esc(name || '');
  };

  /* ------------------------------------------------------------------ *
   * 入力欄
   * ------------------------------------------------------------------ */
  /** 画面を組み立て直すたびに、最初に呼ぶ */
  Sign.reset = function () { values = {}; labels = {}; };

  function slotHtml(sig, placeholder) {
    return sig ? Sign.svg(sig)
      : '<span class="sign-ph">' + esc(placeholder || 'ここをタッチして署名') + '</span>';
  }

  /** o = { label, value, placeholder } */
  Sign.boxHtml = function (id, o) {
    o = o || {};
    var sig = norm(o.value);
    values[id] = sig;
    labels[id] = o.label || 'サイン';
    return '<div class="sign-box" data-sign="' + esc(id) + '">' +
      '<button type="button" class="sign-open" data-sign-open="' + esc(id) + '">' +
      '<span class="sign-slot" data-ph="' + esc(o.placeholder || '') + '">' +
      slotHtml(sig, o.placeholder) + '</span></button>' +
      '<button type="button" class="sign-clear" data-sign-clear="' + esc(id) + '"' +
      (sig ? '' : ' hidden') + '>消す</button></div>';
  };

  Sign.get = function (id) { return values[id] || null; };

  Sign.set = function (id, sig) {
    values[id] = norm(sig);
    var box = document.querySelector('[data-sign="' + String(id).replace(/"/g, '') + '"]');
    if (!box) return;
    var slot = box.querySelector('.sign-slot');
    var clear = box.querySelector('.sign-clear');
    if (slot) slot.innerHTML = slotHtml(values[id], slot.getAttribute('data-ph'));
    if (clear) clear.hidden = !values[id];
  };

  /* ------------------------------------------------------------------ *
   * 記入台（全画面）
   * ------------------------------------------------------------------ */
  var pad = null;

  function closePad() {
    if (!pad) return;
    if (pad.el.parentNode) pad.el.parentNode.removeChild(pad.el);
    document.body.style.overflow = pad.overflow;
    global.removeEventListener('resize', pad.onResize);
    pad = null;
  }

  function openPad(id) {
    closePad();
    var el = document.createElement('div');
    el.className = 'sign-overlay no-print';
    el.innerHTML =
      '<div class="sign-sheet">' +
      '<div class="sign-head"><span class="sign-title">' + esc(labels[id] || 'サイン') + '</span>' +
      '<button type="button" class="sign-x" data-act="cancel" aria-label="やめる">×</button></div>' +
      '<div class="sign-area"><canvas></canvas><span class="sign-base"></span>' +
      '<span class="sign-hint">この線の上に署名してください' +
      '<small>指・タッチペン・マウスで書けます</small></span></div>' +
      '<div class="sign-actions">' +
      '<button type="button" class="btn plain" data-act="undo">1つ戻す</button>' +
      '<button type="button" class="btn plain" data-act="clear">全部消す</button>' +
      '<button type="button" class="btn lead" data-act="ok">これでOK</button>' +
      '</div></div>';
    document.body.appendChild(el);

    var area = el.querySelector('.sign-area');
    var canvas = el.querySelector('canvas');
    var hint = el.querySelector('.sign-hint');
    var ctx = canvas.getContext('2d');
    var strokes = [];
    var cur = null;
    var size = { w: 0, h: 0 };
    var lw = 3;

    function style() {
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
    }

    function drawStroke(pts) {
      if (!pts.length) return;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, lw / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(pts[i].x, pts[i].y,
          (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
    }

    function repaint() {
      ctx.clearRect(0, 0, size.w, size.h);
      style();
      strokes.forEach(drawStroke);
      hint.hidden = strokes.length > 0;
    }

    function fit() {
      var r = area.getBoundingClientRect();
      var w = Math.max(80, Math.round(r.width)), h = Math.max(80, Math.round(r.height));
      var k = size.w ? Math.min(w / size.w, h / size.h) : 1;
      if (size.w && k !== 1) {
        strokes = strokes.map(function (s) {
          return s.map(function (p) { return { x: p.x * k, y: p.y * k }; });
        });
      }
      size = { w: w, h: h };
      lw = Math.max(2.5, Math.min(5, h / 60));
      var dpr = global.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      repaint();
    }

    /* 書いている間は、伸びた先だけを描き足す（古い端末でも遅れないように） */
    function drawTip(pts) {
      style();
      var n = pts.length;
      if (n === 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
        return;
      }
      var p0 = pts[n - 3], p1 = pts[n - 2], p2 = pts[n - 1];
      ctx.beginPath();
      ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      ctx.stroke();
    }

    function at(ev) {
      var r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function add(p) {
      var last = cur[cur.length - 1];
      if (last && Math.abs(p.x - last.x) < 0.7 && Math.abs(p.y - last.y) < 0.7) return;
      cur.push(p);
      if (cur.length >= 2) drawTip(cur);
    }

    canvas.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
      }
      cur = [at(ev)];
      strokes.push(cur);
      hint.hidden = true;
      style();
      drawStroke(cur);
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (!cur) return;
      ev.preventDefault();
      var list = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
      if (list && list.length) list.forEach(function (e2) { add(at(e2)); });
      else add(at(ev));
    });

    function end() {
      if (!cur) return;
      cur = null;
      repaint();
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    el.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!b && ev.target !== el) return;
      var act = b ? b.getAttribute('data-act') : 'cancel';
      if (act === 'undo') { strokes.pop(); repaint(); return; }
      if (act === 'clear') { strokes = []; repaint(); return; }
      if (act === 'ok') {
        Sign.set(id, toSig(strokes, lw));
        closePad();
        return;
      }
      closePad();
    });

    pad = { el: el, overflow: document.body.style.overflow, onResize: fit };
    document.body.style.overflow = 'hidden';
    global.addEventListener('resize', pad.onResize);
    fit();
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-sign-open],[data-sign-clear]') : null;
    if (!t) return;
    ev.preventDefault();
    var open = t.getAttribute('data-sign-open');
    if (open !== null) return openPad(open);
    Sign.set(t.getAttribute('data-sign-clear'), null);
  });

  document.addEventListener('keydown', function (ev) {
    if (pad && ev.key === 'Escape') closePad();
  });
  global.addEventListener('hashchange', closePad);

  MT.sign = Sign;
})(window);
