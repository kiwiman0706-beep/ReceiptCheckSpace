# CLAUDE.md

M3デジカルの「要確認レセプト一覧」CSV を読み込み、一覧＋カルテの2ペインで
レセプトチェック作業をするための Chrome 拡張機能（Manifest V3）。

- 仕様は `docs/SPEC.md`。まずこれを読むこと
- テスト用データは `samples/`（すべて架空。Shift_JIS / CRLF で実ファイルと同じ形式）。中身は `samples/README.md`
  - `original_anon/` は実際の出力（CSV・PDF）を匿名化したもの。形式の正解として扱う
- ダミーデータは `tools/make_dummy_csv.py`、PDF は `tools/make_pdf_from_csv.py` で作れる

## 守ること

- **実際の患者データをコミットしない**。`要確認レセプト一覧_*` という名前のファイルは `.gitignore` 済み。サンプルが必要なら `tools/make_dummy_csv.py` を拡張する
- 外部への通信を追加しない（解析・CDN・外部フォント・リモートのコード読み込みすべて禁止）。データは `chrome.storage.local` のみ
- ビルド工程なしで「パッケージ化されていない拡張機能を読み込む」だけで動く構成を保つ
- 右ペインのカルテ表示方式は院内環境での検証待ち（SPEC 3.5）。差し替えられるように1か所にまとめる
- UI の文言は日本語
