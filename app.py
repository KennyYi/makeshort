#!/usr/bin/env python3
"""Local web app for making portrait clips from public YouTube videos."""

from __future__ import annotations

import atexit
import json
import logging
import base64
import math
import mimetypes
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

import yt_dlp
from social import SocialError, SocialManager
from voice import VOICE_GENDERS, VOICE_LANGUAGES, VOICE_TONES, VoiceError, VoiceManager


ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web" / "dist"
HOST = "127.0.0.1"
PORT = 8000
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
ALLOWED_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
CAPTION_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
MEDIA_FILES: dict[str, Path] = {}
MEDIA_FILES_LOCK = threading.Lock()
PROJECT_MEDIA_KEYS: set[str] = set()
PROJECT_MEDIA_ROOT = Path(tempfile.mkdtemp(prefix="makeshort-project-media-"))
atexit.register(shutil.rmtree, PROJECT_MEDIA_ROOT, ignore_errors=True)
SOCIAL = SocialManager()
VOICE = VoiceManager()
OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
DEFAULT_FPS = 30

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("makeshort")


class RequestError(Exception):
    pass


def youtube_video_id(raw_url: object) -> str:
    if not isinstance(raw_url, str) or len(raw_url) > 2048:
        raise RequestError("유튜브 링크를 확인해 주세요.")
    try:
        parsed = urlsplit(raw_url.strip())
        host = (parsed.hostname or "").lower().rstrip(".")
    except ValueError as exc:
        raise RequestError("유튜브 링크를 확인해 주세요.") from exc

    if parsed.scheme not in {"https", "http"} or host not in ALLOWED_HOSTS:
        raise RequestError("youtube.com 또는 youtu.be 링크를 입력해 주세요.")

    video_id = ""
    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
    else:
        path_parts = [part for part in parsed.path.split("/") if part]
        if parsed.path.rstrip("/") == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        elif len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed", "live"}:
            video_id = path_parts[1]

    if not VIDEO_ID.fullmatch(video_id):
        raise RequestError("유튜브 영상 주소를 확인해 주세요.")
    return video_id


def parse_timestamp(value: object, name: str) -> Decimal:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise RequestError(f"{name} 시간을 입력해 주세요.")
    raw = str(value).strip()
    try:
        if ":" not in raw:
            seconds = Decimal(raw)
        else:
            parts = raw.split(":")
            if len(parts) not in (2, 3) or any(not part for part in parts):
                raise InvalidOperation
            numbers = [Decimal(part) for part in parts]
            if any(number < 0 for number in numbers):
                raise InvalidOperation
            if len(numbers) == 2:
                minutes, second_part = numbers
                if second_part >= 60:
                    raise InvalidOperation
                seconds = minutes * 60 + second_part
            else:
                hours, minutes, second_part = numbers
                if minutes >= 60 or second_part >= 60:
                    raise InvalidOperation
                seconds = hours * 3600 + minutes * 60 + second_part
    except (InvalidOperation, ValueError):
        raise RequestError(f"{name} 시간은 초 또는 MM:SS 형식으로 입력해 주세요.") from None
    if not seconds.is_finite() or seconds < 0:
        raise RequestError(f"{name} 시간은 0 이상이어야 합니다.")
    return seconds


def make_filter(mode: str, fps: str = str(DEFAULT_FPS)) -> str:
    if mode == "fill":
        return (
            f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase:"
            f"force_divisible_by=2,crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},setsar=1,fps={fps}"
        )
    if mode == "fit":
        return (
            f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease:"
            f"force_divisible_by=2,pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,"
            f"setsar=1,fps={fps}"
        )
    raise RequestError("화면 비율 옵션을 선택해 주세요.")


def probe_video_fps(video_path: Path) -> tuple[str, float]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,r_frame_rate", "-of", "json", str(video_path)],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    streams = json.loads(result.stdout).get("streams", [])
    if not streams:
        return str(DEFAULT_FPS), float(DEFAULT_FPS)
    stream = streams[0]
    for value in (stream.get("avg_frame_rate"), stream.get("r_frame_rate")):
        try:
            rate = Fraction(value)
            numeric_rate = float(rate)
        except (TypeError, ValueError, ZeroDivisionError):
            continue
        if math.isfinite(numeric_rate) and 1 <= numeric_rate <= 120:
            return str(rate), numeric_rate
    return str(DEFAULT_FPS), float(DEFAULT_FPS)


def download_youtube_source(video_id: str, temp_root: Path, include_audio: bool = True) -> tuple[Path, str]:
    source_template = str(temp_root / "source.%(ext)s")
    options = {
        "format": "bv*+ba/b" if include_audio else "bv/b",
        "outtmpl": source_template,
        "merge_output_format": "mkv",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 2,
    }
    logger.info("Downloading YouTube video %s", video_id)
    with yt_dlp.YoutubeDL(options) as downloader:
        video_info = downloader.extract_info(
            f"https://www.youtube.com/watch?v={video_id}", download=True,
        )

    title = video_info.get("title") if isinstance(video_info, dict) else None
    if not isinstance(title, str) or not title.strip():
        title = "YouTube 클립"
    candidates = [
        path for path in temp_root.glob("source.*")
        if path.is_file() and not path.name.endswith((".part", ".ytdl"))
    ]
    if not candidates:
        raise RuntimeError("yt-dlp completed without an output file")
    return candidates[0], title


def create_portrait_clip(
    source: Path,
    output: Path,
    start: Decimal,
    end: Decimal,
    mode: str,
    include_audio: bool = True,
) -> float:
    fps_expression, fps_value = probe_video_fps(source)
    video_filter = make_filter(mode, fps_expression)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found on PATH")
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", str(start), "-i", str(source), "-t", str(end - start),
        "-map", "0:v:0",
    ]
    if include_audio:
        command.extend(["-map", "0:a?"])
    else:
        command.append("-an")
    command.extend([
        "-vf", video_filter,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    ])
    if include_audio:
        command.extend(["-c:a", "aac", "-b:a", "192k"])
    command.extend(["-movflags", "+faststart", "-pix_fmt", "yuv420p", str(output)])
    logger.info("Creating %s clip (%s to %s)", mode, start, end)
    subprocess.run(command, check=True, capture_output=True, timeout=3600)
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("ffmpeg did not produce a clip")
    return fps_value


