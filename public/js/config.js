/*
 * config.js - 公開時に確認する設定
 *
 * ★ここに秘密の値は書かないでください（誰でも読めるファイルです）。
 *   データベースの鍵などは Cloudflare の環境変数に置いてあります。
 */
window.APP_CONFIG = {
  /* QRコードに埋め込むURL（空欄なら、いま開いているURLを使います） */
  baseUrl: 'https://owarigumi-juki-tenken.owari11.workers.dev/',

  /* 通常は空欄のまま（同じドメインの /api を使います） */
  apiBase: '',

  /* Cloudflare Turnstile の Site Key（公開してよい値） */
  turnstileSiteKey: '0x4AAAAAAEksZBlxpF7x0-2q',

  /* 会社名（帳票の表示用） */
  company: '株式会社尾割組'
};
