// 무던한 지도 (Calm Map) — 아이디어 챌린지 수상 후보작 8번 구현 시제품
// 원칙(제안자 사전질의 답변서 2026-10): ① 상쇄하지 않는다(종합=최댓값) ② 모르는 것은 0이 아니라 '모름'
// ③ 근거가 엇갈리거나 추정뿐이면 '무던함'으로 추천하지 않는다.
import { AudioClassifier, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@0.10.21/audio_bundle.mjs";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const store = {
  get(k, d) { try { const v = localStorage.getItem("cm." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("cm." + k, JSON.stringify(v)); } catch {} },
};

// ---------- 소리 묶음 (제안자 답변서 질의3의 우선순위) ----------
const GROUPS = [
  { id: "alarm", ko: "경보음·사이렌", idx: 90, th: 0.15,
    names: ["Alarm", "Fire alarm", "Smoke detector, smoke alarm", "Siren", "Civil defense siren", "Police car (siren)", "Ambulance (siren)", "Fire engine, fire truck (siren)", "Emergency vehicle", "Buzzer", "Beep, bleep", "Alarm clock", "Car alarm", "Foghorn", "Air horn, truck horn", "Vehicle horn, car horn, honking", "Reversing beeps", "Whistle"] },
  { id: "human", ko: "비명·울음·고함", idx: 80, th: 0.2,
    names: ["Screaming", "Shout", "Yell", "Children shouting", "Baby cry, infant cry", "Crying, sobbing", "Wail, moan", "Bellow", "Battle cry", "Whoop", "Whimper", "Groan"] },
  { id: "machine", ko: "기계음(드라이어·청소기)", idx: 65, th: 0.2,
    names: ["Hair dryer", "Vacuum cleaner", "Blender", "Drill", "Power tool", "Jackhammer", "Sawing", "Electric shaver, electric razor", "Lawn mower", "Chainsaw", "Hammer", "Toilet flush", "Mechanical fan", "Air conditioning", "Dental drill, dentist's drill", "Engine", "White noise", "Pink noise", "Static"] },
  { id: "announce", ko: "안내방송(추정)", idx: 75, th: 1, names: [] }, // 차임 뒤 말소리, 또는 급히 커진 말소리
  { id: "steady", ko: "웅성임·음악", idx: 0, th: 0.25,
    names: ["Crowd", "Hubbub, speech noise, speech babble", "Music", "Television", "Chatter", "Background music", "Babbling", "Pop music", "Children playing", "Applause", "Cheering", "Traffic noise, roadway noise", "Musical instrument", "Piano", "Keyboard (musical)", "Electronic music", "Synthesizer"] },
];
const SPEECH = ["Speech", "Male speech, man speaking", "Female speech, woman speaking", "Narration, monologue", "Conversation", "Speech synthesizer", "Child speech, kid speaking"];
const CHIME = ["Chime", "Ding-dong", "Doorbell", "Ding", "Bell", "Jingle bell", "Wind chime", "Tubular bells", "Glockenspiel", "Vibraphone", "Change ringing (campanology)", "Church bell", "Bicycle bell", "Sine wave", "Tuning fork"];
const KO = { Speech: "말소리", "Male speech, man speaking": "남자 말소리", "Female speech, woman speaking": "여자 말소리", Music: "음악", Siren: "사이렌", "Ambulance (siren)": "구급차 사이렌", "Emergency vehicle": "긴급차량", "Civil defense siren": "민방위 사이렌", Chime: "차임", "Ding-dong": "딩동", Bell: "종소리", Crowd: "군중", "Hubbub, speech noise, speech babble": "웅성임", "Hair dryer": "드라이어", "Vacuum cleaner": "청소기", "White noise": "백색소음", "Pink noise": "잡음", Silence: "조용함", Inside: "실내", "Inside, small room": "작은 방", "Inside, large room or hall": "넓은 실내", "Baby cry, infant cry": "아기 울음", Screaming: "비명", Shout: "고함", Alarm: "경보", Buzzer: "버저", "Beep, bleep": "삐 소리", "Narration, monologue": "낭독", Television: "TV", "Background music": "배경음악", Piano: "피아노", "Sine wave": "순음", Static: "잡음", "Mechanical fan": "환풍기", Engine: "엔진", Vehicle: "차량", "Speech synthesizer": "합성 음성", "Musical instrument": "악기", "Electronic music": "전자음악", Synthesizer: "신시사이저", "Tuning fork": "순음", Glockenspiel: "글로켄슈필", Vibraphone: "비브라폰", "Wind chime": "풍경", "Air conditioning": "에어컨", "Child speech, kid speaking": "아이 말소리", Whistle: "호루라기", Conversation: "대화" };

const SENS_ITEMS = [
  { id: "alarm", ko: "경보음·사이렌", hint: "화재경보, 구급차, 삐 소리" },
  { id: "human", ko: "비명·울음·고함", hint: "다른 아이 울음, 소리 지름" },
  { id: "machine", ko: "기계음", hint: "핸드드라이어, 청소기, 드릴" },
  { id: "announce", ko: "안내방송", hint: "딩동 뒤 나오는 방송, 갑자기 큰 말소리" },
  { id: "onset", ko: "갑자기 커지는 소리", hint: "쾅, 문 닫힘, 갑작스러운 소리 전부" },
  { id: "steady", ko: "웅성임·음악", hint: "계속 깔리는 소리" },
  { id: "crowd", ko: "사람 많음", hint: "붐비는 시간" },
  { id: "light", ko: "밝은 빛·깜빡임", hint: "형광등, 깜빡이는 조명" },
];
const SLEVEL = ["보통", "민감", "매우 민감"];
let profile = store.get("profile", { sens: { alarm: 1, announce: 2, onset: 1 }, calib: 95 });
const sens = (id) => profile.sens[id] || 0;
const weight = (id) => [1, 1.2, 1.35][sens(id)];

// ---------- 화면 전환 ----------
function go(v) {
  $$(".view").forEach((s) => s.classList.toggle("on", s.id === "v-" + v));
  $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.go === v));
  if (v === "map") initMap();
  if (v === "log") renderLog();
  if (v === "about") renderAbout();
  if (v === "kid") renderKid();
  window.scrollTo(0, 0);
  try { history.replaceState(null, "", "#" + v); } catch {}
}
$$("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

// ---------- 소리 엔진 ----------
let classifier = null, actx = null, proc = null, srcNode = null, mediaStream = null, clipEl = null;
let ring = null, ringPos = 0, filled = 0, sr = 48000, lastCls = 0;
let levels = []; // 100ms 단위 dBFS (최근 60초)
let blockSum = 0, blockN = 0;
let ema = {}; let events = []; let session = null;
const tickMs = 500;

async function loadModel() {
  if (classifier) return classifier;
  $("#modelState").textContent = "소리 분류 모델을 폰으로 내려받는 중… (4MB, 처음 한 번)";
  const fs = await FilesetResolver.forAudioTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@0.10.21/wasm");
  classifier = await AudioClassifier.createFromOptions(fs, { baseOptions: { modelAssetPath: "models/yamnet.tflite" }, maxResults: 521, scoreThreshold: 0 });
  $("#modelState").textContent = "소리 분류: Google YAMNet(AudioSet 521종) · 폰 안에서 실행 중 · 원음 저장·전송 없음";
  return classifier;
}

async function start(kind, clip) {
  await stop(false);
  $("#btnMic").disabled = true;
  try {
    await loadModel();
    actx = new (window.AudioContext || window.webkitAudioContext)();
    sr = actx.sampleRate;
    ring = new Float32Array(Math.round(sr * 0.975)); ringPos = 0; filled = 0;
    levels = []; ema = {}; events = []; blockSum = 0; blockN = 0;
    session = { kind, clip: clip || null, t0: Date.now(), loud: [], type: [], groups: {}, onsets: 0, announce: 0, top: {} };
    if (kind === "mic") {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      srcNode = actx.createMediaStreamSource(mediaStream);
    } else {
      clipEl = new Audio("sounds/" + clip + ".mp3");
      clipEl.crossOrigin = "anonymous";
      srcNode = actx.createMediaElementSource(clipEl);
      srcNode.connect(actx.destination);
      clipEl.addEventListener("ended", () => stop(true));
      await clipEl.play();
    }
    proc = actx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = onAudio;
    srcNode.connect(proc);
    const mute = actx.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(actx.destination);
    $("#btnMic").hidden = true; $("#btnStop").hidden = false;
    $("#nowWord").textContent = "듣는 중"; $("#nowWhy").textContent = kind === "mic" ? "폰 마이크로 듣고 있어요" : "합성 시연음을 들려주고 있어요";
    $$("#samples button").forEach((b) => b.classList.toggle("on", b.dataset.clip === clip));
  } catch (e) {
    console.error(e);
    $("#nowWord").textContent = "시작 못 함";
    $("#nowWhy").textContent = e && e.name === "NotAllowedError" ? "마이크 권한이 필요해요. 아래 '마이크 없이 해 보기'도 있어요." : "이 브라우저에서 시작하지 못했어요 (" + (e.message || e) + ")";
    $("#btnMic").hidden = false; $("#btnStop").hidden = true;
  }
  $("#btnMic").disabled = false;
}

async function stop(save) {
  if (proc) { proc.disconnect(); proc.onaudioprocess = null; proc = null; }
  if (srcNode) { try { srcNode.disconnect(); } catch {} srcNode = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  if (clipEl) { clipEl.pause(); clipEl = null; }
  if (actx) { try { await actx.close(); } catch {} actx = null; }
  $("#btnMic").hidden = false; $("#btnStop").hidden = true;
  $$("#samples button").forEach((b) => b.classList.remove("on"));
  if (save && session && session.loud.length >= 6) openSave(summarize(session));
}

function onAudio(e) {
  const x = e.inputBuffer.getChannelData(0);
  for (let i = 0; i < x.length; i++) {
    ring[ringPos] = x[i]; ringPos = (ringPos + 1) % ring.length; if (filled < ring.length) filled++;
    blockSum += x[i] * x[i]; blockN++;
    if (blockN >= sr / 10) { // 100ms 블록
      const db = 10 * Math.log10(blockSum / blockN + 1e-12);
      levels.push(db); if (levels.length > 600) levels.shift();
      blockSum = 0; blockN = 0;
    }
  }
  const now = performance.now();
  if (now - lastCls > tickMs && filled === ring.length) { lastCls = now; tick(); }
}

const pct = (arr, p) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const dbA = (dbfs) => dbfs + (profile.calib || 95); // 보정 전 어림값

function tick() {
  const buf = new Float32Array(ring.length);
  buf.set(ring.subarray(ringPos)); buf.set(ring.subarray(0, ringPos), ring.length - ringPos);
  let res;
  try { res = classifier.classify(buf, sr); } catch (e) { console.warn(e); return; }
  const cats = (res && res[0] && res[0].classifications[0].categories) || [];
  const score = {}; cats.forEach((c) => { score[c.categoryName] = c.score; });
  const t = Date.now();
  const raw = {};
  for (const g of GROUPS) raw[g.id] = Math.max(0, ...g.names.map((n) => score[n] || 0));
  raw.speech = Math.max(0, ...SPEECH.map((n) => score[n] || 0));
  raw.chime = Math.max(0, ...CHIME.map((n) => score[n] || 0));
  for (const k in raw) ema[k] = ema[k] == null ? raw[k] : ema[k] * 0.45 + raw[k] * 0.55;

  // 소리 크기와 돌발성 (직전 1분 LA90 대비 1초 안에 10dB 이상 상승)
  const recent = levels.slice(-10), older = levels.slice(-20, -10);
  const now1 = Math.max(...recent), la90 = pct(levels.slice(0, -10), 0.1);
  const enough = levels.length >= 80; // 8초 이상 들은 뒤부터 판단
  let onset = false;
  if (enough && now1 - la90 >= 10 && (older.length ? Math.min(...older) : -200) < la90 + 6) {
    const last = events.filter((e) => e.k === "onset").pop();
    if (!last || t - last.t > 2500) { onset = true; events.push({ k: "onset", t }); session.onsets++; }
  }
  if (raw.chime > 0.12) events.push({ k: "chime", t });
  const chimeRecent = events.some((e) => e.k === "chime" && t - e.t < 5000);
  const onsetRecent = events.some((e) => e.k === "onset" && t - e.t < 2000);
  let announce = raw.speech > 0.35 && (chimeRecent || onsetRecent);
  if (announce) { const la = events.filter((e) => e.k === "announce").pop(); if (!la || t - la.t > 6000) { events.push({ k: "announce", t }); session.announce++; } }
  events = events.filter((e) => t - e.t < 60000);
  const announceOn = events.some((e) => e.k === "announce" && t - e.t < 4000);

  const avg = 10 * Math.log10(recent.reduce((s, d) => s + Math.pow(10, d / 10), 0) / Math.max(1, recent.length));
  const loudIdx = clamp((dbA(avg) - 50) / 35 * 100);
  const hits = [];
  let typeIdx = 0, caution = null;
  for (const g of GROUPS) {
    const on = g.id === "announce" ? announceOn : (ema[g.id] || 0) >= g.th;
    if (!on) continue;
    hits.push(g.id);
    session.groups[g.id] = (session.groups[g.id] || 0) + 1;
    let v = g.idx * weight(g.id);
    if (sens(g.id) === 2 && g.idx > 0) { v = Math.max(v, 70); caution = caution || g; }
    if (sens(g.id) === 2 && g.id === "steady") caution = caution || g;
    typeIdx = Math.max(typeIdx, v);
  }
  const onsetOn = events.some((e) => e.k === "onset" && t - e.t < 3000);
  if (onsetOn) {
    typeIdx = Math.max(typeIdx, 75 * weight("onset"));
    if (sens("onset") === 2) caution = caution || { id: "onset", ko: "갑자기 커지는 소리" };
  }
  typeIdx = clamp(typeIdx);
  const lightIdx = lightNow == null ? null : clamp((lightNow - 300) / 1700 * 100);
  const parts = [["소리 크기", loudIdx], ["소리 종류·돌발성", typeIdx]]; if (lightIdx != null) parts.push(["밝기", lightIdx]);
  const comp = Math.max(...parts.map((p) => p[1]));
  const main = parts.reduce((a, b) => (b[1] > a[1] ? b : a));
  session.loud.push(loudIdx); session.type.push(typeIdx);
  cats.slice(0, 3).forEach((c) => { if (c.score > 0.2) session.top[c.categoryName] = (session.top[c.categoryName] || 0) + 1; });
  render({ comp, main, hits, caution, loudIdx, typeIdx, avg, la90: enough ? la90 : NaN, cats, onset });
}

let lastVibe = 0;
function render(s) {
  const lv = level(s.comp);
  $("#meter").className = "meter card lv" + lv.i;
  $("#nowWord").textContent = lv.word;
  const why = s.hits.filter((h) => h !== "steady").map((h) => GROUPS.find((g) => g.id === h).ko);
  $("#nowWhy").textContent = "주 요인: " + s.main[0] + (why.length ? " · " + why.join(", ") : "");
  $("#nowNum").textContent = Math.round(s.comp);
  $("#nowDial").style.setProperty("--p", s.comp);
  $("#groups").innerHTML = GROUPS.map((g) => {
    const v = g.id === "announce" ? (s.hits.includes("announce") ? 1 : Math.min(0.9, (ema.speech || 0) * ((ema.chime || 0) > 0.1 ? 1 : 0.4))) : ema[g.id] || 0;
    const hit = s.hits.includes(g.id);
    return `<div class="g ${hit ? "hit" : ""}"><b>${g.ko}${sens(g.id) === 2 ? '<span class="mine">우리 아이</span>' : ""}</b><div class="bar"><i style="width:${Math.round(clamp(v * 100))}%"></i></div><small>${hit ? "잡힘" : ""}</small></div>`;
  }).join("");
  $("#dbNow").textContent = Math.round(dbA(s.avg)) + " dB";
  $("#dbBase").textContent = isNaN(s.la90) ? "재는 중" : Math.round(dbA(s.la90)) + " dB";
  $("#onsetN").textContent = (session ? session.onsets : 0) + "번";
  $("#heard").textContent = "모델이 들은 것: " + s.cats.slice(0, 4).map((c) => `${KO[c.categoryName] || c.categoryName} ${Math.round(c.score * 100)}%`).join(" · ");
  const al = $("#alert");
  if (s.caution) {
    al.hidden = false;
    $("#alertTitle").textContent = "주의 · " + (s.caution.ko || "") + " 잡힘";
    $("#alertBody").textContent = "우리 아이가 매우 민감한 소리예요. 헤드폰을 씌우거나 조용한 곳으로 옮겨 주세요.";
    if (Date.now() - lastVibe > 4000 && navigator.vibrate) { navigator.vibrate([250, 120, 250]); lastVibe = Date.now(); }
  } else al.hidden = true;
  drawSpark();
}

function drawSpark() {
  const c = $("#spark"), ctx = c.getContext("2d");
  const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = 56 * devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  if (levels.length < 2) return;
  const lo = -80, hi = -10;
  ctx.strokeStyle = "#234a3f"; ctx.lineWidth = 2 * devicePixelRatio; ctx.beginPath();
  levels.forEach((d, i) => { const x = (i / 599) * w, y = h - ((clamp(d, lo, hi) - lo) / (hi - lo)) * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  const la = pct(levels, 0.1); const y = h - ((clamp(la, lo, hi) - lo) / (hi - lo)) * h;
  ctx.setLineDash([4, 4]); ctx.strokeStyle = "#55605a"; ctx.lineWidth = 1 * devicePixelRatio; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#9a3b1c";
  events.filter((e) => e.k === "onset").forEach((e) => { const age = (Date.now() - e.t) / 100; const x = w - (age / 600) * w * (levels.length / 600); ctx.fillRect(x - 1, 0, 3 * devicePixelRatio, h); });
}

function level(v) {
  if (v == null) return { i: -1, word: "정보 부족" };
  if (v < 40) return { i: 0, word: "무던함" };
  if (v < 70) return { i: 1, word: "보통" };
  return { i: 2, word: "부담 높음" };
}

// 밝기: 웹에 밝기 센서를 여는 브라우저에서만. 없으면 '미측정'. 깜빡임은 늘 '미측정'.
let lightNow = null;
try {
  if ("AmbientLightSensor" in window) {
    const ls = new window.AmbientLightSensor({ frequency: 2 });
    ls.addEventListener("reading", () => { lightNow = ls.illuminance; });
    ls.start();
  }
} catch {}

function summarize(s) {
  const d = new Date();
  return {
    ts: d.toISOString(), dow: (d.getDay() + 6) % 7, hour: d.getHours(), kind: s.kind, clip: s.clip,
    dur: Math.round((Date.now() - s.t0) / 1000),
    loud: Math.round(pct(s.loud, 0.9)), // 과소 안내를 막으려고 90번째 백분위
    type: Math.round(Math.max(...s.type)),
    light: lightNow == null ? null : Math.round(clamp((lightNow - 300) / 1700 * 100)),
    groups: Object.keys(s.groups).filter((k) => s.groups[k] >= 2 || k === "announce"),
    onsets: s.onsets, announce: s.announce,
    top: Object.entries(s.top).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]),
  };
}

$("#btnMic").addEventListener("click", () => start("mic"));
$("#btnStop").addEventListener("click", () => stop(true));
$$("#samples button").forEach((b) => b.addEventListener("click", () => start("clip", b.dataset.clip)));

// ---------- 데이터 ----------
let FC = null, LIVE = null;
const dataReady = (async () => {
  FC = await (await fetch("data/forecast.json")).json();
  try { const r = await fetch("data/live.json", { cache: "no-store" }); if (r.ok) LIVE = await r.json(); } catch {}
  return FC;
})();
let obs = store.get("obs", []);
let fb = store.get("fb", []);
const CATS = ["전체", "공원", "고궁·문화유산", "발달상권", "관광특구", "인구밀집지역"];

// ---------- 기록 저장 ----------
let pendingObs = null;
async function openSave(o) {
  await dataReady;
  pendingObs = o;
  const gl = o.groups.filter((g) => g !== "steady").map((g) => GROUPS.find((x) => x.id === g)?.ko).filter(Boolean);
  $("#saveSummary").textContent = `${o.dur}초 · 소리 크기 ${o.loud} · 소리 종류·돌발성 ${o.type}${gl.length ? " · " + gl.join(", ") : ""}${o.kind === "clip" ? " · 합성 시연음(연습용 기록)" : ""}`;
  $("#placeSearch").value = "";
  let near = null;
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000, maximumAge: 600000 }));
    near = [pos.coords.latitude, pos.coords.longitude];
  } catch {}
  renderPick("", near);
  $("#dlgSave").showModal();
}
function renderPick(q, near) {
  let list = Object.entries(FC.places).map(([cd, p]) => ({ cd, ...p, dist: near ? Math.hypot((p.lat - near[0]) * 111, (p.lng - near[1]) * 88) : null }));
  if (q) list = list.filter((p) => p.nm.includes(q) || p.cat.includes(q));
  list.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || a.nm.localeCompare(b.nm));
  $("#placePick").innerHTML = list.slice(0, 40).map((p) => `<button type="button" data-cd="${p.cd}">${p.nm}<small>${p.cat}${p.dist != null ? " · " + p.dist.toFixed(1) + "km" : ""}</small></button>`).join("");
  $$("#placePick button").forEach((b) => b.addEventListener("click", () => {
    obs.push({ cd: b.dataset.cd, ...pendingObs }); store.set("obs", obs);
    $("#dlgSave").close(); go("map"); setTimeout(() => openPlace(b.dataset.cd), 300);
  }));
}
$("#placeSearch").addEventListener("input", (e) => renderPick(e.target.value.trim(), null));

