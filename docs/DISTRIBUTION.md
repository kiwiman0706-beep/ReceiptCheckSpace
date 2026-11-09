# 配信（CBCM で院内PCに配る）

CRX と update.xml を **このリポジトリの main ブランチの `dist/`** に置き、
CBCM の「カスタム URL から強制インストール」で配る。GitHub Pages・Secrets・Actions は使わない。

## CBCM に登録する値（変わらない）

| 項目 | 値 |
|---|---|
| 拡張機能ID | `kifacglijelmbclmblpcdhbbipoefafe` |
| URL | `https://raw.githubusercontent.com/kiwiman0706-beep/ReceiptCheckSpace/main/dist/update.xml` |
| インストール ポリシー | インストールを強制（ツールバーに出すなら「強制インストールしてピン留め」） |

管理コンソール：デバイス → Chrome → アプリと拡張機能 → ユーザーとブラウザ → 組織部門を選ぶ →
右下「＋」→「ID で Chrome アプリまたは拡張機能を追加」→「カスタム URL から」。

## 署名鍵

- Google ドライブ「拡張機能の署名鍵」フォルダの `receiptviewer.pem`（非公開）
- この鍵で拡張機能IDが決まる。消すと別の拡張機能扱いになり、CBCM の登録やり直し・各PCの保存データ（済・メモ）も消える
- リポジトリには入れない（`.gitignore` で `*.pem` を除外済み）

## 更新を配る手順（Claude が行う）

1. `extension/manifest.json` の `version` を上げる（上げないと各PCは更新しない。スクリプトも止まる）
2. Google ドライブから `拡張機能の署名鍵/receiptviewer.pem` を取得し、スクラッチパッドなどリポジトリ外に保存
3. `tools/build_crx.sh <鍵のパス>` → `dist/receiptviewer.crx` と `dist/update.xml` が更新される
4. コミットして main にプッシュ（raw.githubusercontent.com のキャッシュは5分程度）
5. 各PCの Chrome は数時間以内に自動更新（急ぐときは `chrome://extensions` → デベロッパーモード →「更新」）

## 確認済みのこと

- Chrome の `--pack-extension` で作った CRX3 のIDが、鍵から計算したIDと一致する
- ポリシー（ExtensionInstallForcelist）で、`text/plain` で返される update.xml と CRX から強制インストールされる
  （raw.githubusercontent.com と同じ条件をローカルで再現して確認）

## 注意

- 「パッケージ化されていない拡張機能」で試していたPCは、それを削除しておく（IDが違うので2つ並ぶ。保存データも引き継がれない）
- `dist/` に置くのは CRX と update.xml だけ。サンプルや患者データは入らない
