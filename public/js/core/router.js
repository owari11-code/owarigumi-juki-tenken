/*
 * router.js - 画面の登録口（各画面のファイルより先に読み込む）
 *
 * 各画面は MT.route(パターン, 設定, 描画関数) で登録する。
 *   設定 access: 'admin'   … 事務所のログインが必要（既定）
 *               'manager' … 管理者のみ
 *               'field'   … QRで入った現場の端末でも開ける（中で現場の範囲を確かめる）
 *               'public'  … 誰でも（ログイン画面など）
 *        form: true       … 入力中の画面。同期で内容が変わっても描き直さない
 *        print: true      … 印刷用の画面（ヘッダーを隠す）
 * 実際の切り替えは app.js が行う。
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var Session = MT.session;

  MT.routes = [];

  MT.route = function (pattern, opts, render) {
    MT.routes.push({ re: new RegExp('^' + pattern + '$'), opts: opts || {}, render: render });
  };

  /* 現場の画面のタブ（各画面のファイルが登録する） */
  MT.siteTabs = {};

  MT.notFound = function (msg) {
    U.app().innerHTML = UI.pageHead('ERROR', '表示できません') +
      UI.alert('error', U.esc(msg || 'ページが見つかりません。')) +
      UI.btnRow('<a class="btn" href="#/">ホームへ</a>');
  };

  /** 現場の端末（QR）がこの現場を扱ってよいか。だめなら案内を出して false */
  MT.requireSiteAccess = function (siteId) {
    if (Session.isAdmin() || Session.hasFieldAccess(siteId)) return true;
    U.app().innerHTML = UI.pageHead('QR', 'QRコードを読み取ってください') +
      UI.alert('warn', 'この画面を開くには、現場に掲示されているQRコード、または機械・資材に貼られたQRコードを読み取ってください。' +
        '事務所の方は<a href="#/login">ログイン</a>してください。') +
      UI.btnRow('<a class="btn lead" href="#/scan">■ QRを読み取る</a>');
    return false;
  };

  /** データの到着を待つ間の表示 */
  MT.loading = function (msg) {
    U.app().innerHTML = '<div class="card"><p>' + U.esc(msg || 'データを読み込んでいます…') + '</p></div>';
  };
})(window);