// ---------- 종합 지수 (장소 × 요일 × 시간) ----------
function crowdAt(cd, dow, h) { return FC.forecast[cd] ? FC.forecast[cd].b[dow][h] : null; }
function crowdLv(cd, dow, h) { return FC.forecast[cd] ? FC.forecast[cd].lv[dow][h] : null; }
const isOff = (dow) => dow >= 5;
function placeObs(cd) { return obs.filter((o) => o.cd === cd); }
function cell(cd, dow, h) {
  const crowd = crowdAt(cd, dow, h);
  const os = placeObs(cd);
  const crowdW = clamp(crowd * weight("crowd"));
  if (!os.length) return { crowd, comp: null, est: true, measured: false, caution: null, main: "주변 지역 혼잡" };
  // 같은 평일/주말 · ±1시간 실측이 있으면 실측, 없으면 혼잡 모양으로 보간한 추정
  const same = os.filter((o) => isOff(o.dow) === isOff(dow) && Math.abs(o.hour - h) <= 1);
  let loud, measured;
  if (same.length) { loud = Math.max(...same.map((o) => o.loud)); measured = true; }
  else {
    loud = Math.max(...os.map((o) => clamp(o.loud + (crowd - crowdAt(cd, o.dow, o.hour)) * 0.5)));
    measured = false;
  }
  const type = Math.max(...os.map((o) => o.type)); // 방송·음악·기계음은 매장 운영 특성이라 시간대와 무관하게 유지
  const lightVals = os.map((o) => o.light).filter((x) => x != null);
  const light = lightVals.length ? Math.max(...lightVals) : null;
  const parts = [["주변 지역 혼잡", crowdW], ["소리 크기", loud], ["소리 종류·돌발성", type]];
  if (light != null) parts.push(["밝기", light]);
  const top = parts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const groups = new Set(os.flatMap((o) => o.groups.concat(o.onsets ? ["onset"] : [])));
  let caution = null;
  for (const it of SENS_ITEMS) if (sens(it.id) === 2 && groups.has(it.id)) { caution = it; break; }
  if (!caution && sens("light") === 2 && light == null) caution = { id: "light", ko: "빛(아직 못 잼)" };
  return { crowd, comp: top[1], main: top[0], est: !measured, measured, caution, loud, type, light, groups };
}

