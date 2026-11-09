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

## 配信（CBCM）

院内PCへは CBCM で強制インストールする（main の `dist/` から配信）。手順は [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)。

| CBCM に登録する値 | |
|---|---|
| 拡張機能ID | `kifacglijelmbclmblpcdhbbipoefafe` |
| URL | `https://raw.githubusercontent.com/kiwiman0706-beep/ReceiptCheckSpace/main/dist/update.xml` |

## 使い方（院内PC・開発中の手動インストール）

1. このリポジトリをダウンロード（または `git clone`）する
2. Chrome で `chrome://extensions` を開き、右上の「デベロッパー モード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」→ `extension` フォルダを選ぶ
4. ツールバーのアイコン（パズルのピースから固定しておくと便利）を押すとビューアが開く
5. デジカルの「要確認レセプト一覧_*.csv」をビューアにドロップ（または「ファイルを選択」）

- 行をクリック／↑↓ で右側にカルテが出る。Space で済、M でメモ、[ で一覧の折りたたみ
- 次の一覧を読み込むと、済・メモを引き継いで差分（新規／継続／要再確認／解消）が出る
- ⚙ からカルテの表示方式（A：埋め込み／B：別ウインドウ）の切り替えと、データの削除ができる

### カルテが右側に表示されないとき

方式A（埋め込み）は院内環境で未検証です（SPEC 3.5）。真っ白・エラー・ログイン画面のままなどの場合は、
⚙ →「B：デジカルを別ウインドウで開いて連動させる」に切り替えてください。

## 構成

```
extension/            拡張機能本体（ビルドなし。このフォルダをそのまま読み込む）
  manifest.json
  background.js       アイコンクリックでビューアを開く
  viewer.html/css/js  ビューア画面
  lib/csv.js          文字コード判定・CSVパース
  lib/receipt.js      一覧CSV → 行データ（キー・診療年月など）
  lib/diff.js         再読み込みの差分判定
  lib/store.js        chrome.storage.local への保存
  lib/karte.js        右ペインのカルテ表示（方式A/Bを差し替え）
tests/                ロジックのテスト（node --test tests/*.test.mjs）
tools/build_crx.sh    配信用の CRX と update.xml を dist/ に作る
dist/                 配信物（CBCM が参照する）
```

## 開発状況

- [x] 入力ファイルの形式調査（SPEC 2章）
- [ ] 右ペイン方式の検証（院内PCで iframe 埋め込みが動くか）→ 方式A・Bの両方を実装済み。院内で A を試す
- [x] v1 実装（CSV 読み込み・一覧・済・メモ・再読み込み差分・折りたたみ）
- [ ] PDF 対応（v2 以降）
- [ ] ダウンロードフォルダの監視（v2 以降）

決めたこと（SPEC 8章）：状態フィルタの初期値は「すべて（済は暗転）」、メモは患者単位、
前回「要再確認」で済にしないまま次の一覧にも残った行は「要再確認」のまま表示する。
同じファイルを読み込み直したときは差分を取らない（済が要再確認に化けないように）。