def probe_video_frame_count(video_path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
            "-show_entries", "stream=nb_read_frames", "-of", "json", str(video_path),
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=3600,
    )
    streams = json.loads(result.stdout).get("streams", [])
    if not streams:
        raise RuntimeError("ffprobe did not find a video stream")
    try:
        frame_count = int(streams[0].get("nb_read_frames", "0"))
    except (TypeError, ValueError):
        frame_count = 0
    if frame_count < 1:
        raise RuntimeError("ffprobe could not determine the clip frame count")
    return frame_count


def probe_audio_duration(audio_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(audio_path)],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    try:
        duration = float(json.loads(result.stdout).get("format", {}).get("duration", 0))
    except (TypeError, ValueError, json.JSONDecodeError):
        duration = 0
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("ffprobe could not determine the generated audio duration")
    return duration


def normalize_api_captions(value: object) -> list[dict[str, object]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 120:
        raise RequestError("자막은 최대 120개까지 설정할 수 있습니다.")

    defaults: dict[str, object] = {
        "font": "noto",
        "fontSize": 72,
        "color": "#ffffff",
        "position": "bottom-center",
        "boxWidth": 84,
        "boxHeight": 10,
        "animation": "fade",
        "decoration": "shadow",
    }
    captions = []
    used_ids: set[str] = set()
    for index, value_item in enumerate(value, start=1):
        if not isinstance(value_item, dict):
            raise RequestError("자막 설정은 JSON 객체여야 합니다.")
        caption = {**defaults, **value_item}
        caption["_endAtClipEnd"] = "end" not in value_item
        caption_id = caption.get("id") or f"caption_{index}"
        if not isinstance(caption_id, str) or caption_id in used_ids:
            raise RequestError("자막 ID는 중복되지 않는 문자열이어야 합니다.")
        used_ids.add(caption_id)
        caption["id"] = caption_id
        captions.append(caption)
    return captions


def normalize_api_voiceovers(value: object) -> list[dict[str, object]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 50:
        raise RequestError("AI 음성 레이어는 최대 50개까지 설정할 수 있습니다.")

    voiceovers: list[dict[str, object]] = []
    used_ids: set[str] = set()
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            raise RequestError("AI 음성 설정은 JSON 객체여야 합니다.")
        text = item.get("text")
        gender = item.get("gender", "female")
        tone = item.get("tone", "calm")
        language = item.get("language", "Korean")
        speed = item.get("speed", 1)
        volume = item.get("volume", 1)
        voiceover_id = item.get("id") or f"voiceover_{index}"
        start_value = item.get("start")
        if isinstance(start_value, bool):
            raise RequestError("AI 음성 시작 시간은 초 단위 숫자로 입력해 주세요.")
        try:
            start = float(start_value)
        except (TypeError, ValueError):
            raise RequestError("AI 음성 시작 시간은 초 단위 숫자로 입력해 주세요.") from None
        if not isinstance(text, str) or not text.strip() or len(text) > 20_000:
            raise RequestError("AI 음성 문장은 1~20,000자여야 합니다.")
        if not isinstance(voiceover_id, str) or not CAPTION_ID.fullmatch(voiceover_id) or voiceover_id in used_ids:
            raise RequestError("AI 음성 ID는 중복되지 않는 문자열이어야 합니다.")
        used_ids.add(voiceover_id)
        if not math.isfinite(start) or start < 0 or start > 3600:
            raise RequestError("AI 음성 시작 시간은 0~3,600초 범위여야 합니다.")
        if not isinstance(gender, str) or gender not in VOICE_GENDERS:
            raise RequestError("AI 음성 목소리는 male 또는 female이어야 합니다.")
        if not isinstance(tone, str) or tone not in VOICE_TONES:
            raise RequestError("AI 음성 어투 설정을 확인해 주세요.")
        if not isinstance(language, str) or language not in VOICE_LANGUAGES:
            raise RequestError("AI 음성 언어는 Korean 또는 English여야 합니다.")
        if (
            not isinstance(speed, (int, float))
            or isinstance(speed, bool)
            or not math.isfinite(speed)
            or not 0.7 <= speed <= 1.3
        ):
            raise RequestError("AI 음성 속도는 0.7~1.3 범위여야 합니다.")
        if (
            not isinstance(volume, (int, float))
            or isinstance(volume, bool)
            or not math.isfinite(volume)
            or not 0 <= volume <= 1
        ):
            raise RequestError("AI 음성 음량은 0~1 범위여야 합니다.")
        voiceovers.append({
            "id": voiceover_id,
            "text": text.strip(),
            "start": start,
            "gender": gender,
            "tone": tone,
            "language": language,
            "speed": float(speed),
            "volume": float(volume),
        })
    return voiceovers


def safe_video_filename(title: str) -> str:
    cleaned = re.sub(r"\.(?:mp4|mov|m4v)$", "", title.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", cleaned)
    cleaned = re.sub(r"[. ]+$", "", cleaned)[:180].strip()
    return f"{cleaned or 'makeshort_clip'}.mp4"


def render_video_with_remotion(
    source_path: Path | None,
    output_path: Path,
    props_path: Path,
    props: dict[str, object],
    server_port: int,
) -> None:
    remotion_cli = ROOT / "node_modules" / ".bin" / "remotion"
    if not remotion_cli.exists():
        raise FileNotFoundError("Remotion CLI was not found")

    render_media_keys: list[str] = []
    try:
        if source_path is not None:
            media_key = uuid.uuid4().hex
            props["src"] = f"http://{HOST}:{server_port}/api/media/{media_key}"
            with MEDIA_FILES_LOCK:
                MEDIA_FILES[media_key] = source_path
            render_media_keys.append(media_key)
        else:
            props.pop("src", None)
        for image in props.get("images", []):
            asset_key = image["assetKey"]
            with MEDIA_FILES_LOCK:
                image_path = MEDIA_FILES.get(asset_key)
            if image_path is None or not image_path.is_file():
                raise RequestError("이미지 파일이 만료되었습니다. 이미지를 다시 추가해 주세요.")
            image["src"] = f"http://{HOST}:{server_port}/api/media/{asset_key}"
        for voiceover in props.get("voiceovers", []):
            asset_key = voiceover["assetKey"]
            with MEDIA_FILES_LOCK:
                audio_path = MEDIA_FILES.get(asset_key)
            if audio_path is None or not audio_path.is_file():
                raise RequestError("생성된 음성이 만료되었습니다. 음성을 다시 만들어 주세요.")
            voiceover["src"] = f"http://{HOST}:{server_port}/api/media/{asset_key}"
        props_path.write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")

        command = [
            str(remotion_cli), "render", str(ROOT / "web" / "src" / "remotion" / "index.jsx"),
            "CaptionedClip", str(output_path), "--props", str(props_path),
            "--duration", str(props["durationInFrames"]), "--codec", "h264", "--crf", "18",
            "--concurrency", "2",
        ]
        logger.info("Rendering Remotion composition with %s", "video source" if source_path is not None else "overlay layers only")
        result = subprocess.run(
            command, cwd=ROOT, capture_output=True, text=True, timeout=7200,
        )
        if result.returncode != 0:
            logger.error("Remotion render failed: %s", result.stderr[-6000:])
            raise RuntimeError("Remotion render failed")
        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise RuntimeError("Remotion completed without an output file")
    finally:
        with MEDIA_FILES_LOCK:
            for media_key in render_media_keys:
                MEDIA_FILES.pop(media_key, None)


def send_json(handler: BaseHTTPRequestHandler, status: int, payload: object) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class MakeShortHandler(BaseHTTPRequestHandler):
    server_version = "MakeShort/1.0"

    def _media_key(self) -> str | None:
        match = re.fullmatch(r"/api/media/([a-f0-9]{32})", self.path.split("?", 1)[0])
        return match.group(1) if match else None

    def _serve_media(self, head_only: bool = False) -> None:
        key = self._media_key()
        with MEDIA_FILES_LOCK:
            media_path = MEDIA_FILES.get(key) if key else None
        if not media_path or not media_path.is_file():
            self.send_error(404)
            return

        size = media_path.stat().st_size
        start, end = 0, size - 1
        status = 200
        range_header = self.headers.get("Range", "")
        if range_header.startswith("bytes="):
            try:
                range_start, range_end = range_header[6:].split("-", 1)
                if range_start:
                    start = int(range_start)
                if range_end:
                    end = min(int(range_end), size - 1)
                if start < 0 or start >= size or end < start:
                    raise ValueError
                status = 206
            except ValueError:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

        length = end - start + 1
        self.send_response(status)
        content_type, _ = mimetypes.guess_type(media_path.name)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if head_only:
            return
        with media_path.open("rb") as media_file:
            media_file.seek(start)
            remaining = length
            while remaining:
                chunk = media_file.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_HEAD(self) -> None:
        if self._media_key():
            self._serve_media(head_only=True)
        else:
            self.send_error(404)

    def do_GET(self) -> None:
        if self._media_key():
            self._serve_media()
            return
        if self.path == "/api/health":
            send_json(self, 200, {"status": "ok"})
            return

        path = "/" if self.path == "/" else self.path.split("?", 1)[0]
        if path == "/api/voice/status":
            if not self._social_origin_is_local():
                send_json(self, 403, {"error": "로컬 MakeShort 화면에서만 음성 설정을 확인할 수 있습니다."})
                return
            send_json(self, 200, VOICE.status())
            return
        if path == "/api/social/status":
            try:
                send_json(self, 200, SOCIAL.status())
            except SocialError as exc:
                send_json(self, 500, {"error": str(exc)})
            return
        match = re.fullmatch(r"/oauth/(youtube|instagram|tiktok)/start", path)
        if match:
            try:
                location = SOCIAL.oauth_start(match.group(1))
                self.send_response(302)
                self.send_header("Location", location)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
            except SocialError as exc:
                self._send_oauth_popup(match.group(1), str(exc), failed=True)
            return
        match = re.fullmatch(r"/oauth/(youtube|instagram|tiktok)/callback", path)
        if match:
            provider = match.group(1)
            try:
                query = parse_qs(urlsplit(self.path).query)
                message = SOCIAL.oauth_callback(provider, query)
                self._send_oauth_popup(provider, message, failed=False)
            except SocialError as exc:
                self._send_oauth_popup(provider, str(exc), failed=True)
            except Exception:
                logger.exception("Social OAuth callback failed for %s", provider)
                self._send_oauth_popup(provider, "계정 연결 중 오류가 발생했습니다. 서버 로그를 확인해 주세요.", failed=True)
            return
        relative_path = "index.html" if path == "/" else path.lstrip("/")
        file_path = (WEB_ROOT / relative_path).resolve()
        if WEB_ROOT.resolve() not in file_path.parents or not file_path.is_file():
            self.send_error(404)
            return
        try:
            content = file_path.read_bytes()
        except OSError:
            self.send_error(404)
            return
        content_type, _ = mimetypes.guess_type(file_path.name)
        if content_type in {"text/html", "text/css", "application/javascript"}:
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        route = self.path.split("?", 1)[0]
        if route in {"/api/media/upload", "/api/media/delete"} and not self._social_origin_is_local():
            send_json(self, 403, {"error": "로컬 MakeShort 화면에서만 미디어 작업을 요청할 수 있습니다."})
            return
        if route == "/api/media/upload":
            self._upload_project_image()
            return
        if route == "/api/media/delete":
            self._delete_project_image()
            return
        if route.startswith("/api/voice/") and not self._social_origin_is_local():
            send_json(self, 403, {"error": "로컬 MakeShort 화면에서만 음성 기능을 사용할 수 있습니다."})
            return
        if route == "/api/voice/generate":
            self._voice_generate()
            return
        if route.startswith("/api/social/") and not self._social_origin_is_local():
            send_json(self, 403, {"error": "로컬 MakeShort 화면에서만 계정 작업을 요청할 수 있습니다."})
            return
        if route == "/api/social/config":
            self._social_configure()
            return
        if route == "/api/social/disconnect":
            self._social_disconnect()
            return
        if route == "/api/social/select-account":
            self._social_select_account()
            return
        if route == "/api/social/tiktok/creator-info":
            try:
                send_json(self, 200, SOCIAL.tiktok_creator_info())
            except SocialError as exc:
                send_json(self, 400, {"error": str(exc)})
            return
        if route == "/api/social/publish":
            self._social_publish()
            return
        if self.path == "/api/create":
            self.create_composite()
            return
        if self.path == "/api/render":
            self.render_composite()
            return
        if self.path != "/api/clip":
            send_json(self, 404, {"error": "요청한 주소를 찾을 수 없습니다."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "요청 내용을 확인해 주세요."})
            return
        if length <= 0 or length > 16_384:
            send_json(self, 413, {"error": "요청 내용이 너무 큽니다."})
            return

        try:
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise RequestError("요청 내용을 확인해 주세요.")
            video_id = youtube_video_id(request.get("url"))
            start = parse_timestamp(request.get("start"), "시작")
            end = parse_timestamp(request.get("end"), "종료")
            if end <= start:
                raise RequestError("종료 시간은 시작 시간보다 뒤여야 합니다.")
            mode = request.get("mode")
            if not isinstance(mode, str) or mode not in {"fill", "fit"}:
                raise RequestError("화면 비율 옵션을 선택해 주세요.")
            include_audio = request.get("include_audio", True)
            if not isinstance(include_audio, bool):
                raise RequestError("include_audio는 true 또는 false여야 합니다.")
        except (json.JSONDecodeError, UnicodeDecodeError):
            send_json(self, 400, {"error": "요청 내용을 확인해 주세요."})
            return
        except RequestError as exc:
            send_json(self, 400, {"error": str(exc)})
            return

        try:
            with tempfile.TemporaryDirectory(prefix="makeshort-") as temp_dir:
                temp_root = Path(temp_dir)
                source, video_title = download_youtube_source(video_id, temp_root, include_audio)
                output = temp_root / "makeshort_clip.mp4"
                fps_value = create_portrait_clip(source, output, start, end, mode, include_audio)

                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(output.stat().st_size))
                self.send_header("X-Makeshort-FPS", f"{fps_value:.9f}".rstrip("0").rstrip("."))
                self.send_header("X-Makeshort-Title", quote(video_title, safe=""))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with output.open("rb") as clip:
                    shutil.copyfileobj(clip, self.wfile, length=1024 * 1024)
        except yt_dlp.utils.DownloadError:
            logger.exception("YouTube download failed for %s", video_id)
            send_json(self, 422, {"error": "영상을 가져오지 못했습니다. 공개 영상인지, 링크가 정확한지 확인해 주세요."})
        except Exception:
            logger.exception("Clip processing failed for %s", video_id)
            if not self.wfile.closed:
                try:
                    send_json(self, 500, {"error": "클립을 만드는 중 문제가 생겼습니다. 서버 로그를 확인해 주세요."})
                except (BrokenPipeError, ConnectionResetError):
                    pass

    def _social_origin_is_local(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return origin.rstrip("/") in {"http://127.0.0.1:8000", "http://localhost:8000"}

    def _read_social_json(self, max_bytes: int = 64_000) -> dict[str, object] | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "요청 크기를 확인해 주세요."})
            return None
        if length <= 0 or length > max_bytes:
            send_json(self, 413, {"error": f"요청은 {max_bytes // 1000}KB 이하여야 합니다."})
            return None
        try:
            request = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            send_json(self, 400, {"error": "올바른 JSON 요청이 아닙니다."})
            return None
        if not isinstance(request, dict):
            send_json(self, 400, {"error": "요청 본문은 JSON 객체여야 합니다."})
            return None
        return request

    def _social_configure(self) -> None:
        request = self._read_social_json()
        if request is None:
            return
        try:
            result = SOCIAL.configure(request.get("provider"), request.get("client_id"), request.get("client_secret"))
            send_json(self, 200, result)
        except SocialError as exc:
            send_json(self, 400, {"error": str(exc)})

    def _voice_generate(self) -> None:
        request = self._read_social_json(max_bytes=100_000)
        if request is None:
            return
        text = request.get("text")
        speed = request.get("speed", 1)
        gender = request.get("gender", "female")
        tone = request.get("tone", "calm")
        language = request.get("language", "Korean")
        if not isinstance(text, str) or not text.strip() or len(text) > 20_000:
            send_json(self, 400, {"error": "읽을 문장은 1~20,000자여야 합니다."})
            return
        if not isinstance(gender, str) or gender not in VOICE_GENDERS:
            send_json(self, 400, {"error": "남성 또는 여성 음성을 선택해 주세요."})
            return
        if not isinstance(tone, str) or tone not in VOICE_TONES:
            send_json(self, 400, {"error": "음성 어투 프리셋을 선택해 주세요."})
            return
        if not isinstance(language, str) or language not in VOICE_LANGUAGES:
            send_json(self, 400, {"error": "한국어 또는 영어 음성을 선택해 주세요."})
            return
        if not isinstance(speed, (int, float)) or isinstance(speed, bool) or not math.isfinite(speed) or not 0.7 <= speed <= 1.3:
            send_json(self, 400, {"error": "읽기 속도는 0.7~1.3 범위에서 선택해 주세요."})
            return
        if not VOICE.status()["available"]:
            send_json(self, 503, {"error": VOICE.unavailable_message()})
            return

        media_key = uuid.uuid4().hex
        audio_path = PROJECT_MEDIA_ROOT / f"{media_key}.wav"
        try:
            VOICE.generate(text.strip(), gender, tone, float(speed), audio_path, language)
            duration = probe_audio_duration(audio_path)
            with MEDIA_FILES_LOCK:
                MEDIA_FILES[media_key] = audio_path
                PROJECT_MEDIA_KEYS.add(media_key)
        except VoiceError as exc:
            audio_path.unlink(missing_ok=True)
            send_json(self, 400, {"error": str(exc)})
            return
        except Exception:
            audio_path.unlink(missing_ok=True)
            logger.exception("Could not prepare generated voice audio")
            send_json(self, 500, {"error": "생성된 음성을 편집기에 추가하지 못했습니다."})
            return
        send_json(self, 201, {"assetKey": media_key, "duration": duration, "voice": VOICE.describe(gender, tone)})

    def _social_disconnect(self) -> None:
        request = self._read_social_json()
        if request is None:
            return
        try:
            send_json(self, 200, SOCIAL.disconnect(request.get("provider")))
        except SocialError as exc:
            send_json(self, 400, {"error": str(exc)})

    def _social_select_account(self) -> None:
        request = self._read_social_json()
        if request is None:
            return
        try:
            send_json(self, 200, SOCIAL.select_account(request.get("provider"), request.get("account_id")))
        except SocialError as exc:
            send_json(self, 400, {"error": str(exc)})

    def _social_publish(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "영상 파일 크기를 확인해 주세요."})
            return
        if length <= 0 or length > 1_000_000_000:
            send_json(self, 413, {"error": "영상 파일은 비어 있거나 1GB를 초과할 수 없습니다."})
            return
        encoded = self.headers.get("X-Makeshort-Publish", "")
        if not encoded or len(encoded) > 64_000:
            send_json(self, 400, {"error": "게시물 설정이 없거나 너무 큽니다."})
            return
        try:
            padded = encoded + "=" * (-len(encoded) % 4)
            metadata = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
            if not isinstance(metadata, dict):
                raise ValueError
        except (ValueError, UnicodeEncodeError, json.JSONDecodeError):
            send_json(self, 400, {"error": "게시물 설정 JSON을 확인해 주세요."})
            return
        try:
            with tempfile.TemporaryDirectory(prefix="makeshort-publish-") as temp_dir:
                video_path = Path(temp_dir) / "makeshort_captioned.mp4"
                remaining = length
                with video_path.open("wb") as video_file:
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise RequestError("영상 업로드가 중간에 끊겼습니다.")
                        video_file.write(chunk)
                        remaining -= len(chunk)
                send_json(self, 200, SOCIAL.publish(video_path, metadata))
        except (SocialError, RequestError) as exc:
            send_json(self, 400, {"error": str(exc)})
        except Exception:
            logger.exception("Social distribution request failed")
            if not self.wfile.closed:
                send_json(self, 500, {"error": "배포 중 오류가 발생했습니다. 앱 로그를 확인해 주세요."})

    def _send_oauth_popup(self, provider: str, message: str, failed: bool) -> None:
        payload = json.dumps(
            {"type": "makeshort-social-oauth", "provider": provider, "ok": not failed, "message": message},
            ensure_ascii=False,
        ).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        text = "계정 연결에 실패했습니다. MakeShort 화면에서 오류를 확인하세요." if failed else "연결되었습니다. 이 창을 닫고 MakeShort로 돌아가세요."
        body = (
            "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>MakeShort 계정 연결</title>"
            "<body><p>" + text + "</p><script>const result=" + payload + ";"
            "if(window.opener){window.opener.postMessage(result,'*');}"
            "setTimeout(()=>window.close(),250);</script></body></html>"
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def create_composite(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "JSON 요청 크기를 확인해 주세요."})
            return
        if length <= 0 or length > 262_144:
            send_json(self, 413, {"error": "JSON 요청은 256KB 이하여야 합니다."})
            return

        try:
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise RequestError("요청 본문은 JSON 객체여야 합니다.")
            video_id = youtube_video_id(request.get("url"))
            start = parse_timestamp(request.get("start"), "시작")
            end = parse_timestamp(request.get("end"), "종료")
            if end <= start:
                raise RequestError("종료 시간은 시작 시간보다 뒤여야 합니다.")
            if end - start > 3600:
                raise RequestError("한 번에 만들 수 있는 클립은 최대 1시간입니다.")
            mode = request.get("mode", "fill")
            if not isinstance(mode, str) or mode not in {"fill", "fit"}:
                raise RequestError("mode는 fill 또는 fit이어야 합니다.")
            include_audio = request.get("include_audio", True)
            if not isinstance(include_audio, bool):
                raise RequestError("include_audio는 true 또는 false여야 합니다.")
            requested_title = request.get("title", "")
            if not isinstance(requested_title, str) or len(requested_title) > 500:
                raise RequestError("title은 500자 이내의 문자열이어야 합니다.")
            captions = normalize_api_captions(request.get("captions", []))
            voiceover_requests = normalize_api_voiceovers(request.get("voiceovers", []))
            source_volume = request.get("source_volume", 1)
            duck_source_during_voiceover = request.get("duck_source_during_voiceover", True)
            provisional_duration = max(1, round(float(end - start) * DEFAULT_FPS))
            provisional_captions = [
                {
                    **caption,
                    "end": provisional_duration / DEFAULT_FPS,
                } if caption["_endAtClipEnd"] else caption
                for caption in captions
            ]
            validate_render_props({
                "fps": DEFAULT_FPS,
                "durationInFrames": provisional_duration,
                "sourceVolume": source_volume,
                "duckSourceDuringVoiceover": duck_source_during_voiceover,
                "captions": provisional_captions,
            })
        except (json.JSONDecodeError, UnicodeDecodeError):
            send_json(self, 400, {"error": "요청 본문이 올바른 JSON이 아닙니다."})
            return
        except RequestError as exc:
            send_json(self, 400, {"error": str(exc)})
            return

        if not (ROOT / "node_modules" / ".bin" / "remotion").exists():
            send_json(self, 503, {"error": "Remotion 설치가 필요합니다. README의 npm 설치 명령을 실행해 주세요."})
            return
        if voiceover_requests and not VOICE.status()["available"]:
            send_json(self, 503, {"error": VOICE.unavailable_message()})
            return

        response_started = False
        generated_voice_keys: list[str] = []
        try:
            with tempfile.TemporaryDirectory(prefix="makeshort-api-") as temp_dir:
                temp_root = Path(temp_dir)
                source, youtube_title = download_youtube_source(video_id, temp_root, include_audio)
                clip_path = temp_root / "clip.mp4"
                fps = create_portrait_clip(source, clip_path, start, end, mode, include_audio)
                frame_count = probe_video_frame_count(clip_path)
                clip_duration = frame_count / fps
                render_captions = [
                    {
                        **caption,
                        "end": clip_duration,
                    } if caption["_endAtClipEnd"] else caption
                    for caption in captions
                ]
                render_voiceovers: list[dict[str, object]] = []
                for voiceover_request in voiceover_requests:
                    asset_key = uuid.uuid4().hex
                    audio_path = PROJECT_MEDIA_ROOT / f"{asset_key}.wav"
                    try:
                        VOICE.generate(
                            str(voiceover_request["text"]),
                            str(voiceover_request["gender"]),
                            str(voiceover_request["tone"]),
                            float(voiceover_request["speed"]),
                            audio_path,
                            str(voiceover_request["language"]),
                        )
                        audio_duration = probe_audio_duration(audio_path)
                    except Exception:
                        audio_path.unlink(missing_ok=True)
                        raise
                    with MEDIA_FILES_LOCK:
                        MEDIA_FILES[asset_key] = audio_path
                        PROJECT_MEDIA_KEYS.add(asset_key)
                    generated_voice_keys.append(asset_key)
                    render_voiceovers.append({
                        "id": voiceover_request["id"],
                        "assetKey": asset_key,
                        "start": voiceover_request["start"],
                        "duration": audio_duration,
                        "volume": voiceover_request["volume"],
                    })

                composition_frames = max(
                    frame_count,
                    math.ceil(max(
                        (float(voiceover["start"]) + float(voiceover["duration"])) * fps
                        for voiceover in render_voiceovers
                    )) if render_voiceovers else frame_count,
                )
                props = validate_render_props({
                    "fps": fps,
                    "durationInFrames": composition_frames,
                    "sourceVolume": source_volume,
                    "duckSourceDuringVoiceover": duck_source_during_voiceover,
                    "captions": render_captions,
                    "voiceovers": render_voiceovers,
                })
                title = requested_title.strip() or youtube_title
                output_path = temp_root / "captioned.mp4"
                props_path = temp_root / "props.json"
                render_video_with_remotion(
                    clip_path,
                    output_path,
                    props_path,
                    props,
                    self.server.server_port,
                )

                filename = safe_video_filename(title)
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(output_path.stat().st_size))
                self.send_header(
                    "Content-Disposition",
                    f"attachment; filename=\"makeshort_clip.mp4\"; filename*=UTF-8''{quote(filename, safe='')}",
                )
                self.send_header("X-Makeshort-FPS", f"{fps:.9f}".rstrip("0").rstrip("."))
                self.send_header("X-Makeshort-Title", quote(title, safe=""))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                response_started = True
                with output_path.open("rb") as output_file:
                    shutil.copyfileobj(output_file, self.wfile, length=1024 * 1024)
        except yt_dlp.utils.DownloadError:
            logger.exception("YouTube download failed for %s", video_id)
            if not response_started:
                send_json(self, 422, {"error": "영상을 가져오지 못했습니다. 공개 영상인지, 링크가 정확한지 확인해 주세요."})
        except VoiceError as exc:
            if not response_started:
                send_json(self, 400, {"error": str(exc)})
        except RequestError as exc:
            if not response_started:
                send_json(self, 400, {"error": str(exc)})
        except Exception:
            logger.exception("Clip composition failed for %s", video_id)
            if not response_started and not self.wfile.closed:
                try:
                    send_json(self, 500, {"error": "클립을 합성하는 중 문제가 생겼습니다. 서버 로그를 확인해 주세요."})
                except (BrokenPipeError, ConnectionResetError):
                    pass
        finally:
            with MEDIA_FILES_LOCK:
                for asset_key in generated_voice_keys:
                    audio_path = MEDIA_FILES.pop(asset_key, None)
                    PROJECT_MEDIA_KEYS.discard(asset_key)
                    if audio_path is not None:
                        audio_path.unlink(missing_ok=True)

    def render_composite(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "업로드한 영상 크기를 확인해 주세요."})
            return
        if length < 0 or length > 1_000_000_000:
            send_json(self, 413, {"error": "영상 파일이 1GB를 초과합니다."})
            return

        encoded_props = self.headers.get("X-Makeshort-Props", "")
        if len(encoded_props) > 96_000:
            send_json(self, 413, {"error": "텍스트 설정이 너무 큽니다."})
            return
        try:
            raw_props = base64.urlsafe_b64decode(encoded_props.encode("ascii"))
            props = json.loads(raw_props)
            props = validate_render_props(props)
        except (ValueError, UnicodeEncodeError, json.JSONDecodeError, RequestError) as exc:
            message = str(exc) if isinstance(exc, RequestError) else "텍스트 설정을 확인해 주세요."
            send_json(self, 400, {"error": message})
            return

        remotion_cli = ROOT / "node_modules" / ".bin" / "remotion"
        if not remotion_cli.exists():
            send_json(self, 503, {"error": "Remotion 설치가 필요합니다. README의 npm 설치 명령을 실행해 주세요."})
            return

        response_started = False
        try:
            with tempfile.TemporaryDirectory(prefix="makeshort-render-") as temp_dir:
                temp_root = Path(temp_dir)
                input_path = temp_root / "input.mp4"
                output_path = temp_root / "captioned.mp4"
                props_path = temp_root / "props.json"
                if length:
                    remaining = length
                    with input_path.open("wb") as video_file:
                        while remaining:
                            chunk = self.rfile.read(min(1024 * 1024, remaining))
                            if not chunk:
                                raise RequestError("영상 업로드가 중간에 끊겼습니다.")
                            video_file.write(chunk)
                            remaining -= len(chunk)

                render_video_with_remotion(
                    input_path if length else None,
                    output_path,
                    props_path,
                    props,
                    self.server.server_port,
                )

                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(output_path.stat().st_size))
                self.send_header("Content-Disposition", 'attachment; filename="makeshort_captioned_clip.mp4"')
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                response_started = True
                with output_path.open("rb") as output_file:
                    shutil.copyfileobj(output_file, self.wfile, length=1024 * 1024)
        except RequestError as exc:
            if not response_started:
                send_json(self, 400, {"error": str(exc)})
        except Exception:
            logger.exception("Remotion composition failed")
            if not response_started:
                send_json(self, 500, {"error": "미디어를 합성하는 중 문제가 생겼습니다. 서버 로그를 확인해 주세요."})

    def _upload_project_image(self) -> None:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(content_type)
        if not extension:
            send_json(self, 415, {"error": "JPG, PNG 또는 WebP 이미지 파일을 선택해 주세요."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "이미지 크기를 확인해 주세요."})
            return
        if length <= 0 or length > 25_000_000:
            send_json(self, 413, {"error": "이미지는 파일당 25MB 이하로 선택해 주세요."})
            return
        data = self.rfile.read(length)
        if len(data) != length:
            send_json(self, 400, {"error": "이미지 업로드가 중간에 끊겼습니다."})
            return
        signatures = {
            ".jpg": data.startswith(b"\xff\xd8\xff"),
            ".png": data.startswith(b"\x89PNG\r\n\x1a\n"),
            ".webp": len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP",
        }
        if not signatures[extension]:
            send_json(self, 415, {"error": "파일 형식이 이미지 내용과 일치하지 않습니다."})
            return
        media_key = uuid.uuid4().hex
        media_path = PROJECT_MEDIA_ROOT / f"{media_key}{extension}"
        try:
            media_path.write_bytes(data)
        except OSError:
            logger.exception("Could not store uploaded project image")
            send_json(self, 500, {"error": "이미지를 임시 저장하지 못했습니다."})
            return
        with MEDIA_FILES_LOCK:
            MEDIA_FILES[media_key] = media_path
            PROJECT_MEDIA_KEYS.add(media_key)
        send_json(self, 201, {"assetKey": media_key})

    def _delete_project_image(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 2048:
                raise ValueError
            request = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            send_json(self, 400, {"error": "프로젝트 미디어 삭제 요청을 확인해 주세요."})
            return
        asset_key = request.get("assetKey") if isinstance(request, dict) else None
        if not isinstance(asset_key, str) or not re.fullmatch(r"[a-f0-9]{32}", asset_key):
            send_json(self, 400, {"error": "프로젝트 미디어 ID를 확인해 주세요."})
            return
        with MEDIA_FILES_LOCK:
            if asset_key not in PROJECT_MEDIA_KEYS:
                send_json(self, 404, {"error": "프로젝트 미디어를 찾을 수 없습니다."})
                return
            PROJECT_MEDIA_KEYS.remove(asset_key)
            media_path = MEDIA_FILES.pop(asset_key, None)
        if media_path:
            media_path.unlink(missing_ok=True)
        send_json(self, 200, {"deleted": True})

    def log_message(self, format: str, *args: object) -> None:
        message = format % args
        message = re.sub(r"(/oauth/(?:youtube|instagram|tiktok)/callback)\?[^ ]+", r"\1?<redacted>", message)
        logger.info("%s - %s", self.address_string(), message)


def validate_render_props(props: object) -> dict[str, object]:
    if not isinstance(props, dict):
        raise RequestError("텍스트 설정을 확인해 주세요.")
    try:
        frame_rate = float(props.get("fps", DEFAULT_FPS))
        duration_frames = int(props.get("durationInFrames", 0))
    except (TypeError, ValueError):
        raise RequestError("클립의 프레임레이트와 길이를 확인해 주세요.") from None
    try:
        source_volume = float(props.get("sourceVolume", 1))
    except (TypeError, ValueError):
        raise RequestError("원본 영상 음량을 확인해 주세요.") from None
    duck_source_during_voiceover = props.get("duckSourceDuringVoiceover", True)
    if not math.isfinite(frame_rate) or frame_rate < 1 or frame_rate > 120:
        raise RequestError("프레임레이트를 확인해 주세요.")
    if isinstance(props.get("sourceVolume", 1), bool) or not math.isfinite(source_volume) or not 0 <= source_volume <= 1:
        raise RequestError("원본 영상 음량은 0~1 범위여야 합니다.")
    if not isinstance(duck_source_during_voiceover, bool):
        raise RequestError("AI 음성 중 원본 음량 자동 조절 값을 확인해 주세요.")
    if duration_frames < 1 or duration_frames > frame_rate * 3600:
        raise RequestError("클립 길이는 1초 이상 1시간 이하여야 합니다.")
    captions = props.get("captions", [])
    if not isinstance(captions, list) or len(captions) > 120:
        raise RequestError("텍스트 레이어는 최대 120개까지 사용할 수 있습니다.")
    images = props.get("images", [])
    if not isinstance(images, list) or len(images) > 50:
        raise RequestError("이미지 레이어는 최대 50개까지 사용할 수 있습니다.")
    voiceovers = props.get("voiceovers", [])
    if not isinstance(voiceovers, list) or len(voiceovers) > 50:
        raise RequestError("AI 음성 레이어는 최대 50개까지 사용할 수 있습니다.")

    position_layout = {
        "top-left": (5, 5, 0, 0), "top-center": (50, 5, 0.5, 0), "top-right": (95, 5, 1, 0),
        "middle-left": (5, 50, 0, 0.5), "middle-center": (50, 50, 0.5, 0.5), "middle-right": (95, 50, 1, 0.5),
        "bottom-left": (5, 95, 0, 1), "bottom-center": (50, 95, 0.5, 1), "bottom-right": (95, 95, 1, 1),
    }
    fonts = {"noto", "black-han", "serif", "do-hyeon", "gowun-dodum", "gowun-batang", "nanum-gothic", "system"}
    animations = {"none", "fade", "pop", "typewriter"}
    decorations = {"none", "shadow", "outline", "box"}
    checked: list[dict[str, object]] = []
    checked_images: list[dict[str, object]] = []
    checked_voiceovers: list[dict[str, object]] = []
    duration_seconds = duration_frames / frame_rate
    for caption in captions:
        if not isinstance(caption, dict):
            raise RequestError("텍스트 레이어 설정을 확인해 주세요.")
        caption_id = caption.get("id")
        text = caption.get("text")
        if not isinstance(caption_id, str) or not CAPTION_ID.fullmatch(caption_id):
            raise RequestError("텍스트 레이어 ID를 확인해 주세요.")
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            raise RequestError("텍스트는 1~500자까지 입력할 수 있습니다.")
        try:
            start = float(caption.get("start"))
            end = float(caption.get("end"))
            font_size = int(caption.get("fontSize", 64))
            box_width = int(caption.get("boxWidth", 84))
            box_height = int(caption.get("boxHeight", 10))
        except (TypeError, ValueError):
            raise RequestError("텍스트의 시간과 크기를 확인해 주세요.") from None
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or end > duration_seconds + 0.05:
            raise RequestError("텍스트 시작·종료 시간은 클립 범위 안에 있어야 합니다.")
        if font_size < 20 or font_size > 180:
            raise RequestError("글자 크기는 20~180 사이여야 합니다.")
        if box_width < 30 or box_width > 100 or box_height < 5 or box_height > 50:
            raise RequestError("텍스트박스 너비와 높이를 확인해 주세요.")
        position = caption.get("position")
        font = caption.get("font")
        animation = caption.get("animation")
        decoration = caption.get("decoration")
        color = caption.get("color")
        if not all(isinstance(value, str) for value in (position, font, animation, decoration)):
            raise RequestError("폰트, 위치 또는 효과 옵션을 확인해 주세요.")
        if position not in position_layout or font not in fonts or animation not in animations or decoration not in decorations:
            raise RequestError("폰트, 위치 또는 효과 옵션을 확인해 주세요.")
        default_x, default_y, anchor_x, anchor_y = position_layout[position]
        try:
            position_x = float(caption.get("positionX", default_x))
            position_y = float(caption.get("positionY", default_y))
        except (TypeError, ValueError):
            raise RequestError("텍스트 위치를 확인해 주세요.") from None
        min_x, max_x = anchor_x * box_width, 100 - (1 - anchor_x) * box_width
        min_y, max_y = anchor_y * box_height, 100 - (1 - anchor_y) * box_height
        if not math.isfinite(position_x) or not min_x <= position_x <= max_x or not math.isfinite(position_y) or not min_y <= position_y <= max_y:
            raise RequestError("텍스트 위치가 화면 범위를 벗어났습니다.")
        if not isinstance(color, str) or not HEX_COLOR.fullmatch(color):
            raise RequestError("텍스트 색상을 확인해 주세요.")
        checked.append({
            "id": caption_id,
            "text": text,
            "start": start,
            "end": end,
            "boxWidth": box_width,
            "boxHeight": box_height,
            "position": position,
            "positionX": position_x,
            "positionY": position_y,
            "font": font,
            "fontSize": font_size,
            "color": color,
            "animation": animation,
            "decoration": decoration,
        })
    for image in images:
        if not isinstance(image, dict):
            raise RequestError("이미지 레이어 설정을 확인해 주세요.")
        image_id = image.get("id")
        asset_key = image.get("assetKey")
        if not isinstance(image_id, str) or not CAPTION_ID.fullmatch(image_id):
            raise RequestError("이미지 레이어 ID를 확인해 주세요.")
        if not isinstance(asset_key, str) or not re.fullmatch(r"[a-f0-9]{32}", asset_key):
            raise RequestError("이미지 파일을 다시 추가해 주세요.")
        try:
            start = float(image.get("start"))
            end = float(image.get("end"))
        except (TypeError, ValueError):
            raise RequestError("이미지의 노출 시간을 확인해 주세요.") from None
        fit = image.get("fit", "contain")
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or end > duration_seconds + 0.05:
            raise RequestError("이미지 시작·종료 시간은 클립 범위 안에 있어야 합니다.")
        if not isinstance(fit, str) or fit not in {"contain", "cover"}:
            raise RequestError("이미지 맞춤 방식을 확인해 주세요.")
        with MEDIA_FILES_LOCK:
            asset_exists = asset_key in PROJECT_MEDIA_KEYS and asset_key in MEDIA_FILES
        if not asset_exists:
            raise RequestError("이미지 파일이 만료되었습니다. 이미지를 다시 추가해 주세요.")
        checked_images.append({"id": image_id, "assetKey": asset_key, "start": start, "end": end, "fit": fit})
    for voiceover in voiceovers:
        if not isinstance(voiceover, dict):
            raise RequestError("AI 음성 레이어 설정을 확인해 주세요.")
        voiceover_id = voiceover.get("id")
        asset_key = voiceover.get("assetKey")
        if not isinstance(voiceover_id, str) or not CAPTION_ID.fullmatch(voiceover_id):
            raise RequestError("AI 음성 레이어 ID를 확인해 주세요.")
        if not isinstance(asset_key, str) or not re.fullmatch(r"[a-f0-9]{32}", asset_key):
            raise RequestError("생성된 음성을 다시 만들어 주세요.")
        try:
            start = float(voiceover.get("start"))
            audio_duration = float(voiceover.get("duration"))
            volume = float(voiceover.get("volume", 1))
        except (TypeError, ValueError):
            raise RequestError("AI 음성의 위치와 길이를 확인해 주세요.") from None
        if (
            not math.isfinite(start)
            or not math.isfinite(audio_duration)
            or not math.isfinite(volume)
            or start < 0
            or audio_duration <= 0
            or start + audio_duration > duration_seconds + 0.05
            or volume < 0
            or volume > 1
        ):
            raise RequestError("AI 음성의 시간 또는 볼륨이 프로젝트 범위를 벗어났습니다.")
        with MEDIA_FILES_LOCK:
            asset_exists = asset_key in PROJECT_MEDIA_KEYS and asset_key in MEDIA_FILES
        if not asset_exists:
            raise RequestError("생성된 음성이 만료되었습니다. 음성을 다시 만들어 주세요.")
        checked_voiceovers.append({
            "id": voiceover_id,
            "assetKey": asset_key,
            "start": start,
            "duration": audio_duration,
            "volume": volume,
        })
    return {
        "fps": frame_rate,
        "durationInFrames": duration_frames,
        "sourceVolume": source_volume,
        "duckSourceDuringVoiceover": duck_source_during_voiceover,
        "captions": checked,
        "images": checked_images,
        "voiceovers": checked_voiceovers,
    }


def main() -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg가 필요합니다. ffmpeg 설치 후 다시 실행해 주세요.")
    server = ThreadingHTTPServer((HOST, PORT), MakeShortHandler)
    logger.info("MakeShort is running at http://%s:%s", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