function verdictOf(c) {
  if (c.comp == null) return { cls: "unknown", title: "정보 부족", body: "이 장소의 소리·빛 정보가 아직 없어요. 종합 지수는 보류하고 주변 지역 혼잡만 보여 줘요." };
  const lv = level(c.comp);
  if (c.caution) return { cls: "caution", title: "주의 · " + c.caution.ko, body: "우리 아이가 매우 민감한 자극이 이 장소에서 잡혔어요. 다른 값이 낮아도 무던함으로 추천하지 않아요." };
  if (lv.i === 0 && c.est) return { cls: "", title: "무던함 후보 (추정)", body: "이 시간엔 직접 잰 기록이 없어 혼잡 예측으로 짐작한 값이에요. 실측 전까지 무던함으로 추천하지 않아요." };
  return { cls: lv.i === 2 ? "caution" : "", title: lv.word + (c.est ? " (추정)" : " (실측)"), body: "주 요인: " + c.main };
}

// ---------- 지도 ----------
let map = null, layer = null, sel = { day: 0, hour: null, cat: "전체" };
async function initMap() {
  await dataReady;
  if (map) { map.invalidateSize(); drawMarkers(); return; }
  const now = new Date();
  sel.hour = clamp(now.getHours() + (now.getMinutes() > 30 ? 1 : 0), 7, 22);
  const names = ["월", "화", "수", "목", "금", "토", "일"];
  $("#days").innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() + i);
    const lbl = i === 0 ? "오늘" : i === 1 ? "내일" : `${d.getMonth() + 1}/${d.getDate()}`;
    return `<button data-i="${i}" class="${i === 0 ? "on" : ""}">${lbl} ${names[(d.getDay() + 6) % 7]}</button>`;
  }).join("");
  $$("#days button").forEach((b) => b.addEventListener("click", () => { sel.day = +b.dataset.i; $$("#days button").forEach((x) => x.classList.toggle("on", x === b)); drawMarkers(); refreshSheet(); }));
  $("#cats").innerHTML = CATS.map((c) => `<button class="${c === "전체" ? "on" : ""}">${c}</button>`).join("");
  $$("#cats button").forEach((b) => b.addEventListener("click", () => { sel.cat = b.textContent; $$("#cats button").forEach((x) => x.classList.toggle("on", x === b)); drawMarkers(); }));
  const hr = $("#hour"); hr.value = sel.hour;
  hr.addEventListener("input", () => { sel.hour = +hr.value; drawMarkers(); refreshSheet(); });
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView([37.548, 126.99], 11);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 18, attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  layer = L.layerGroup().addTo(map);
  drawMarkers();
}
function selDow() { const d = new Date(); d.setDate(d.getDate() + sel.day); return (d.getDay() + 6) % 7; }
const SHADE = ["#e8eee9", "#b9cbbf", "#6f8f80", "#2c4a3f"];
function drawMarkers() {
  if (!layer) return;
  layer.clearLayers();
  const dow = selDow(), h = sel.hour;
  $("#hourLabel").textContent = `${h}시`;
  for (const [cd, p] of Object.entries(FC.places)) {
    if (sel.cat !== "전체" && p.cat !== sel.cat) continue;
    if (!FC.forecast[cd]) continue;
    const lv = crowdLv(cd, dow, h), c = cell(cd, dow, h);
    const has = c.comp != null;
    const m = L.circleMarker([p.lat, p.lng], {
      radius: has ? 11 : 9, color: c.caution ? "#9a3b1c" : has ? "#1f2421" : "#55605a", weight: has ? 3 : 1.5,
      dashArray: has ? null : "3 3", fillColor: SHADE[lv], fillOpacity: 0.95,
    }).addTo(layer);
    m.bindTooltip(p.nm, { permanent: map.getZoom() >= 13, direction: "right", className: "lbl", offset: [8, 0] });
    m.on("click", () => openPlace(cd));
  }
}

