import os
import sys
import json
import time
from pathlib import Path

sys.path.insert(0, r"E:\AI\index-tts")
os.chdir(r"E:\AI\index-tts")

from indextts.infer_v2_5 import IndexTTS2

ROOT = Path(r"C:\Users\14451\Desktop\SpyMouseWeb\promo")
REF = str(ROOT / "audio" / "ref" / "ref_voice.wav")

# 由 promo/tts/segments.json 驱动：每句单独出一个 wav，方便重录与对齐
segments = json.loads((ROOT / "tts" / "segments.json").read_text(encoding="utf-8"))

out_dir = ROOT / "audio" / "vo"
out_dir.mkdir(parents=True, exist_ok=True)

tts = IndexTTS2(
    cfg_path=r"checkpoints/config.yaml",
    model_dir=r"checkpoints",
    use_bf16=True,
    use_cuda_kernel=False,
)

only = set(sys.argv[1:])

# Duration multiplier passed to IndexTTS2. 1.06 = 6% slower than the model's
# baseline; 1.0 = baseline; lower = faster speech.
DURATION_FACTOR = float(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].replace('.', '', 1).isdigit() else 0.92
if sys.argv[1:] and sys.argv[1].replace('.', '', 1).isdigit():
    only = set(sys.argv[2:])

for seg in segments:
    if only and seg["id"] not in only:
        continue
    out = out_dir / f'{seg["id"]}.wav'
    t0 = time.time()
    tts.infer(
        spk_audio_prompt=REF,
        text=seg["text"],
        output_path=str(out),
        lang="ZH",
        emo_audio_prompt=REF,
        emo_alpha=seg.get("emo_alpha", 1.0),
        duration_factor=seg.get("duration_factor", DURATION_FACTOR),
        verbose=False,
    )
    print(f'{seg["id"]}  {time.time() - t0:5.1f}s  -> {out.name}', flush=True)

print("ALL DONE")
