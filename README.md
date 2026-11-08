# ReceiptViewer（レセプトチェック用ビューア）

M3デジカルの「要確認レセプト一覧」を読み込んで、
**左に要確認リスト・右に該当カルテ** の2ペインでレセプトチェックを進めるための Chrome 拡張機能。

- 仕様：[docs/SPEC.md](docs/SPEC.md)
- テスト用データ（すべて架空）：[samples/](samples/README.md)
  - `original_anon/` … 実際の出力ファイル（CSV・PDF）を匿名化したもの
  - `round1〜3_*.csv` … 再読み込み（差分）テスト用の連続データ
- ダミーデータ生成：`python tools/make_dummy_csv.py`
- CSV → PDF 生成：`python tools/make_pdf_from_csv.py <csv> <pdf> "YYYY/MM/DD HH:MM"`（要 reportlab）

> このリポジトリには実際の患者データは含まれていません。サンプルの氏名・番号・IDはすべて架空です。

## 開発状況

- [x] 入力ファイルの形式調査（SPEC 2章）
- [ ] 右ペイン方式の検証（院内PCで iframe 埋め込みが動くか）
- [ ] v1 実装（CSV 読み込み・一覧・済・メモ・再読み込み差分）