let openCd = null;
function openPlace(cd) {
  openCd = cd; refreshSheet(); $("#sheet").hidden = false;
  const p = FC.places[cd]; if (map) map.panTo([p.lat - 0.01, p.lng]);
}
$("#sheetClose").addEventListener("click", () => { $("#sheet").hidden = true; openCd = null; });
const LVW = ["여유", "보통", "약간 붐빔", "붐빔"];
function refreshSheet() {
  if (!openCd || !FC) return;
  const cd = openCd, p = FC.places[cd], dow = selDow(), h = sel.hour;
  const c = cell(cd, dow, h), v = verdictOf(c);
  const os = placeObs(cd);
  const dayName = $$("#days button")[sel.day]?.textContent || "";
  // 24시간 막대
  const bars = [];
  for (let k = 7; k <= 22; k++) {
    const ck = cell(cd, dow, k);
    const val = ck.comp != null ? ck.comp : ck.crowd;
    bars.push(`<div class="c ${k === h ? "sel" : ""} ${ck.measured ? "meas" : ""}" title="${k}시 ${Math.round(val)}"><i class="${ck.measured ? "" : "est"}" style="height:${Math.max(4, val)}%"></i></div>`);
  }
  // 덜 붐비는 시간 3개
  const cand = [];
  for (let k = 9; k <= 20; k++) { const ck = cell(cd, dow, k); cand.push({ k, v: ck.comp != null ? ck.comp : ck.crowd, ck }); }
  cand.sort((a, b) => a.v - b.v);
  const best = cand.slice(0, 3).sort((a, b) => a.k - b.k);
  const bestTxt = best.map((b) => `${b.k}시`).join(", ");
  const anyMeasuredCalm = best.some((b) => b.ck.measured && b.v < 40 && !b.ck.caution);
  const live = LIVE && LIVE.areas && LIVE.areas[cd];
  const fbs = fb.filter((f) => f.cd === cd);
  const okN = fbs.filter((f) => f.ok).length, hardN = fbs.length - okN;
  const gl = c.groups ? [...c.groups].filter((g) => g !== "steady").map((g) => SENS_ITEMS.find((s) => s.id === g)?.ko).filter(Boolean) : [];
  $("#sheetBody").innerHTML = `
    <h2>${p.nm}</h2>
    <span class="tag">${p.cat}</span>${os.length ? `<span class="tag">소리 기록 ${os.length}건</span>` : `<span class="tag">소리 정보 없음</span>`}${c.caution ? `<span class="tag warn">주의</span>` : ""}
    <div class="verdict ${v.cls}"><span class="kicker">${dayName} ${h}시 · 종합</span><b>${v.title}${c.comp != null ? " · " + Math.round(c.comp) : ""}</b><span>${v.body}</span></div>
    <div class="kicker">${dayName} 시간대별 (7시~22시) · 빗금 = 추정, 진한 막대 = 실측</div>
    <div class="chart">${bars.join("")}<div class="th" style="bottom:40%">40</div><div class="th" style="bottom:70%">70</div></div>
    <div class="axis"><span>7시</span><span>12시</span><span>17시</span><span>22시</span></div>
    <p class="best">덜 붐비는 시간: <b>${bestTxt}</b> ${anyMeasuredCalm ? "" : "<small>(후보 · 실측으로 확인되면 무던함으로 바뀌어요)</small>"}</p>
    <div class="rows">
      <div><span>주변 지역 혼잡 (예측)</span><b>${LVW[crowdLv(cd, dow, h)]} · ${c.crowd}</b></div>
      ${live ? `<div><span>서울시 실시간 (${live.time.slice(11, 16)})</span><b>${live.lvl}</b></div>` : ""}
      <div><span>소리 크기</span><b>${c.loud != null ? Math.round(c.loud) + (c.measured ? " (실측)" : " (추정)") : "모름"}</b></div>
      <div><span>소리 종류·돌발성</span><b>${c.type != null ? Math.round(c.type) + (gl.length ? " · " + gl.join(", ") : "") : "모름"}</b></div>
      <div><span>밝기 / 깜빡임</span><b>${c.light != null ? c.light : "미측정"} / 미측정</b></div>
      <div><span>보호자 후기</span><b>${fbs.length ? `괜찮았어요 ${okN} · 힘들었어요 ${hardN}` : "아직 없음"}</b></div>
    </div>
    <div class="btnrow"><button class="primary" id="mkCard">미리 보는 카드</button><button class="ghost" id="measureHere">여기서 소리 재기</button></div>
    <p class="fine">다녀왔다면 한 번만 눌러 주세요. 점수로 바꾸지 않고 후기로 보여 줘요.</p>
    <div class="fbrow"><button class="ghost" data-ok="1">괜찮았어요</button><button class="ghost" data-ok="0">힘들었어요</button></div>`;
  $("#mkCard").addEventListener("click", () => openStory(cd));
  $("#measureHere").addEventListener("click", () => { go("sound"); start("mic"); });
  $$(".fbrow button").forEach((b) => b.addEventListener("click", () => {
    const ck = cell(cd, dow, h);
    fb.push({ cd, ts: new Date().toISOString(), dow, hour: h, ok: b.dataset.ok === "1", shown: verdictOf(ck).title });
    store.set("fb", fb); refreshSheet();
  }));
}

