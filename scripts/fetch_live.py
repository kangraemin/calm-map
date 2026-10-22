"""서울시 실시간 도시데이터(인구 혼잡도)를 받아 site/data/live.json 에 쓴다.
인증키(SEOUL_API_KEY, 서울 열린데이터광장 일반 인증키)가 없으면 빈 파일을 쓰고, 앱은 예측값만 보여 준다.
http://openapi.seoul.go.kr:8088/{KEY}/json/citydata_ppltn/1/5/{장소코드}
"""
import json, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
key = os.environ.get("SEOUL_API_KEY", "").strip()
places = json.loads((ROOT / "site/data/forecast.json").read_text())["places"]
out = {"areas": {}}
if key:
    for cd in places:
        url = f"http://openapi.seoul.go.kr:8088/{key}/json/citydata_ppltn/1/5/{cd}"
        try:
            d = json.load(urllib.request.urlopen(url, timeout=15))
            r = d["SeoulRtd.citydata_ppltn"][0]
            out["areas"][cd] = {"lvl": r["AREA_CONGEST_LVL"], "time": r["PPLTN_TIME"]}
        except Exception as e:  # 한 곳 실패는 건너뜀
            print(cd, "skip", type(e).__name__, file=sys.stderr)
(ROOT / "site/data/live.json").write_text(json.dumps(out, ensure_ascii=False))
print("live areas:", len(out["areas"]))
