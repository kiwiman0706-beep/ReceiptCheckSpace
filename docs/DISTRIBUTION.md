# 配信（CBCM で院内PCに配る）

MediToys と同じく「CRX と update.xml を GitHub Pages に置き、CBCM でカスタムURLから強制インストール」する。
ただし配信元は別リポジトリではなく、**このリポジトリの GitHub Pages**。

```
main に extension/ の変更が入る
  └→ GitHub Actions（.github/workflows/release.yml）
       ├ テスト
       ├ Secret の鍵で CRX を作る（manifest に update_url を入れる）
       └ GitHub Pages に公開
            https://kiwiman0706-beep.github.io/ReceiptCheckSpace/              … 案内（拡張機能IDとURL）
            https://kiwiman0706-beep.github.io/ReceiptCheckSpace/stable/update.xml
            https://kiwiman0706-beep.github.io/ReceiptCheckSpace/stable/receiptviewer.crx
院内PCの Chrome（CBCM）
  └→ update.xml を定期的に見て、version が上がっていれば自動更新
```

## 最初に1回だけやること

### 1. 署名鍵を作る（自分のPCで）

Git Bash（Windows）またはターミナル（Mac）で：

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out receiptviewer.pem
```

- **この鍵で拡張機能IDが決まる**。なくすと別の拡張機能扱いになり、各PCの済・メモも引き継げなくなるので、パスワード管理ツールなどに保管する
- リポジトリには入れない（`.gitignore` で `*.pem` は除外済み）
- 拡張機能IDは次のコマンドで確認できる（Actions の実行結果と Pages の案内ページにも出る）

```bash
openssl pkey -in receiptviewer.pem -pubout -outform DER | sha256sum | head -c32 | tr '0-9a-f' 'a-p'
```

### 2. 鍵を GitHub の Secret に登録する

リポジトリの Settings → Secrets and variables → Actions → New repository secret

- Name：`CRX_PRIVATE_KEY`
- Secret：`receiptviewer.pem` の中身をすべて（`-----BEGIN PRIVATE KEY-----` から `-----END PRIVATE KEY-----` まで）

### 3. GitHub Pages を有効にする

Settings → Pages → Build and deployment → Source を **GitHub Actions** にする。

### 4. main ブランチを作って既定にする

ワークフローは `main` への push で動く。GitHub Pages の公開も既定ブランチからしか許可されないので、
`main` を作って Settings → General → Default branch で `main` にする。

### 5. 初回の配信

Actions → 「配信（CRX / GitHub Pages）」→ Run workflow（main）。
終わったら https://kiwiman0706-beep.github.io/ReceiptCheckSpace/ を開き、拡張機能IDとURLを確認する。

### 6. CBCM（Google 管理コンソール）に登録する

1. admin.google.com → デバイス → Chrome → アプリと拡張機能 → **ユーザーとブラウザ**
2. 左で配りたい組織部門（院内PCのブラウザが登録されている部門）を選ぶ
3. 右下の「＋」→ **「ID で Chrome アプリまたは拡張機能を追加」**
4. 拡張機能ID を入力し、「**カスタム URL から**」を選んで URL に `…/stable/update.xml` を入れて保存
5. インストール ポリシーを **「インストールを強制」**（ツールバーに出したいなら「強制インストールしてピン留め」）

院内PCの Chrome がポリシーを受け取ると自動で入る（すぐ確かめたいときは `chrome://policy` →「ポリシーを再読み込み」）。

## 更新を配るとき

1. `extension/manifest.json` の `version` を上げる（例：`0.1.0` → `0.1.1`）。**上げないと各PCは更新しない**（Actions に警告が出る）
2. main にマージ → 自動で Pages に公開
3. 各PCは数時間以内に自動更新（急ぐときは `chrome://extensions` → デベロッパーモード →「更新」）

## 注意

- 「パッケージ化されていない拡張機能」で試していたPCは、それを削除しておく（IDが違うので別物として2つ並ぶ。保存データも引き継がれない）
- Pages に置くのは CRX・update.xml・案内ページだけ。サンプルや患者データは載らない
- 鍵を作り直すと拡張機能IDが変わる → CBCM の登録もやり直しになり、各PCの保存データも消える