// ---------- 미리 보는 카드 (사회적 이야기, 규칙으로 채움 · 보호자가 고침) ----------
const ICON = {
  go: '<svg viewBox="0 0 72 72"><path d="M14 60V26l22-14 22 14v34z"/><path d="M30 60V42h12v18"/></svg>',
  door: '<svg viewBox="0 0 72 72"><rect x="20" y="10" width="32" height="52" rx="2"/><circle cx="44" cy="37" r="2"/><path d="M10 62h52"/></svg>',
  people: '<svg viewBox="0 0 72 72"><circle cx="24" cy="24" r="7"/><circle cx="48" cy="24" r="7"/><path d="M10 58c0-10 6-16 14-16s14 6 14 16M34 58c0-10 6-16 14-16s14 6 14 16"/></svg>',
  speaker: '<svg viewBox="0 0 72 72"><path d="M14 28h10l14-12v40L24 44H14z"/><path d="M48 26c4 6 4 14 0 20M54 20c8 10 8 22 0 32"/></svg>',
  phones: '<svg viewBox="0 0 72 72"><path d="M14 44v-6a22 22 0 0 1 44 0v6"/><rect x="10" y="42" width="12" height="18" rx="4"/><rect x="50" y="42" width="12" height="18" rx="4"/></svg>',
  hand: '<svg viewBox="0 0 72 72"><path d="M26 60V30a4 4 0 0 1 8 0v14M34 28v-6a4 4 0 0 1 8 0v22M42 26a4 4 0 0 1 8 0v20M50 32a4 4 0 0 1 8 0v12c0 10-6 16-16 16h-6c-6 0-10-4-14-10l-8-10a4 4 0 0 1 6-5l4 4"/></svg>',
  bench: '<svg viewBox="0 0 72 72"><path d="M10 38h52M14 30h44M18 38v14M54 38v14M14 30V24M58 30V24"/></svg>',
  train: '<svg viewBox="0 0 72 72"><rect x="18" y="10" width="36" height="40" rx="8"/><path d="M18 32h36M26 58l6-8M46 58l-6-8"/><circle cx="28" cy="42" r="2"/><circle cx="44" cy="42" r="2"/></svg>',
  ticket: '<svg viewBox="0 0 72 72"><path d="M10 24h52v8a6 6 0 0 0 0 12v8H10v-8a6 6 0 0 0 0-12z"/><path d="M40 24v28" stroke-dasharray="3 4"/></svg>',
  calm: '<svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="24"/><path d="M26 32h0M46 32h0M26 44c6 5 14 5 20 0"/></svg>',
};
function storyLines(cd) {
  const p = FC.places[cd], dow = selDow(), h = sel.hour, c = cell(cd, dow, h);
  const dayName = $$("#days button")[sel.day]?.textContent || "오늘";
  const enter = { "공원": ["bench", "넓은 길을 따라 천천히 걸어요."], "고궁·문화유산": ["ticket", "입구에서 표를 보여 주고 들어가요."], "발달상권": ["door", "가게 문을 밀고 들어가요."], "관광특구": ["door", "가게 문을 밀고 들어가요."], "인구밀집지역": ["train", "역에서 개찰구를 지나 나가요."] }[p.cat] || ["door", "문을 밀고 들어가요."];
  let expect;
  if (c.groups && c.groups.has("announce")) expect = ["speaker", "안내방송이 나올 수 있어요. 딩동 소리가 먼저 나요."];
  else if (c.groups && c.groups.has("alarm")) expect = ["speaker", "삐 소리나 사이렌이 들릴 수 있어요."];
  else if (c.groups && c.groups.has("machine")) expect = ["speaker", "화장실에서 드라이어 소리가 날 수 있어요."];
  else if (crowdLv(cd, dow, h) >= 2) expect = ["people", "사람이 많을 수 있어요. 엄마 옆에서 걸어요."];
  else expect = ["calm", "사람이 많지 않을 수 있어요."];
  const saved = store.get("cards", {})[cd];
  const lines = [
    ["go", `${dayName} ${h}시에 ${p.nm}에 가요.`],
    enter, expect,
    ["phones", "소리가 크면 헤드폰을 써요."],
    ["hand", "힘들면 엄마 손을 두 번 꼭 잡아요. 그러면 조용한 곳으로 가요."],
  ];
  if (saved) saved.forEach((t, i) => { if (lines[i] && t) lines[i][1] = t; });
  return lines;
}
function openStory(cd) {
  const lines = storyLines(cd);
  $("#story").innerHTML = `<div class="scard head"><p>미리 보는 카드 · 아이와 같이 읽어요</p></div>` + lines.map(([ic, t], i) => `<div class="scard">${ICON[ic]}<p data-i="${i}">${t}</p></div>`).join("");
  $("#story").dataset.cd = cd;
  $("#storyEdit").textContent = "문장 고치기";
  $("#dlgCard").showModal();
}
$("#storyEdit").addEventListener("click", () => {
  const ps = $$("#story p[data-i]"), on = ps[0].contentEditable !== "true";
  ps.forEach((p) => (p.contentEditable = on ? "true" : "false"));
  if (on) { $("#storyEdit").textContent = "고친 문장 저장"; ps[0].focus(); }
  else {
    const cards = store.get("cards", {}); cards[$("#story").dataset.cd] = ps.map((p) => p.textContent.trim()); store.set("cards", cards);
    $("#storyEdit").textContent = "저장했어요";
  }
});
$("#storyClose").addEventListener("click", () => $("#dlgCard").close());

