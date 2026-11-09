#!/usr/bin/env bash
# 配信用の CRX と update.xml を dist/ に作る。手順は docs/DISTRIBUTION.md
#
#   tools/build_crx.sh <署名鍵.pem>
#
# - 鍵は Google ドライブ「拡張機能の署名鍵/receiptviewer.pem」。リポジトリには入れない
# - extension/manifest.json の version が dist/update.xml と同じなら止める（同じ版では各PCは更新しない）
# - Chrome（または Chromium）の --pack-extension で CRX3 を作る。環境変数 CHROME で実行ファイルを指定できる
set -euo pipefail

KEY="${1:?使い方: tools/build_crx.sh <署名鍵.pem>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="receiptviewer"
BASE="${BASE:-https://raw.githubusercontent.com/kiwiman0706-beep/ReceiptCheckSpace/main/dist}"
DIST="${DIST:-$ROOT/dist}"

VERSION=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8"))["version"])' "$ROOT/extension/manifest.json")
ID=$(openssl pkey -in "$KEY" -pubout -outform DER | sha256sum | head -c32 | tr '0-9a-f' 'a-p')

if [ -f "$DIST/update.xml" ] && grep -q "version=\"$VERSION\"" "$DIST/update.xml" && [ -z "${FORCE:-}" ]; then
  echo "エラー: version $VERSION はもう配信済みです。extension/manifest.json の version を上げてください（FORCE=1 で上書き）" >&2
  exit 1
fi

CHROME="${CHROME:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || ls /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1 || true)}"
[ -x "$CHROME" ] || { echo "エラー: Chrome が見つかりません（CHROME=... で指定）" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -r "$ROOT/extension" "$WORK/$NAME"
# 配信版にだけ update_url を入れる（開発中の「パッケージ化されていない拡張機能」には入れない）
python3 -I - "$ROOT/extension/manifest.json" "$WORK/$NAME/manifest.json" "$BASE/update.xml" <<'PY'
import json, sys
src, dst, url = sys.argv[1:4]
m = json.load(open(src, encoding="utf-8"))
m["update_url"] = url
json.dump(m, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY

"$CHROME" --headless=new --no-sandbox --disable-gpu --user-data-dir="$WORK/profile" \
  --pack-extension="$WORK/$NAME" --pack-extension-key="$KEY" >/dev/null 2>&1 || true
[ -s "$WORK/$NAME.crx" ] || { echo "エラー: CRX の作成に失敗しました" >&2; exit 1; }

mkdir -p "$DIST"
cp "$WORK/$NAME.crx" "$DIST/$NAME.crx"
chmod 644 "$DIST/$NAME.crx"
cat > "$DIST/update.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="$ID">
    <updatecheck codebase="$BASE/$NAME.crx" version="$VERSION" />
  </app>
</gupdate>
EOF

echo "拡張機能ID : $ID"
echo "version    : $VERSION"
echo "update.xml : $BASE/update.xml"
