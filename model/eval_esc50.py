"""ESC-50(2,000개 5초 소리, 50종)으로 앱의 소리 묶음 판정을 시험한다.

앱과 같은 코드(site/app.js의 window.__cm.evalClip)를 실제 브라우저에서 돌린다.
사용: python3 model/eval_esc50.py <ESC-50-master 폴더> <사이트 주소, 예: http://127.0.0.1:18431/>
결과: model/esc50_result.json
"""
import base64, csv, json, sys, wave
from pathlib import Path
import numpy as np
from playwright.sync_api import sync_playwright

ROOT, URL = Path(sys.argv[1]), sys.argv[2]
# 묶음별 '맞혀야 하는' ESC-50 종류. 나머지 종류는 그 묶음이 울리면 잘못 울린 것으로 센다.
POS = {
    "alarm": {"siren", "clock_alarm", "car_horn"},
    "human": {"crying_baby"},
    "machine": {"vacuum_cleaner", "chainsaw", "hand_saw", "engine", "toilet_flush", "washing_machine"},  # 변기 물·세탁기는 기계음 묶음에 일부러 넣은 소리
}

def load16k(p):
    with wave.open(str(p)) as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32)
    if ch > 1: x = x.reshape(-1, ch).mean(1)
    t = np.arange(int(len(x) * 16000 / sr)) * sr / 16000
    y = np.interp(t, np.arange(len(x)), x).astype(np.int16)
    return base64.b64encode(y.tobytes()).decode()

rows = list(csv.DictReader(open(ROOT / "meta" / "esc50.csv")))
out = []
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--mute-audio"])
    pg = b.new_page()
    pg.goto(URL); pg.wait_for_function("() => !!(window.__cm && window.__cm.evalClip)")
    pg.evaluate("window.__cm.warm().then(()=>1)")
    for i, r in enumerate(rows):
        b64 = load16k(ROOT / "audio" / r["filename"])
        res = pg.evaluate("""async (b64) => { const s = atob(b64), n = s.length / 2, a = new Float32Array(n);
          for (let i = 0; i < n; i++) { let v = s.charCodeAt(2*i) | (s.charCodeAt(2*i+1) << 8); if (v > 32767) v -= 65536; a[i] = v / 32768; }
          return await window.__cm.evalClip(a, 16000); }""", b64)
        out.append({"file": r["filename"], "cat": r["category"], "hit": res["hit"]})
        if i % 200 == 0: print(i, r["category"], res["hit"], flush=True)
    b.close()

summary = {}
for g, pos in POS.items():
    P = [o for o in out if o["cat"] in pos]; N = [o for o in out if o["cat"] not in pos]
    tp = sum(g in o["hit"] for o in P); fp = sum(g in o["hit"] for o in N)
    fpc = {}
    for o in N:
        if g in o["hit"]: fpc[o["cat"]] = fpc.get(o["cat"], 0) + 1
    summary[g] = {"positive_classes": sorted(pos), "n_pos": len(P), "recall": round(tp / len(P), 3),
                  "n_neg": len(N), "false_alarm": round(fp / len(N), 3),
                  "precision": round(tp / max(1, tp + fp), 3),
                  "per_class_recall": {c: round(sum(g in o["hit"] for o in P if o["cat"] == c) / 40, 3) for c in sorted(pos)},
                  "top_false": sorted(fpc.items(), key=lambda x: -x[1])[:5]}
json.dump({"dataset": "ESC-50 (Piczak 2015), 2,000 clips x 5s, 50 classes", "rule": "site/app.js evalClip: 0.975s window, 0.5s hop, EMA, group threshold",
           "summary": summary, "clips": out}, open(Path(__file__).parent / "esc50_result.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(summary, ensure_ascii=False, indent=1))
