"""
M3デジカル「要確認レセプト一覧」CSV のダミーデータ生成スクリプト。

実データは一切参照しない。構造（列・文字コード・改行・値のパターン）だけを
実ファイルに合わせて再現した架空データを作る。

出力（samples/ 以下）:
  round1_20251205_1012.csv   … 1回目のレセ作成で出たリスト
  round2_20251206_0915.csv   … 修正後に再出力（大半が消え、一部残り、1件新規）
  round3_20251206_1420.csv   … 全部片付いた（ヘッダー行のみ）※空ファイル時の実形式は未確認

使い方:  python make_dummy_csv.py
"""
import random
from pathlib import Path

random.seed(31337)
OUT = Path(__file__).resolve().parent.parent / "samples"
OUT.mkdir(exist_ok=True)

HEADER = ["患者番号", "患者氏名", "診察日", "診療科", "医師", "保険",
          "チェック区分", "チェック内容", "該当カルテ", "診療年月", "2025年 11月"]
YEAR, MONTH = 2025, 11
DEPT = "01:精神科・心療内科"
DOCTORS = ["00001:見本　太郎", "00001:見本　太郎", "00001:見本　太郎", "00002:試験　花子"]

SURNAMES = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤",
            "吉田", "山田", "佐々木", "山口", "松本", "井上", "木村", "林", "斎藤", "清水",
            "山崎", "森", "池田", "橋本", "阿部", "石川", "前田", "藤田", "小川", "岡田"]
GIVEN = ["一郎", "花子", "健太", "美咲", "翔太", "陽子", "大輔", "由美", "誠", "愛",
         "直樹", "恵子", "拓也", "真由美", "浩二", "さくら", "隆", "千尋", "亮", "智子"]

# 実データで見られた保険欄のパターン（出現頻度もおおよそ合わせる）
INS = (["国保 精神通院（21） 自立支援補助（21）"] * 12 +
       ["国保 自立支援補助（21） 精神通院（21）", "国保 精神通院（21） 精神通院（21）",
        "精神通院（21）", "精神通院（21）", "精神通院（21）",
        "生活保護（12）", "生活保護（12） 精神通院（21）", "国保", "協会"])
KOUHI_INS = [i for i in INS if "21" in i]

# 医薬品名は公開情報（個人情報ではない）。全角表記は実データに合わせる
DRUGS = ["インヴェガ錠６ｍｇ", "デパケン錠２００ｍｇ", "セレネース錠３ｍｇ", "コントミン糖衣錠５０ｍｇ",
         "リスパダール内用液１ｍｇ／ｍＬ　０．１％", "ワイパックス錠１．０　１ｍｇ", "エビリファイ錠１ｍｇ",
         "レキソタン錠５　５ｍｇ", "クエチアピン錠２５ｍｇ「アメル」", "ルボックス錠２５　２５ｍｇ",
         "セパゾン錠１　１ｍｇ", "デエビゴ錠５ｍｇ", "ロゼレム錠８ｍｇ", "ジェイゾロフト錠５０ｍｇ",
         "ソラナックス０．４ｍｇ錠", "デパケンＲ錠１００ｍｇ"]

MSG_KOUHI_NONE = "公費(負担者番号なし) 受給者番号が登録されていません。"
MSG_KOUHI_NUM = "公費{} 受給者番号が登録されていません。"   # {} = 8桁のダミー負担者番号
MSG_TEKIOU = "{}：適応症がついていません。"


def make_patients(n):
    used, pts = set(), []
    for i in range(n):
        while True:
            pno = random.choice([random.randint(10000, 99999), random.randint(100000, 399999)])
            if pno not in used:
                used.add(pno)
                break
        name = f"{random.choice(SURNAMES)}　{random.choice(GIVEN)}"
        pts.append({"pno": pno, "name": name, "kid": 9000000 + i * 137,
                    "ins": random.choice(INS), "doc": random.choice(DOCTORS)})
    # 実データにあった「全角英字の外国人氏名」パターン
    pts[5]["name"] = "ＳＡＭＰＬＥ　ＪＯＨＮ　ＤＯＥ"
    return pts


def rows_for(p):
    rows = []
    n_days = random.choices([1, 1, 1, 2, 2, 4], k=1)[0]
    days = sorted(random.sample(range(1, 31), n_days))
    kouhi = "21" in p["ins"] and random.random() < 0.8
    drugs = random.sample(DRUGS, random.choice([0, 1, 1, 2])) if not kouhi or random.random() < 0.2 else []
    if not kouhi and not drugs:
        drugs = [random.choice(DRUGS)]
    num_style = random.random() < 0.1
    for d in days:
        url = f"https://digikar.jp/#/karte/patients/{p['kid']}/{YEAR}{MONTH:02d}{d:02d}"
        base = [str(p["pno"]), p["name"], f"{MONTH}/{d}", DEPT, p["doc"], p["ins"]]
        if kouhi:
            msg = MSG_KOUHI_NUM.format("21999999") if num_style else MSG_KOUHI_NONE
            rows.append(base + ["公費", msg, url])
        for dr in drugs:
            rows.append(base + ["適応症", MSG_TEKIOU.format(dr), url])
    return rows


def write(name, rows):
    # 実ファイル同様: Shift_JIS(CP932) / CRLF / クォートなし / 患者番号の「文字列」昇順
    rows = sorted(rows, key=lambda r: (r[0], int(r[2].split("/")[1])))
    lines = [",".join(HEADER)] + [",".join(r) for r in rows]
    (OUT / name).write_bytes(("\r\n".join(lines) + "\r\n").encode("cp932"))
    print(f"{name}: {len(rows)} rows")


patients = make_patients(42)
all_rows = [r for p in patients for r in rows_for(p)]
write("round1_20251205_1012.csv", all_rows)

# 2回目: 約8割は修正済みで消える。残りは未対応のまま。新規に1件出現
keep = [r for r in all_rows if random.random() < 0.2]
newp = {"pno": 400001, "name": "新規　出現", "kid": 9999999,
        "ins": "協会", "doc": DOCTORS[0]}
keep += rows_for(newp)[:1]
write("round2_20251206_0915.csv", keep)

write("round3_20251206_1420.csv", [])
