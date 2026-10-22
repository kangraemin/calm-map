"""S-DoT(서울시 도시데이터 센서) 거리 소음을 120장소에 붙인다.
입력: 주간 CSV 여러 개(cp949), 설치 위치 xlsx, 121장소 shp
규칙: 장소 영역 안 센서(없으면 영역 경계에서 300m 안). 요일×시간마다 센서별 '소음 평균'의 중앙값 → 장소 안 센서 중 높은 쪽(90번째 백분위)
       → 소리 크기 지수 = (dB - 50) / 35 × 100 (앱 실시간 측정과 같은 식). 밝기는 바깥 햇빛이라 쓰지 않는다.
실행: python sdot.py <csv 폴더> <위치 xlsx> <shp(확장자 없이)>
"""
import csv, json, sys
from pathlib import Path
import numpy as np, pandas as pd, shapefile
from shapely.geometry import shape, Point
csv_dir, loc_x, shp_path = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
OUT = Path(__file__).resolve().parent.parent / "site/data/forecast.json"
fc = json.loads(OUT.read_text())
loc = pd.read_excel(loc_x)
pos = {}
for _, r in loc.iterrows():
    for k in ("모델 시리얼(*)", "변경 전 시리얼(데이터 상 표기)"):
        if isinstance(r[k], str): pos[r[k].strip()] = (r["경도"], r["위도"])
frames = []
for f in sorted(csv_dir.glob("f_2026*")):
    rows = []
    with open(f, encoding="cp949", errors="replace", newline="") as fh:
        rd = csv.reader(fh); next(rd)
        for r in rd:
            if len(r) > 25 and r[25]: rows.append((r[1], r[2], r[25]))
    frames.append(pd.DataFrame(rows, columns=["sn", "t", "db"]))
x = pd.concat(frames); x["db"] = pd.to_numeric(x["db"], errors="coerce"); x = x.dropna()
x = x[(x.db > 20) & (x.db < 120)]
x["t"] = pd.to_datetime(x["t"], format="%Y-%m-%d_%H:%M:%S", errors="coerce"); x = x.dropna()
x["dow"] = x.t.dt.dayofweek; x["h"] = x.t.dt.hour
days = (x.t.max() - x.t.min()).days + 1
prof = x.groupby(["sn", "dow", "h"]).db.median()
sf = shapefile.Reader(shp_path, encoding="utf-8")
fields = [f[0] for f in sf.fields[1:]]
geo = {}
for sr in sf.shapeRecords():
    rec = dict(zip(fields, sr.record)); cd = next(v for k, v in rec.items() if isinstance(v, str) and v.startswith("POI"))
    geo[cd] = shape(sr.shape.__geo_interface__)
sns = [s for s in prof.index.get_level_values(0).unique() if s in pos]
pts = {s: Point(*pos[s]) for s in sns}
n_has = 0
for cd, g in geo.items():
    if cd not in fc["forecast"]: continue
    inside = [s for s, p in pts.items() if g.contains(p)]
    how = "영역 안"
    if not inside:
        inside = [s for s, p in pts.items() if g.distance(p) < 0.0033]; how = "300m 안"
    if not inside: continue
    arr = np.full((len(inside), 7, 24), np.nan)
    for i, s in enumerate(inside):
        ps = prof.loc[s]
        for (d, h), v in ps.items(): arr[i, d, h] = v
    db = np.nanpercentile(arr, 90, axis=0)
    if np.isnan(db).mean() > 0.3: continue
    db = pd.DataFrame(db).ffill(axis=1).bfill(axis=1).values
    fc["forecast"][cd]["street"] = {"db": np.round(db).astype(int).tolist(), "n": len(inside), "how": how}
    n_has += 1
fc["street_src"] = f"S-DoT 거리 소음 {x.t.min():%Y-%m-%d}~{x.t.max():%Y-%m-%d} ({days}일), 센서 {len(sns)}대"
OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")))
print("places with street noise:", n_has, "/", len(fc["forecast"]), fc["street_src"])
