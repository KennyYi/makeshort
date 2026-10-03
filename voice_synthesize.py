"""Persistent local Qwen3-TTS worker used by MakeShort."""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import uuid
from pathlib import Path


def load_model(model_path: str, torch):
    from qwen_tts import Qwen3TTSModel

    if not Path(model_path).is_dir():
        raise RuntimeError("Qwen3-TTS 모델 캐시 폴더를 찾지 못했습니다.")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = Qwen3TTSModel.from_pretrained(
        model_path,
        device_map=device,
        dtype=torch.float32,
        attn_implementation="eager",
    )
    # MPS has a channel limit in the long waveform decoder. Keep the language
    # model on MPS and decode the acoustic tokens on CPU, as in the local Qwen
    # setup already used by the user's lecture video project.
    if device == "mps":
        tokenizer = model.model.speech_tokenizer
        tokenizer.model.to("cpu")
        tokenizer.device = torch.device("cpu")
    return model


def synthesize(model, request: dict) -> None:
    import numpy as np
    import soundfile as sf

    text = request.get("text")
    language = request.get("language", "Korean")
    speaker = request.get("speaker")
    instruct = request.get("instruct")
    output_path = Path(request.get("output_path", "")).resolve()
    if not isinstance(text, str) or not text.strip():
        raise ValueError("읽을 문장을 입력해 주세요.")
    if not isinstance(language, str) or language not in {"Korean", "English"}:
        raise ValueError("한국어 또는 영어 음성을 선택해 주세요.")
    if speaker not in {"Ryan", "Sohee"}:
        raise ValueError("선택한 음성 preset을 확인해 주세요.")
    if not isinstance(instruct, str):
        raise ValueError("음성 어투 지시문을 확인해 주세요.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f"{output_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            waves, sample_rate = model.generate_custom_voice(
                text=text.strip(),
                language=language,
                speaker=speaker,
                instruct=instruct,
            )
        if len(waves) != 1:
            raise RuntimeError("Qwen3-TTS가 예상과 다른 오디오 개수를 반환했습니다.")
        audio = np.asarray(waves[0], dtype=np.float32).squeeze()
        if audio.ndim != 1 or not audio.size or not np.isfinite(audio).all():
            raise RuntimeError("Qwen3-TTS가 유효한 모노 오디오를 만들지 못했습니다.")
        if not isinstance(sample_rate, (int, np.integer)) or sample_rate <= 0:
            raise RuntimeError("Qwen3-TTS 오디오 샘플레이트를 확인할 수 없습니다.")
        sf.write(str(temporary), audio, int(sample_rate), format="WAV", subtype="PCM_16")
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)


def worker() -> int:
    with contextlib.redirect_stdout(sys.stderr):
        import torch

    model = None
    loaded_path = None
    for raw in sys.stdin:
        try:
            request = json.loads(raw)
            if request.get("command") == "close":
                return 0
            model_path = request.get("model_path")
            if not isinstance(model_path, str) or not model_path:
                raise ValueError("Qwen3-TTS 모델 경로가 없습니다.")
            with contextlib.redirect_stdout(sys.stderr):
                if model is None or loaded_path != model_path:
                    model = load_model(model_path, torch)
                    loaded_path = model_path
                synthesize(model, request)
            response = {"ok": True}
        except Exception as error:
            response = {"ok": False, "error": str(error) or "한국어 음성을 생성하지 못했습니다."}
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if not args.worker:
        parser.error("--worker is required")
    return worker()


if __name__ == "__main__":
    sys.exit(main())
