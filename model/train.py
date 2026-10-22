"""무던한 지도 — 장소×요일×시간 혼잡 패턴 학습 (서울 생활인구 → 주요 121장소)

입력 (모두 서울 열린데이터광장 공개 자료, 직접 내려받음)
  - 행정동 단위 서울 생활인구(내국인) OA-14991: LOCAL_PEOPLE_DONG_2026{05,06,07}.csv
  - 서울시 주요 121장소 영역 OA-21778 (shp, WGS84)
  - 행정동 경계: github.com/vuski/admdongkor ver20250401 (행정안전부 행정동코드)

하는 일
  1) 121장소 영역과 행정동 경계를 겹쳐, 장소마다 '겹친 넓이 비율'로 행정동 생활인구를 나눠 담는다.
  2) 장소별 시간 단위 인구 시계열을 만든다 (2026-05-01 ~ 07-31, 92일 × 24시간).
  3) LightGBM으로 '장소 × 요일 × 시간 × 공휴일' 패턴을 학습한다 (목표: 장소 중앙값 대비 log 비율).
  4) 마지막 14일을 떼어 두고, 비교 기준 두 가지와 견준다.
       - 계절 나이브: 마지막 한 주를 그대로 되풀이 (Hyndman & Athanasopoulos, fpp3 5.2)
       - 요일·시간 평균: 학습 기간의 같은 요일·시간 평균
     지표: MAPE, 4단계(여유·보통·약간 붐빔·붐빔) 맞춤률, '실제보다 낮게 안내한 비율'(과소 안내)
  5) 전체 기간으로 다시 학습해 장소마다 요일(0~6) × 시간(0~23) 혼잡 부담값(0~100)을 site/data/forecast.json에 쓴다.

실행: python train.py <생활인구 CSV 폴더> <121장소 shp 경로(.shp 없이)> <행정동 geojson>
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import shapefile
from shapely.geometry import shape
from shapely.strtree import STRtree

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "site" / "data"
OUT.mkdir(parents=True, exist_ok=True)

csv_dir, shp_path, dong_geo = Path(sys.argv[1]), sys.argv[2], sys.argv[3]

HOLIDAYS = {"2026-05-01", "2026-05-05", "2026-05-25", "2026-06-03", "2026-06-06"}  # 근로자의날·어린이날·부처님오신날 대체·지방선거·현충일

# ---------- 1. 장소 영역 × 행정동 겹침 ----------
sf = shapefile.Reader(shp_path, encoding="utf-8")
fields = [f[0] for f in sf.fields[1:]]
places = []
for sr in sf.shapeRecords():
    rec = dict(zip(fields, sr.record))
    if rec.get("AREA_CD") == "POI100":  # 서울대공원은 과천시라 서울 생활인구가 없음
        continue
    geom = shape(sr.shape.__geo_interface__).buffer(0)
    places.append({"cd": rec.get("AREA_CD"), "nm": rec.get("AREA_NM"), "cat": rec.get("CATEGORY"), "geom": geom})

dongs = json.load(open(dong_geo, encoding="utf-8"))["features"]
dongs = [d for d in dongs if d["properties"]["sido"] == "11"]
dgeoms = [shape(d["geometry"]).buffer(0) for d in dongs]
dcodes = [d["properties"]["adm_cd2"][:8] for d in dongs]
tree = STRtree(dgeoms)

weights = {}  # place cd -> {dong code: 비율}
meta = {}
for p in places:
    w = {}
    for i in tree.query(p["geom"]):
        inter = p["geom"].intersection(dgeoms[i]).area
        if inter > 0:
            w[dcodes[i]] = inter / dgeoms[i].area
    weights[p["cd"]] = w
    c = p["geom"].representative_point()
    b = p["geom"].bounds
    meta[p["cd"]] = {"nm": p["nm"], "cat": p["cat"], "lat": round(c.y, 5), "lng": round(c.x, 5),
                     "bbox": [round(x, 5) for x in b], "dongs": len(w)}
print("장소", len(places), "· 행정동 없는 장소", [k for k, v in weights.items() if not v])

# ---------- 2. 장소별 시간 시계열 ----------
frames = []
for f in sorted(csv_dir.glob("LOCAL_PEOPLE_DONG_2026*.csv")):
    df = pd.read_csv(f, dtype=str, encoding="utf-8-sig", index_col=False).iloc[:, :4]
    df.columns = ["day", "hour", "dong", "pop"]
    frames.append(df)
raw = pd.concat(frames)
raw["pop"] = raw["pop"].astype(float)
raw["hour"] = raw["hour"].astype(int)
pivot = raw.pivot_table(index=["day", "hour"], columns="dong", values="pop", aggfunc="sum")
rows = []
for cd, w in weights.items():
    cols = [d for d in w if d in pivot.columns]
    if not cols:
        continue
    s = (pivot[cols] * np.array([w[d] for d in cols])).sum(axis=1)
    rows.append(pd.DataFrame({"cd": cd, "day": s.index.get_level_values(0), "hour": s.index.get_level_values(1), "pop": s.values}))
ts = pd.concat(rows, ignore_index=True)
ts["date"] = pd.to_datetime(ts["day"])
ts["dow"] = ts["date"].dt.dayofweek
ts["hol"] = ts["day"].map(lambda d: f"{d[:4]}-{d[4:6]}-{d[6:]}" in HOLIDAYS).astype(int)
ts["offday"] = ((ts["dow"] >= 5) | (ts["hol"] == 1)).astype(int)
ts["t"] = (ts["date"] - ts["date"].min()).dt.days
med = ts.groupby("cd")["pop"].median()
ts["y"] = np.log(ts["pop"] / ts["cd"].map(med))
cats = {cd: i for i, cd in enumerate(sorted(ts["cd"].unique()))}
catmap = {c: i for i, c in enumerate(sorted({m["cat"] for m in meta.values()}))}
ts["cdi"] = ts["cd"].map(cats)
ts["cati"] = ts["cd"].map(lambda c: catmap[meta[c]["cat"]])
print("시계열", ts.shape, ts["day"].min(), "~", ts["day"].max())

FEATS = ["cdi", "cati", "dow", "hour", "hol", "offday", "base", "base_off", "spread"]


def add_base(df, ref):
    """ref(학습 구간)에서 장소×요일×시간 평균(공휴일 제외)과 장소×쉬는날여부×시간 평균을 특징으로 붙인다."""
    r = ref[ref["hol"] == 0]
    b = r.groupby(["cd", "dow", "hour"])["y"].mean().rename("base")
    bo = ref.groupby(["cd", "offday", "hour"])["y"].mean().rename("base_off")
    sp = r.groupby(["cd", "dow", "hour"])["y"].std().rename("spread")
    df = df.drop(columns=[c for c in ["base", "base_off", "spread"] if c in df], errors="ignore")
    df = df.join(b, on=["cd", "dow", "hour"]).join(bo, on=["cd", "offday", "hour"]).join(sp, on=["cd", "dow", "hour"])
    return df
PARAMS = dict(objective="l2", learning_rate=0.05, num_leaves=63, min_data_in_leaf=20, feature_fraction=0.9,
              bagging_fraction=0.9, bagging_freq=1, verbose=-1, seed=7)


def fit(df, rounds=600):
    ds = lgb.Dataset(df[FEATS], df["y"], categorical_feature=["cdi", "cati", "dow", "hour"])
    return lgb.train(PARAMS, ds, num_boost_round=rounds)


# 장소별 4단계 경계 = 학습 기간 시간값의 25·50·75 백분위 (장소마다 자기 평소 대비)
def levels(pop, q):
    return np.searchsorted(q, pop)  # 0 여유 1 보통 2 약간 붐빔 3 붐빔


# ---------- 3·4. 검증: 마지막 14일 ----------
cut = ts["date"].max() - pd.Timedelta(days=13)
tr, te = ts[ts["date"] < cut].copy(), ts[ts["date"] >= cut].copy()
# 학습 안에서도 base를 자기 자신으로 만들면 새는 값이 생기므로, 학습 구간 base는 앞 절반으로 만들고 뒤 절반을 학습한다
half = tr["date"].min() + (tr["date"].max() - tr["date"].min()) / 2
tr_fit = add_base(tr[tr["date"] >= half].copy(), tr[tr["date"] < half])
m = fit(tr_fit)
te = add_base(te, tr)
te["gbdt"] = np.exp(m.predict(te[FEATS])) * te["cd"].map(med)
last_week = tr[tr["date"] >= cut - pd.Timedelta(days=7)].copy()
last_week["dow"] = last_week["date"].dt.dayofweek
naive = last_week.set_index(["cd", "dow", "hour"])["pop"]
te["naive"] = [naive.get((c, d, h), np.nan) for c, d, h in zip(te["cd"], te["dow"], te["hour"])]
prof = tr[tr["hol"] == 0].groupby(["cd", "dow", "hour"])["pop"].mean()
te["prof"] = [prof.get((c, d, h), np.nan) for c, d, h in zip(te["cd"], te["dow"], te["hour"])]
# 안전 규칙: 부담을 낮게 안내하지 않도록 GBDT와 요일·시간 평균 중 큰 값을 쓴다 (제안자 답변서 '공통 원칙')
te["safe"] = np.fmax(te["gbdt"], te["prof"])
qs = tr.groupby("cd")["pop"].quantile([0.25, 0.5, 0.75]).unstack()

report = {"train": [str(tr["date"].min().date()), str(tr["date"].max().date())],
          "test": [str(te["date"].min().date()), str(te["date"].max().date())],
          "places": int(ts["cd"].nunique()), "test_rows": int(len(te)), "methods": {}}
true_lv = np.concatenate([levels(g["pop"].values, qs.loc[c].values) for c, g in te.groupby("cd")])
for name in ["gbdt", "safe", "naive", "prof"]:
    sub = te.dropna(subset=[name])
    mape = float(np.mean(np.abs(sub[name] - sub["pop"]) / sub["pop"]) * 100)
    pred_lv = np.concatenate([levels(g[name].values, qs.loc[c].values) for c, g in te.groupby("cd")])
    acc = float(np.mean(pred_lv == true_lv) * 100)
    under = float(np.mean(pred_lv < true_lv) * 100)
    report["methods"][name] = {"n": int(len(sub)), "mape": round(mape, 2), "level_acc": round(acc, 1), "under": round(under, 1)}
# 공휴일 낀 주에서 차이가 커지는지 보려고, 검증 기간 중 붐빔(3단계) 시간만 따로
busy = true_lv == 3
for name in ["gbdt", "safe", "naive", "prof"]:
    pred_lv = np.concatenate([levels(g[name].values, qs.loc[c].values) for c, g in te.groupby("cd")])
    report["methods"][name]["busy_hit"] = round(float(np.mean(pred_lv[busy] == 3) * 100), 1)
print(json.dumps(report, ensure_ascii=False, indent=1))

# ---------- 5. 전체 학습 → 요일×시간 부담값 ----------
half_all = ts["date"].min() + (ts["date"].max() - ts["date"].min()) / 2
mf = fit(add_base(ts[ts["date"] >= half_all].copy(), ts[ts["date"] < half_all]))
qall = ts.groupby("cd")["pop"].quantile([0.05, 0.25, 0.5, 0.75, 0.95]).unstack()
grid = []
for cd in cats:
    for dow in range(7):
        for h in range(24):
            grid.append({"cd": cd, "cdi": cats[cd], "cati": catmap[meta[cd]["cat"]], "dow": dow, "hour": h,
                         "hol": 0, "offday": int(dow >= 5), "t": int(ts["t"].max())})
g = add_base(pd.DataFrame(grid), ts)
# 앱에 쓰는 값 = max(GBDT, 같은 요일·시간 평균) — 과소 안내를 막는 안전 규칙
g["pop"] = np.exp(np.fmax(mf.predict(g[FEATS]), g["base"].values)) * g["cd"].map(med)
fc = {}
for cd, gg in g.groupby("cd"):
    q = qall.loc[cd].values  # 5,25,50,75,95
    # 혼잡 부담 0~100: 장소 자기 분포에서 5%→0, 95%→100 선형 (Seoul 혼잡 단계가 장소별 기준인 것과 같은 방식)
    burden = np.clip((gg["pop"].values - q[0]) / (q[4] - q[0]) * 100, 0, 100)
    lv = levels(gg["pop"].values, q[1:4])
    fc[cd] = {"b": [[int(round(x)) for x in burden[d * 24:(d + 1) * 24]] for d in range(7)],
              "lv": [[int(x) for x in lv[d * 24:(d + 1) * 24]] for d in range(7)],
              "pop": [[int(round(x, -2)) for x in gg["pop"].values[d * 24:(d + 1) * 24]] for d in range(7)]}
json.dump({"made": str(pd.Timestamp.now().date()), "source": "서울 생활인구(행정동) 2026-05~07 → 주요 121장소 영역 겹침, LightGBM",
           "validation": report, "places": meta, "forecast": fc},
          open(OUT / "forecast.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(report, open(HERE / "validation.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
imp = dict(zip(FEATS, mf.feature_importance("gain").round(1).tolist()))
print("중요도", imp)
print("저장", OUT / "forecast.json")
