# マル点（重機日常点検アプリ）

**毎日の安全を、確実に積み重ねる。**

建設機械にQRコードを貼り付け、スマートフォンで読み取るだけで日常点検ができるWebアプリです。
ログイン不要。記録は端末間で自動共有されます。

## できること

- 工事現場ごとに重機を登録し、重機ごとのQRコードをアプリ内で生成
- QRコードをA4のラベルシートとして印刷（貼付用）
- QRを読むだけで点検フォームが開き、その場で点検を記録
- 点検記録を現場ごと・重機ごと・期間ごとに絞り込んで、いつでも印刷／PDF保存
- 現場のスマホと事務所のパソコンで記録を自動共有

## ファイル構成

```
重機点検アプリ/
├─ index.html        画面の入れ物
├─ _headers          セキュリティ用のHTTPヘッダー（Cloudflareが適用）
├─ wrangler.jsonc    Workers方式で公開するときの設定
├─ worker.js         Workers方式の入口（Pages方式では使われません）
├─ .assetsignore     公開しないファイルの指定（サーバー処理・書類など）
├─ functions/api/    ★サーバー側の処理（鍵を持つのはここだけ）
│   ├─ _lib.js       共通処理（署名・接続元の確認など）
│   ├─ records.js    点検データの読み書き（削除は不可）
│   ├─ session.js    利用確認（Turnstile）
│   └─ ping.js       稼働確認（自動停止の防止）
├─ css/style.css     スタイル（画面用＋印刷用）
└─ js/
   ├─ config.js      公開URLとTurnstileのSite Key（秘密の値は書きません）
   ├─ qrcode.js      QRコード生成（自作・外部通信なし）
   ├─ qrdecode.js    QRコード読み取り（自作。iOSはBarcodeDetector非対応のため）
   ├─ data.js        機種区分と点検項目の定義
   ├─ store.js       データ保存（端末内）
   ├─ sync.js        端末間の自動共有
   └─ app.js         画面遷移と描画
```

---

# セキュリティの考え方

以前は、データベースの鍵をブラウザ（`config.js`）に置いていました。公開サイトから誰でも読めるため、
**URLを知る人なら誰でも点検記録を読み・書き・消せる**状態でした。

現在は次の構成に変えています。

```
スマホ／PC  ──①──▶  Cloudflare Pages（アプリ本体＋サーバー処理）  ──②──▶  Supabase（保管庫）
                       ここだけが鍵を持つ
```

- ①**ブラウザは鍵を持ちません。** 同じドメインの `/api/...` を呼ぶだけです。
- ②鍵（`service_role`）は Cloudflare の環境変数に暗号化保存され、画面のコードからは見えません。
- Supabase 側は匿名キーからの読み書きを**すべて禁止**します。鍵が漏れても、そこからは何もできません。

サーバー処理（`functions/api/`）が守っていること:

| 対策 | 内容 |
|---|---|
| 削除の禁止 | データを消すAPIを用意していません。消去は「削除済みの印」だけで、履歴は残ります |
| 共有コードの固定 | サーバー側で固定。他社・他現場のデータは指定できません |
| 入力の検査 | 識別子の形式、種別、件数（200件）、1件の大きさ（32KB）、本文全体（1MB）を検査 |
| 接続元の制限 | 別サイトに置かれた画面からの呼び出しを拒否します |
| 自動化の遮断 | Cloudflare Turnstile を通過した端末だけに、12時間有効の証明を発行します |
| 通信の制限 | Cloudflare のレート制限で、短時間の大量アクセスを遮断します |

---

# 導入手順

**①Supabaseを締める → ②Cloudflare Pagesに公開 → ③環境変数を設定 → ④QRラベルを刷り直す**
の順に進めます。所要1時間ほど、費用は無料の範囲で収まります。

## ステップ1　Supabase を締める

1. <https://supabase.com/dashboard> でプロジェクトを開く（停止中なら **Restore**）。
2. 左メニュー **SQL Editor** に、アプリの **設定 → Supabase側の準備** からコピーしたSQLを貼って **Run**。
   テーブルを作り、**匿名キーからの読み書きを禁止**します。
3. **Project Settings → API Keys** で、次を控える。
   - **Project URL**（`https://xxxxxxxx.supabase.co`）
   - **`service_role`**（または `sb_secret_…`）の鍵 ← **絶対に公開しない鍵です**
4. 同じ画面で、**これまで使っていた `sb_publishable_…` の鍵を無効化（Revoke／Delete）** してください。
   公開リポジトリに残っており、履歴からも取得できるためです。

