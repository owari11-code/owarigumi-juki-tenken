/*
 * views/scan.js - QRコードの読み取り（カメラ）
 * 端末に読み取り機能（BarcodeDetector）があれば使い、無ければ自前の解析（qrdecode.js）で読む。
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var esc = U.esc;

  var scan = null;

  MT.stopScan = function () {
    if (!scan) return;
    clearTimeout(scan.timer);
    if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
    scan = null;
  };

  function status(msg, cls) {
    var el = document.getElementById('scan-status');
    if (el) {
      el.className = 'scan-status' + (cls ? ' ' + cls : '');
      el.innerHTML = msg;
    }
  }

  function failed(msg) {
    MT.stopScan();
    status(msg, 'error');
    var box = document.getElementById('scan-actions');
    if (box) {
      box.innerHTML = '<button class="btn secondary" id="b-retry">もう一度試す</button><a class="btn plain" href="#/">ホームへ</a>';
      U.on('#b-retry', 'click', function () { MT.rerender(); });
    }
  }

  function addTorch(stream) {
    var track = stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;
    var caps;
    try { caps = track.getCapabilities(); } catch (e) { return; }
    if (!caps || !caps.torch) return;
    var box = document.getElementById('scan-actions');
    if (!box) return;
    var on = false;
    box.innerHTML = '<button class="btn secondary" id="b-torch">ライトを点ける</button>';
    U.on('#b-torch', 'click', function () {
      on = !on;
      track.applyConstraints({ advanced: [{ torch: on }] }).then(function () {
        var b = document.getElementById('b-torch');
        if (b) b.textContent = on ? 'ライトを消す' : 'ライトを点ける';
      }, function () { U.toast('ライトを操作できませんでした'); });
    });
  }

  function found(text) {
    MT.stopScan();
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* 無視 */ } }
    var idx = text.indexOf('#q=');
    if (idx >= 0) {
      status('読み取りました。開いています…');
      location.hash = '#q=' + text.slice(idx + 3);
      return;
    }
    if (text.indexOf('#i=') >= 0) {
      return failed('古い形式のQRコードです。事務所で新しいQRコードを印刷してもらってください。');
    }
    failed('このQRコードは、マル点のQRコードではありません。<br><span class="muted">読み取った内容：' + esc(text.slice(0, 120)) + '</span>');
  }

  function tick() {
    if (!scan) return;
    var video = document.getElementById('scan-video');
    if (!video || !scan.stream) return;
    if (video.readyState < 2 || !video.videoWidth) {
      scan.timer = setTimeout(tick, 120);
      return;
    }
    if (!scan.canvas) {
      scan.canvas = document.createElement('canvas');
      scan.ctx = scan.canvas.getContext('2d', { willReadFrequently: true });
    }
    var scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    var cw = Math.round(video.videoWidth * scale), ch = Math.round(video.videoHeight * scale);
    if (scan.canvas.width !== cw) { scan.canvas.width = cw; scan.canvas.height = ch; }
    scan.ctx.drawImage(video, 0, 0, cw, ch);

    function next() { if (scan) scan.timer = setTimeout(tick, 120); }

    if (scan.detector) {
      scan.detector.detect(scan.canvas).then(function (codes) {
        if (codes && codes.length && codes[0].rawValue) return found(codes[0].rawValue);
        next();
      }, function () {
        if (scan) scan.detector = null;
        next();
      });
      return;
    }
    var text = null;
    try {
      var res = global.QRDecode.decodeImageData(scan.ctx.getImageData(0, 0, cw, ch));
      if (res) text = res.text;
    } catch (e) { /* 解析できないコマは飛ばす */ }
    if (text) return found(text);
    next();
  }

  MT.route('scan', { access: 'public' }, function () {
    U.app().innerHTML = UI.backLink('#/', 'ホームへ') + UI.pageHead('SCAN', 'QRを読み取る') +
      '<div class="scan-frame"><video id="scan-video" playsinline muted autoplay></video>' +
      '<div class="scan-guide"><i></i><i></i><i></i><i></i></div></div>' +
      '<p id="scan-status" class="scan-status">カメラを準備しています…</p>' +
      '<div class="btn-row" id="scan-actions"></div>' +
      '<p class="muted">QRコードを枠の中に入れてください。読み取れると自動で画面が開きます。暗い場所ではライトを点けてください。' +
      'スマートフォン標準のカメラで読み取っても同じ画面が開きます。</p>';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return failed('このブラウザではカメラを使えません。スマートフォン標準のカメラでQRを読み取ってください。');
    }
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      return failed('カメラを使うには https で開く必要があります。');
    }
    scan = { stream: null, timer: null, detector: null };
    try {
      if (typeof global.BarcodeDetector === 'function') scan.detector = new global.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) { scan.detector = null; }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
    }).then(function (stream) {
      if (!scan) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      scan.stream = stream;
      var video = document.getElementById('scan-video');
      if (!video) return;
      video.srcObject = stream;
      var p = video.play();
      if (p && p['catch']) p['catch'](function () { /* 自動再生の失敗は無視 */ });
      status('QRコードを枠の中に入れてください');
      addTorch(stream);
      tick();
    })['catch'](function (err) {
      var name = (err && err.name) || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        failed('カメラの使用が許可されていません。ブラウザの設定でこのサイトのカメラを「許可」にしてから、もう一度お試しください。');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        failed('カメラが見つかりませんでした。');
      } else {
        failed('カメラを起動できませんでした。' + esc(name));
      }
    });
  });
})(window);
