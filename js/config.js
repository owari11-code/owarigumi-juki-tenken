/*
 * config.js - 公開前に書き換えるのはこのファイルだけ
 *
 * ★重要★
 *   データベースの鍵は、もうここには書きません。
 *   鍵は Cloudflare Pages の環境変数（暗号化保存）に置き、
 *   ブラウザは同じドメインの /api/... だけを呼びます。
 *   このファイルに秘密の値を書かないでください（誰でも読めます）。
 */
window.APP_CONFIG = {
  /* QRコードに埋め込むURL。空欄なら「いま開いているURL」を使います。
     例: 'https://maruten.pages.dev/' */
    baseUrl: 'https://owarigumi-juki-tenken.owari11.workers.dev/',

  /* データのやり取り先。通常は空欄のまま（同じドメインの /api を使います）。
     別ドメインのCloudflareに置く場合だけ 'https://〇〇.pages.dev' の形で指定します。 */
  apiBase: '',

  /* Cloudflare Turnstile の Site Key（公開してよい値）。
     設定すると、自動化された不正アクセスを遮断できます。
     空欄なら確認なしで動きます（社内限定の試用時など）。 */
    turnstileSiteKey: '0x4AAAA...',

  /* 会社名（帳票の表示用） */
  company: '株式会社尾割組'
};