> `service_role` の鍵は Cloudflare の環境変数にだけ入れます。`config.js` やリポジトリには絶対に書かないでください。

## ステップ2　Cloudflare に公開する

Cloudflare は新規プロジェクトを **Workers** に誘導する画面構成に変わりました。
このリポジトリは **Workers・Pages のどちらでも動く**ように作ってあります。
画面に出てきた方で進めてください（推奨は Workers）。

### 方法A：Workers（いまの標準）

1. <https://dash.cloudflare.com> にログイン。
2. 左メニュー **Workers**（または **Compute** / **Workers & Pages**）を開く。
3. **Create**（または **Create application**）を押す。
   「**Ship something new**」という画面が出たら、そこが作成画面です。
4. **「Import a repository」**（リポジトリを取り込む）を選ぶ。
   ※テンプレート一覧やHello Worldではなく、Gitから取り込む方を選びます。
5. **Continue with GitHub** → 連携を許可 → `owarigumi-juki-tenken` を選ぶ。
6. ビルド設定は次のとおり（ほぼ既定のままです）。
   - Project name: `maruten`（`wrangler.jsonc` と合わせると分かりやすい）
   - Build command: **空欄**
   - Deploy command: `npx wrangler deploy`（既定のまま）
   - Root directory: `/`
7. **Create and deploy** を押す。1〜2分で `https://maruten.〇〇.workers.dev` が発行されます。

`wrangler.jsonc` に設定を書いてあるので、画面側で追加の指定は不要です。
`/api/...` は `worker.js` が受け持ち、それ以外は画面ファイルが返ります。

### 方法B：Pages（従来の方式。画面に出る場合のみ）

1. **Workers & Pages** を開く → **Create application** → **Pages** タブ → **Connect to Git**。
2. `owarigumi-juki-tenken` を選ぶ。
3. Framework preset: **None** ／ Build command: **空欄** ／ Build output directory: **`/`**
4. **Save and Deploy**。`https://〇〇.pages.dev` が発行されます。

この場合は `functions/api/` が自動で `/api/...` に割り当てられます（`worker.js` は使われません）。

> **リポジトリを非公開にできます。** どちらの方式でも非公開リポジトリから公開できます。
> GitHub の **Settings → General → Change repository visibility → Private** に変更してください。
> （GitHub Pages の公開は止まりますが、以後は Cloudflare 側のURLを使います）

## ステップ3　環境変数を設定する

Cloudflare のプロジェクトを開き、**Settings → Variables and Secrets**（Pagesの場合は
**Production** と **Preview** の両方）に登録します。鍵は必ず **Secret（暗号化）** を選んでください。

| 名前 | 種別 | 値 |
|---|---|---|
| `SUPABASE_URL` | Text | `https://xxxxxxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **Secret** | ステップ1の `service_role` の鍵 |
| `SPACE` | Text | 共有コード（例：`owarigumi`） |
| `SESSION_SECRET` | **Secret** | ランダムな長い文字列（下の作り方参照） |
| `TURNSTILE_SECRET` | **Secret** | ステップ4で取得 |
| `KEEPALIVE_TOKEN` | **Secret** | ランダムな長い文字列 |

ランダムな文字列は、ブラウザのアドレス欄で次を実行すると作れます（結果をコピー）。

```
javascript:prompt('コピーしてください', crypto.randomUUID()+crypto.randomUUID())
```

登録したら再デプロイして反映します（**Deployments** の最新の行から **Retry deployment**、
またはGitHubに何かコミットすると自動で再デプロイされます）。

## ステップ4　Turnstile（自動化アクセスの遮断）を設定する

1. Cloudflare の左メニュー **Turnstile → Add widget**。
2. Widget name は任意、Domain に公開URLのドメイン（`maruten.〇〇.workers.dev` または `〇〇.pages.dev`）を追加、Widget Mode は **Managed**。
3. 発行された **Site Key**（公開してよい）と **Secret Key**（非公開）を控える。
4. `js/config.js` の `turnstileSiteKey` に **Site Key** を書いて保存・アップロード。
5. Cloudflare の環境変数 `TURNSTILE_SECRET` に **Secret Key** を登録。

現場では、初回と1日1回だけ短い確認が入ります（多くの場合は画面に何も出ずに通過します）。

## ステップ5　レート制限をかける

Cloudflare の **Security → WAF → Rate limiting rules → Create rule**：

- Rule name: `api-limit`
- If incoming requests match: **URI Path** — **starts with** — `/api/`
- Rate: **60 requests** per **1 minute** per **IP**
- Action: **Block**（期間 1分）

正常な利用は1端末あたり毎分3回程度なので、余裕をもって収まります。

## ステップ6　QRコードのURLを更新する

公開URLが `https://maruten.〇〇.workers.dev/`（Pagesの場合は `https://〇〇.pages.dev/`）に変わるため、次の対応が必要です。