// ---------- 우리 아이 ----------
function renderQuick() {
  $("#quickSens").innerHTML = SENS_ITEMS.slice(0, 6).map((s) => `<button data-id="${s.id}" class="${sens(s.id) === 2 ? "vs" : sens(s.id) === 1 ? "s" : ""}">${s.ko}</button>`).join("");
  $$("#quickSens button").forEach((b) => b.addEventListener("click", () => { profile.sens[b.dataset.id] = sens(b.dataset.id) === 2 ? 0 : 2; store.set("profile", profile); renderQuick(); }));
}
function renderKid() {
  $("#sensList").innerHTML = SENS_ITEMS.map((s) => `<div class="sensrow"><div><b>${s.ko}</b><small>${s.hint}</small></div><div class="seg" data-id="${s.id}">${SLEVEL.map((l, i) => `<button data-v="${i}" class="${sens(s.id) === i ? "on" : ""} ${i === 2 ? "vs" : ""}">${l}</button>`).join("")}</div></div>`).join("");
  $$("#sensList .seg button").forEach((b) => b.addEventListener("click", () => { profile.sens[b.parentNode.dataset.id] = +b.dataset.v; store.set("profile", profile); renderKid(); renderQuick(); }));
  const c = $("#calib"); c.value = profile.calib || 95; $("#calibLabel").textContent = "+" + c.value;
  c.oninput = () => { profile.calib = +c.value; store.set("profile", profile); $("#calibLabel").textContent = "+" + c.value; };
}

