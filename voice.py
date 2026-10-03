"""Local Korean speech synthesis through an installed Qwen3-TTS environment."""

from __future__ import annotations

import atexit
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MODEL_REPO = "models--Qwen--Qwen3-TTS-12Hz-1.7B-CustomVoice"
MODEL_SIZE = "4.2GB"
MAX_AUDIO_BYTES = 50_000_000
MIN_SPEED = 0.7
MAX_SPEED = 1.3

VOICE_GENDERS = {
    "male": {"label": "남성", "speaker": "Ryan"},
    "female": {"label": "여성", "speaker": "Sohee"},
}

VOICE_LANGUAGES = {"Korean", "English"}

VOICE_TONES = {
    "calm": {
        "label": "차분함",
        "instruction": "Speak calmly and warmly, with steady pacing and gentle intonation.",
    },
    "playful": {
        "label": "장난기",
        "instruction": "Speak in a playful, mischievous way, with lively pitch movement and light energy.",
    },
    "angry": {
        "label": "화남",
        "instruction": "Speak with clear frustration and anger, using firm emphasis and a tense, forceful tone without shouting.",
    },
    "whisper": {
        "label": "속삭임",
        "instruction": "Whisper softly and intimately with an airy, breathy voice while keeping the words intelligible.",
    },
    "bright": {
        "label": "밝고 활기참",
        "instruction": "Speak brightly and cheerfully with upbeat energy and a smiling voice.",
    },
    "sad": {
        "label": "슬픔",
        "instruction": "Speak with subdued, wistful sadness and gentle, slightly slower delivery.",
    },
    "confident": {
        "label": "자신감",
        "instruction": "Speak confidently and decisively with clear, firm articulation.",
    },
    "narration": {
        "label": "내레이션",
        "instruction": "Deliver polished narration with even pacing, crisp diction, and balanced expressive emphasis.",
    },
}

PLATFORM_SUPPORTED = (
    platform.system() == "Darwin"
    and platform.machine().lower() in {"arm64", "aarch64"}
)


class VoiceError(Exception):
    """An expected local model or text-to-speech failure."""


def _cached_model_path() -> Path | None:
    hub_cache = os.environ.get("HF_HUB_CACHE", "").strip()
    if hub_cache:
        cache = Path(hub_cache).expanduser()
    else:
        hf_home = Path(os.environ.get("HF_HOME", "~/.cache/huggingface")).expanduser()
        cache = hf_home / "hub"
    snapshots = cache / MODEL_REPO / "snapshots"
    try:
        candidates = sorted(snapshots.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True)
    except OSError:
        return None
    for snapshot in candidates:
        if (
            (snapshot / "config.json").is_file()
            and (snapshot / "model.safetensors").is_file()
            and (snapshot / "speech_tokenizer" / "model.safetensors").is_file()
        ):
            return snapshot.resolve()
    return None