1. `js/config.js` の `baseUrl` を新しいURLに書き換えてアップロード
2. アプリで **QRラベルを印刷** し直し、**機体のラベルを貼り替える**

> 貼り替えを避けたい場合は、独自ドメイン（例 `juki.owarigumi.co.jp`）を Cloudflare に設定し、
> そのURLを `baseUrl` にしてください。以後は置き場所を変えてもラベルはそのまま使えます。

## ステップ7　稼働確認の自動実行（任意）

GitHub の **Settings → Secrets and variables → Actions** に登録します。

| Secret 名 | 値 |
|---|---|
| `APP_URL` | `https://〇〇.pages.dev` |
| `KEEPALIVE_TOKEN` | ステップ3と同じ値 |

週2回、`/api/ping` に自動アクセスして Supabase の自動停止を防ぎます。
失敗するとGitHubからメールが届くので、障害の早期発見にもなります。

---

# 端末間の自動共有について

- 保存した内容は数秒で他の端末に届きます。受け取り側は**アプリを開いている間、20秒ごとに自動取得**します。
- 電波が届かない場所でも点検の記録はできます。端末内に保存され、**電波が戻った時点で自動送信**されます。
- 初めての端末でQRを読むと、まずサーバーから現場・重機の情報を取り寄せてから点検画面を開きます。
- 同じ内容を2台で同時に編集した場合は、**後から保存した方**が残ります。
- 現場や重機を削除すると、他の端末でも「削除済み」として反映されます（記録自体は保管庫に残ります）。

### うまく同期できないときは

アプリの **設定** 画面に、サーバー側の設定状況（✓／×）と理由が表示されます。

| 表示 | 対処 |
|---|---|
| データベース接続 × | Cloudflareの環境変数 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` を確認 |
| 利用確認（セッション）× | Cloudflareの環境変数 `SESSION_SECRET` を確認 |
| 自動化アクセスの遮断 × | `TURNSTILE_SECRET` と `config.js` の `turnstileSiteKey` を確認 |
| テーブル juki_records がまだありません | ステップ1のSQLが未実行 |
| データの保管先に接続できません | Supabaseが停止している可能性。管理画面で Restore |
| 端末が通信できていません | 電波の問題。記録は端末に残り、復帰後に自動送信されます |

### バックアップ

**設定 → データを書き出す** でJSONファイルとして保存できます。
サーバー側も Supabase の管理画面（Table Editor → juki_records）から確認・エクスポートできます。

### 残るリスク（把握しておいてください）

- **URLを知る人は、依然として点検記録を見られます。** ログインを設けていないためです。
  Turnstile は自動化された大量取得を防ぎますが、人が手作業で開くことは止められません。
  完全に防ぐにはログイン（Cloudflare Access 等）の追加が必要です。
- 書き込みも同様に、URLを知る人なら手作業では可能です。ただし削除はできず、
  すべての変更は保管庫に履歴として残ります。
- 公開リポジトリに残っている**古い鍵は必ず無効化**してください（ステップ1-4）。

---

# 記録の印刷・PDF保存

現場のページ → **点検記録を見る** で、重機・期間を絞り込みます。
**この一覧をまとめて印刷／PDF保存** を押し、印刷ダイアログでプリンターを
**「PDFに保存」** にすると、PDFファイルになります（1件＝1ページ）。

# 点検項目の出典

厚生労働省「外国人労働者に対する安全衛生教育教材作成事業（建設業）／
『トンネル推進工業務、建設機械施工業務及び土工業務』安全衛生のポイント　建設機械の基本と点検等」
(2020.3) の次の内容に基づいています。

- (4) 点検の基本事項 … 点検前の安全措置
- (5) 作業開始前点検 … 行わなければならない点検12項目
- (6)(7) エンジン始動後点検 … ブレーキ／クラッチ／エンジンの調子／作業装置の作動
- (8) 作業終了時点検等

項目を追加・変更する場合は `js/data.js` の `SECTIONS` を編集してください。
記録は項目IDで保存されているため、IDを変えなければ過去の記録の表示は崩れません。

# 動作環境

iOS Safari / Android Chrome / Windows の Edge・Chrome（いずれも最近のバージョン）。
QRコードの生成は自前実装で、バージョン1〜40・誤り訂正L/M/Q/Hに対応しています。
