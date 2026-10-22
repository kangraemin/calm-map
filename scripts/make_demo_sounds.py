"""시연용 소리 만들기 — 실제 현장 녹음이 아니라 합성한 소리다 (앱에도 '합성 시연음'으로 표시).
macOS say(한국어 음성) + numpy 합성. 결과: site/sounds/*.mp3 (16 kHz mono)
  calm.mp3      조용한 매장: 낮은 실내 소음 + 작은 배경음악
  announce.mp3  배경음악·웅성임 위로 '딩동' 차임 뒤 안내방송
  siren.mp3     웅성임 위로 구급차 사이렌이 다가왔다 멀어짐
  dryer.mp3     화장실 핸드드라이어처럼 갑자기 켜지는 바람 소리
"""
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 16000
OUT = Path(__file__).resolve().parent.parent / "site" / "sounds"
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(3)


def tts(text, voice="Yuna", rate=175):
    with tempfile.TemporaryDirectory() as d:
        aiff, wav = Path(d) / "a.aiff", Path(d) / "a.wav"
        subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), text], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(aiff), "-ar", str(SR), "-ac", "1", str(wav)], check=True)
        with wave.open(str(wav)) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x


def pink(n):
    w = rng.standard_normal(n)
    f = np.fft.rfft(w)
    f /= np.maximum(1, np.sqrt(np.arange(len(f))))
    x = np.fft.irfft(f, n)
    return x / np.max(np.abs(x))


def music(sec, vol=0.05):
    t = np.arange(int(sec * SR)) / SR
    chords = [(261.6, 329.6, 392.0), (220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (196.0, 246.9, 293.7)]
    x = np.zeros_like(t)
    for i, ch in enumerate(chords * int(sec // 8 + 1)):
        s, e = int(i * 2 * SR), int((i + 1) * 2 * SR)
        if s >= len(t):
            break
        seg = t[s:e] - t[s]
        env = np.minimum(1, seg * 4) * np.exp(-seg * 0.6)
        for fr in ch:
            x[s:e] += np.sin(2 * np.pi * fr * seg) * env / 3
        # 간단한 멜로디
        mel = ch[2] * 2
        x[s:e] += 0.4 * np.sin(2 * np.pi * mel * seg) * np.exp(-seg * 2)
    return x / np.max(np.abs(x)) * vol


def babble(sec, vol=0.04):
    lines = ["이거 얼마예요", "저쪽으로 가 보자", "오늘 사람 진짜 많다", "엄마 이거 사 줘", "계산 어디서 해요", "잠깐만 기다려", "이따 점심 뭐 먹지"]
    voices = ["Eddy", "Flo", "Reed", "Sandy", "Shelley", "Rocko", "Grandpa"]
    x = np.zeros(int(sec * SR))
    for k in range(14):
        v = tts(lines[k % len(lines)], voices[k % len(voices)], rate=190)
        st = int(rng.uniform(0, max(1, len(x) - len(v))))
        x[st:st + len(v)] += v[: len(x) - st] * rng.uniform(0.5, 1)
    return x / np.max(np.abs(x)) * vol


def room(sec, vol=0.01):
    return pink(int(sec * SR)) * vol


def chime():
    t = np.arange(int(1.6 * SR)) / SR
    a = np.sin(2 * np.pi * 659.3 * t) * np.exp(-t * 2.5) * (t < 0.8)
    t2 = t - 0.7
    b = np.where(t2 > 0, np.sin(2 * np.pi * 523.3 * t2) * np.exp(-np.clip(t2, 0, None) * 2.0), 0)
    return (a + b) * 0.5


def save(name, x):
    x = np.clip(x, -1, 1)
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "x.wav"
        with wave.open(str(wav), "w") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((x * 32767).astype(np.int16).tobytes())
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-b:a", "48k", str(OUT / f"{name}.mp3")], check=True)
        subprocess.run(["cp", str(wav), str(OUT.parent.parent / "video" / "wav" / f"{name}.wav")], check=True)  # 영상 녹화용(가짜 마이크 입력)
    print(name, round(len(x) / SR, 1), "s")


SEC = 24
base_calm = room(SEC) + music(SEC, 0.03)
save("calm", base_calm)

base = room(SEC, 0.015) + music(SEC, 0.05) + babble(SEC, 0.05)
ann = np.concatenate([chime(), tts("고객 여러분께 안내 말씀 드립니다. 잠시 후 지하 일층 식품 매장에서 타임 세일이 시작됩니다. 많은 이용 바랍니다.", "Yuna", 165)])
x = base.copy()
st = int(7 * SR)
x[st:st + len(ann)] += ann[: len(x) - st] * 0.6
save("announce", x)

base = room(SEC, 0.015) + babble(SEC, 0.06)
t = np.arange(int(14 * SR)) / SR
f = 900 + 500 * np.sin(2 * np.pi * t / 4)  # 웨일 사이렌(배음 7개)
ph = 2 * np.pi * np.cumsum(f) / SR
sir = sum(np.sin(k * ph) / k for k in range(1, 8)) * np.interp(t, [0, 1, 9, 14], [0.08, 0.3, 0.3, 0.03])
x = base.copy()
st = int(1.5 * SR)
x[st:st + len(sir)] += sir
save("siren", x)

base = room(SEC, 0.015) + babble(SEC, 0.03)
n = int(9 * SR)
noise = pink(n) * 0.45 + 0.08 * np.sin(2 * np.pi * 180 * np.arange(n) / SR)
env = np.interp(np.arange(n) / SR, [0, 0.15, 8.5, 9], [0, 1, 1, 0])
x = base.copy()
st = int(8 * SR)
x[st:st + n] += noise * env
save("dryer", x)