// ---------- 기록 ----------
async function renderLog() {
  await dataReady;
  const calmShown = fb.filter((f) => /^무던함/.test(f.shown));
  const hardAfterCalm = calmShown.filter((f) => !f.ok).length;
  $("#logStats").innerHTML = `<div><b>${obs.length}</b><span>소리 기록</span></div><div><b>${fb.length}</b><span>보호자 후기</span></div><div><b>${calmShown.length ? Math.round((hardAfterCalm / calmShown.length) * 100) + "%" : "–"}</b><span>무던함 안내 뒤 힘들었어요</span></div>`;
  const items = [...obs.map((o) => ({ t: o.ts, html: `<b>${FC.places[o.cd]?.nm || o.cd}</b> · 소리 기록${o.kind === "clip" ? " (합성 시연음)" : ""}<small>${o.ts.slice(0, 16).replace("T", " ")} · ${o.dur}초 · 크기 ${o.loud} · 종류·돌발성 ${o.type} · ${o.groups.map((g) => GROUPS.find((x) => x.id === g)?.ko).filter(Boolean).join(", ") || "특이 소리 없음"}</small>` })),
    ...fb.map((f) => ({ t: f.ts, html: `<b>${FC.places[f.cd]?.nm || f.cd}</b> · ${f.ok ? "괜찮았어요" : "힘들었어요"}<small>${f.ts.slice(0, 16).replace("T", " ")} · 그때 안내: ${f.shown}</small>` }))]
    .sort((a, b) => (a.t < b.t ? 1 : -1));
  $("#logList").innerHTML = items.length ? items.map((i) => `<div class="logitem">${i.html}</div>`).join("") : `<p class="fine">아직 기록이 없어요. 소리 탭에서 '멈추고 기록하기'를 누르면 여기에 남아요.</p>`;
}
$("#logClear").addEventListener("click", () => { if (confirm("이 폰에 저장된 소리 기록·후기·카드를 모두 지울까요?")) { obs = []; fb = []; store.set("obs", obs); store.set("fb", fb); store.set("cards", {}); renderLog(); } });

