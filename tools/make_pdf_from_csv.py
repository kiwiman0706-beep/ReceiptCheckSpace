"""
「要確認レセプト一覧」CSV から、M3デジカルが出す PDF と同じレイアウトの PDF を作る。
（テスト用。実データの PDF をリポジトリに入れずに PDF 読み込みを試すため）

再現していること:
  - A4縦、列: NO / 患者番号 / カルテ日付 / 保険 / 保険・公費・未会計(○) / チェック内容
  - 患者ごとに NO と患者番号をまとめ、同じ日付の行は日付セルをまとめる
  - 患者番号リンク = .../patients/{内部ID}/{出力日}、日付リンク = CSV の「該当カルテ」URL
  - 保険欄は全文を書いてセル外を切り取る（テキスト抽出すると隠れた部分も出てくる）
  - 見出しは文字を2回重ねて太字に見せる（テキスト抽出すると文字が重複する）
  - ○ は チェック区分 が「公費」の行に付く
再現していないこと:
  - 英数字と日本語でフォントを分けている点（実物は DejaVuSans + IPAGothic）
  - 改ページの規則（実物は不明。ここではページ下端で患者単位に改ページ）

必要: pip install reportlab / 日本語フォント（既定は Windows の MS ゴシック）
使い方: python make_pdf_from_csv.py input.csv output.pdf "2026/01/08 09:47" [font.ttc]
"""
import sys
from collections import OrderedDict
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

src, dst, stamp = sys.argv[1], sys.argv[2], sys.argv[3]
font_path = sys.argv[4] if len(sys.argv) > 4 else r"C:\Windows\Fonts\msgothic.ttc"
pdfmetrics.registerFont(TTFont("JP", font_path, subfontIndex=0))
F = "JP"

W, H = 595.0, 842.0
X = [22, 61, 133, 166, 275, 308, 572]          # 列の境界（実物から実測）
TOP, HEAD_BOTTOM, BOTTOM_LIMIT = 70, 97, 790
LINE = 13.8
FS = 9.6
out_date = stamp[:10].replace("/", "")


def y(top):          # pdfplumber 風の「上からの座標」→ reportlab 座標
    return H - top


def text(c, x, top, s, size=FS, bold=False, right=False, center=False):
    c.setFont(F, size)
    w = pdfmetrics.stringWidth(s, F, size)
    if right:
        x -= w
    if center:
        x -= w / 2
    c.drawString(x, y(top + size), s)
    if bold:                                       # 実物同様の「重ね書き太字」
        c.drawString(x + 0.3, y(top + size), s)
    return w


def wrap(s, width, size=FS):
    out, cur = [], ""
    for ch in s:
        if pdfmetrics.stringWidth(cur + ch, F, size) > width:
            out.append(cur); cur = ch
        else:
            cur += ch
    return out + [cur] if cur else out


lines = open(src, encoding="cp932").read().splitlines()
hdr = lines[0].split(",")
ym = hdr[-1].replace(" ", "")                     # 例: 2025年12月
rows = [l.split(",") for l in lines[1:] if l]

patients = OrderedDict()
for r in rows:
    patients.setdefault(r[0], []).append(r)


def page_header(c):
    text(c, 573, 8, f"作成日：{stamp}", right=True)
    text(c, 22, 50, f"診療月 {ym}分", size=10)
    text(c, 300, 42, "要確認レセプト一覧", size=16, center=True)
    c.setLineWidth(0.6)
    c.rect(X[0], y(HEAD_BOTTOM), X[-1] - X[0], HEAD_BOTTOM - TOP)
    text(c, 41.5, 80, "NO", bold=True, center=True)
    text(c, 97, 80, "患者番号", bold=True, center=True)
    text(c, 149.5, 73.7, "カルテ", size=8.4, bold=True, center=True)
    text(c, 149.5, 85.7, "日付", size=8.4, bold=True, center=True)
    text(c, 220.5, 80, "保険", bold=True, center=True)
    text(c, 291.5, 77, "保険・公費", size=6, bold=True, center=True)
    text(c, 291.5, 85.5, "・未会計", size=6, bold=True, center=True)
    text(c, 440, 80, "チェック内容", bold=True, center=True)


def link(c, x0, top, w, url):
    c.line(x0, y(top + FS + 1.5), x0 + w, y(top + FS + 1.5))      # 下線
    c.linkURL(url, (x0, y(top + FS + 2), x0 + w, y(top - 1)), relative=0)


def patient_height(rs):
    return sum(max(1, len(wrap(r[7], X[6] - X[5] - 6))) * LINE for r in rs)


c = canvas.Canvas(dst, pagesize=(W, H))
c.setTitle("要確認レセプト一覧")
pages, cur, used = [], [], 0
for pno, rs in patients.items():
    h = patient_height(rs)
    if cur and HEAD_BOTTOM + used + h > BOTTOM_LIMIT:
        pages.append(cur); cur, used = [], 0
    cur.append((pno, rs)); used += h
pages.append(cur)

no = 0
for pi, plist in enumerate(pages):
    page_header(c)
    top = HEAD_BOTTOM
    for pno, rs in plist:
        no += 1
        ptop = top
        kid = rs[0][8].split("/")[-2]
        prev_date = None
        for r in rs:
            content = wrap(r[7], X[6] - X[5] - 6)
            rh = max(1, len(content)) * LINE
            if r[2] != prev_date:                     # 同じ日付の2行目以降は日付を出さない
                if prev_date is not None:
                    c.line(X[2], y(top), X[3], y(top))
                w = text(c, X[3] - 3, top + 2, r[2], right=True)
                link(c, X[3] - 3 - w, top + 2, w, r[8])
                prev_date = r[2]
            c.line(X[3], y(top), X[6], y(top))
            # 保険（セル幅で切り取る。はみ出た2行目以降も描くが見えない）
            c.saveState()
            # 実物は「セル幅より少し広く折り返し、1行分の高さで切り取る」ため末尾の文字が半端に切れる
            p = c.beginPath(); p.rect(X[3], y(top + LINE), X[4] - X[3], LINE); c.clipPath(p, stroke=0)
            for i, ln in enumerate(wrap(r[5], X[4] - X[3] + 6)):
                text(c, X[3] + 3, top + 1 + i * LINE, ln)
            c.restoreState()
            if r[6] == "公費":
                text(c, (X[4] + X[5]) / 2, top + 2, "○", center=True)
            for i, ln in enumerate(content):
                text(c, X[5] + 3, top + 2 + i * LINE, ln)
            top += rh
        text(c, X[1] - 4, ptop + 2, str(no), right=True)
        w = text(c, X[2] - 3, ptop + 2, pno, right=True)
        link(c, X[2] - 3 - w, ptop + 2, w, f"https://digikar.jp/#/karte/patients/{kid}/{out_date}")
        c.line(X[0], y(top), X[6], y(top))
        for x in X:
            c.line(x, y(ptop), x, y(top))
    text(c, W / 2, 815, f"{pi + 1} / {len(pages)}", center=True)
    c.showPage()
c.save()
print(dst, len(pages), "pages,", no, "patients")