def _python_has_qwen(python: str) -> bool:
    try:
        result = subprocess.run(
            [python, "-c", "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('qwen_tts') else 1)"],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _find_qwen_python() -> str | None:
    configured = os.environ.get("QWEN_TTS_PYTHON", "").strip()
    if configured:
        candidate = str(Path(configured).expanduser())
        return candidate if Path(candidate).is_file() and _python_has_qwen(candidate) else None

    candidates = [
        ROOT / ".venv-qwen" / "bin" / "python",
        ROOT.parent / "lecture_short_video_generator" / ".venv-qwen" / "bin" / "python",
    ]
    for command in ("python3.12", "python3"):
        found = shutil.which(command)
        if found:
            candidates.append(Path(found))
    candidates.append(Path(sys.executable))

    seen: set[str] = set()
    for path in candidates:
        candidate = str(path.expanduser())
        if candidate in seen or not Path(candidate).is_file():
            continue
        seen.add(candidate)
        if _python_has_qwen(candidate):
            return candidate
    return None


class VoiceManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._worker: subprocess.Popen[str] | None = None
        self._model_loaded = False
        self._python = _find_qwen_python()
        self._model_path = _cached_model_path()
        atexit.register(self.close)

    def status(self) -> dict[str, bool | str]:
        worker_alive = self._worker is not None and self._worker.poll() is None
        if not worker_alive:
            self._model_loaded = False
        return {
            "available": PLATFORM_SUPPORTED and self._python is not None and self._model_path is not None,
            "platform_supported": PLATFORM_SUPPORTED,
            "model_loaded": self._model_loaded and worker_alive,
            "model": "Qwen3-TTS 1.7B CustomVoice",
            "model_size": MODEL_SIZE,
        }

    @staticmethod
    def describe(gender: str, tone: str) -> str:
        gender_label = VOICE_GENDERS[gender]["label"]
        tone_label = VOICE_TONES[tone]["label"]
        return f"Qwen3-TTS · {gender_label} · {tone_label}"

    def unavailable_message(self) -> str:
        if not PLATFORM_SUPPORTED:
            return "말투 프리셋 음성 생성은 Apple Silicon Mac에서 사용할 수 있습니다."
        if self._python is None:
            return "Qwen TTS Python 환경을 찾지 못했습니다. QWEN_TTS_PYTHON에 qwen-tts가 설치된 Python 경로를 지정해 주세요."
        if self._model_path is None:
            return "Qwen3-TTS 모델이 로컬 Hugging Face 캐시에 없습니다. 모델을 다운로드한 뒤 다시 실행해 주세요."
        return "Qwen3-TTS 음성 생성기를 시작하지 못했습니다. 앱을 다시 실행해 주세요."

    def _get_worker(self) -> subprocess.Popen[str]:
        if self._worker is not None and self._worker.poll() is None:
            return self._worker
        if not self._python or not self._model_path:
            raise VoiceError(self.unavailable_message())
        env = os.environ.copy()
        numba_cache = Path(tempfile.gettempdir()) / "makeshort-numba-cache"
        numba_cache.mkdir(parents=True, exist_ok=True)
        env.setdefault("NUMBA_CACHE_DIR", str(numba_cache))
        env["PYTHONUNBUFFERED"] = "1"
        try:
            self._worker = subprocess.Popen(
                [self._python, "-u", str(ROOT / "voice_synthesize.py"), "--worker"],
                cwd=ROOT,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except OSError as exc:
            self._worker = None
            raise VoiceError(f"Qwen3-TTS 음성 생성기를 시작하지 못했습니다: {exc}") from None
        return self._worker

    def generate(
        self,
        text: str,
        gender: str,
        tone: str,
        speed: float,
        output_path: Path,
        language: str = "Korean",
    ) -> None:
        if not isinstance(text, str) or not text.strip() or len(text) > 20_000:
            raise VoiceError("읽을 문장은 1~20,000자여야 합니다.")
        if not isinstance(gender, str) or gender not in VOICE_GENDERS:
            raise VoiceError("남성 또는 여성 음성을 선택해 주세요.")
        if not isinstance(tone, str) or tone not in VOICE_TONES:
            raise VoiceError("음성 어투 프리셋을 선택해 주세요.")
        if not isinstance(language, str) or language not in VOICE_LANGUAGES:
            raise VoiceError("한국어 또는 영어 음성을 선택해 주세요.")
        if not isinstance(speed, (int, float)) or not MIN_SPEED <= float(speed) <= MAX_SPEED:
            raise VoiceError("읽기 속도는 0.7~1.3 범위에서 선택해 주세요.")

        instruction = " ".join((
            VOICE_TONES[tone]["instruction"],
            f"Aim for a speaking pace of about {float(speed):.2f}x normal speed.",
        ))
        request = {
            "text": text.strip(),
            "language": language,
            "speaker": VOICE_GENDERS[gender]["speaker"],
            "instruct": instruction,
            "model_path": str(self._model_path) if self._model_path else "",
            "output_path": str(output_path.resolve()),
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            worker = self._get_worker()
            if worker.stdin is None or worker.stdout is None:
                self._worker = None
                raise VoiceError("Qwen3-TTS 음성 생성기와 연결되지 않았습니다. 앱을 다시 실행해 주세요.")
            try:
                worker.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
                worker.stdin.flush()
                line = worker.stdout.readline()
            except (BrokenPipeError, OSError):
                self._worker = None
                raise VoiceError("Qwen3-TTS 음성 생성기가 중단되었습니다. 앱을 다시 실행해 주세요.") from None
            if not line:
                self._worker = None
                raise VoiceError("Qwen3-TTS 음성 생성기가 중단되었습니다. 앱을 다시 실행해 주세요.")
            try:
                result = json.loads(line)
            except json.JSONDecodeError:
                self._worker = None
                raise VoiceError("Qwen3-TTS 음성 생성기의 응답을 읽지 못했습니다.") from None
            if not result.get("ok"):
                output_path.unlink(missing_ok=True)
                raise VoiceError(str(result.get("error") or "한국어 음성을 생성하지 못했습니다."))
            self._model_loaded = True

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise VoiceError("한국어 음성 모델이 오디오를 만들지 못했습니다.")
        if output_path.stat().st_size > MAX_AUDIO_BYTES:
            output_path.unlink(missing_ok=True)
            raise VoiceError("생성된 음성이 50MB를 초과했습니다.")

    def close(self) -> None:
        with self._lock:
            worker, self._worker = self._worker, None
            if worker is None:
                return
            if worker.stdin is not None:
                try:
                    worker.stdin.close()
                except OSError:
                    pass
            try:
                worker.wait(timeout=3)
            except subprocess.TimeoutExpired:
                worker.terminate()
                try:
                    worker.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    worker.kill()