// ---------- 만든 방법 ----------
async function renderAbout() {
  await dataReady;
  const m = FC.validation.methods;
  const row = (k, n) => `<tr><td>${n}</td><td>${m[k].mape}%</td><td>${m[k].level_acc}%</td><td>${m[k].under}%</td><td>${m[k].busy_hit}%</td></tr>`;
  $("#aboutBody").innerHTML = `
  <h2>어떻게 만들었나요</h2>
  <p>2026 AI 라이프 아이디어 챌린지 수상 후보작 <b>8번 「무던한 지도(Calm Map)」</b>를 실제로 돌아가게 만든 시제품입니다. 제안자가 공개한 사전질의 답변서의 규칙을 그대로 따랐습니다.</p>
  <h3>1. 폰 안에서 소리 종류 알아듣기</h3>
  <ul><li>Google YAMNet(AudioSet 521종, 4MB)을 MediaPipe로 브라우저에서 돌립니다. 0.5초마다 최근 1초를 분류합니다.</li>
  <li>521종을 경보음 · 사람의 큰 소리 · 기계음 · 웅성임/음악 묶음으로 나눴습니다(답변서 질의3 순서).</li>
  <li>안내방송은 따로 학습된 항목이 없어, '차임 뒤 말소리' 또는 '갑자기 커진 말소리'로 추정합니다.</li>
  <li>갑자기 커짐 = 최근 1분 바닥 소음(LA90)보다 1초 안에 10dB 이상 오를 때.</li>
  <li>원음은 어디에도 저장·전송하지 않습니다. 기록에는 장소·시각·묶음 이름·부담값만 남습니다.</li></ul>
  <h3>2. 언제 덜 붐비는지 예측</h3>
  <ul><li>서울 생활인구(행정동, 2026년 5~7월, 92일×24시간)를 서울시 주요 120장소 영역에 넓이 비율로 나눠 담았습니다(서울대공원은 과천이라 제외).</li>
  <li>LightGBM이 장소 × 요일 × 시간 패턴을 배웁니다. 마지막 14일(7/18~7/31)로 검증했습니다.</li></ul>
  <table><tr><th>방법</th><th>오차(MAPE)</th><th>4단계 맞춤</th><th>낮게 안내</th><th>붐빔 잡음</th></tr>
  ${row("gbdt", "LightGBM")}${row("naive", "지난주 그대로")}${row("prof", "요일·시간 평균")}${row("safe", "앱에 쓰는 값: max(LightGBM, 평균)")}</table>
  <p class="fine">'낮게 안내' = 실제보다 덜 붐빈다고 말한 비율. 답변서의 첫 원칙(부담을 낮게 잘못 안내하지 않기)에 따라, 정확도는 조금 내주고 이 비율을 2.5%까지 낮춘 값을 지도에 씁니다.</p>
  <h3>3. 종합 지수 규칙</h3>
  <ul><li>하위 값(주변 지역 혼잡 · 소리 크기 · 소리 종류·돌발성 · 밝기) 중 <b>가장 높은 값</b>이 종합입니다. 평균을 내지 않습니다.</li>
  <li>0~39 무던함 · 40~69 보통 · 70~100 부담 높음(초기값).</li>
  <li>소리·빛을 잰 적 없는 장소는 종합 지수를 '정보 부족'으로 두고 혼잡만 보여 줍니다.</li>
  <li>잰 시간이 아니면 혼잡 모양으로 짐작한 '추정'이고, 추정만으로는 무던함을 추천하지 않습니다.</li>
  <li>우리 아이가 '매우 민감'한 소리가 잡힌 장소는 다른 값과 상관없이 '주의'입니다.</li>
  <li>밝기는 센서를 웹에 여는 폰에서만 재고, 깜빡임은 '미측정'으로 표시합니다(미측정 ≠ 깜빡임 없음).</li></ul>
  <h3>한계</h3>
  <ul><li>지도의 혼잡은 통신 신호로 추정한 지역 인구라 매장 안 혼잡과 다를 수 있습니다.</li>
  <li>아직 현장 실측이 쌓이지 않아 처음엔 대부분 장소가 '정보 부족'입니다. 쓰는 사람이 잰 기록이 쌓일수록 채워지는 구조입니다. 지금 기록은 이 폰에만 저장됩니다.</li>
  <li>소리 크기는 폰 마이크마다 달라 어림값입니다(우리 아이 탭에서 보정).</li>
  <li>'마이크 없이 해 보기' 소리는 macOS 음성과 합성음으로 만든 시연음입니다. 실제 매장 녹음이 아닙니다.</li></ul>
  <h3>자료</h3>
  <ul><li>서울 열린데이터광장: 서울 생활인구(행정동, OA-14991), 서울시 주요 121장소 영역(OA-21778)</li>
  <li>행정동 경계: vuski/admdongkor (ver20250401)</li>
  <li>YAMNet: TensorFlow Models, Apache 2.0 · MediaPipe Tasks Audio</li>
  <li>지도: OpenStreetMap, CARTO</li>
  <li>규칙: 「무던한 지도」 제안서·사전질의 답변서(KEIT 공지 2026-10-12)</li></ul>
  <p class="fine">모델 학습 코드와 검증 결과: <a href="https://github.com/kangraemin/calm-map">github.com/kangraemin/calm-map</a> · 데이터 기준 ${FC.made}</p>`;
}

// ---------- 시작 ----------
renderQuick();
const first = (location.hash || "").slice(1);
if (["map", "kid", "log", "about"].includes(first)) go(first);
