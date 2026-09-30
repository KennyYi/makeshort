#!/usr/bin/env python3
"""Local web app for making portrait clips from public YouTube videos."""

from __future__ import annotations

import json
import logging
import base64
import math
import mimetypes
import re
import shutil
import tempfile
import threading
import uuid
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import yt_dlp


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
OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
FPS = 30

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


def make_filter(mode: str) -> str:
    if mode == "fill":
        return (
            f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase:"
            f"force_divisible_by=2,crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},setsar=1,fps=30"
        )
    if mode == "fit":
        return (
            f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease:"
            f"force_divisible_by=2,pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,"
            "setsar=1,fps=30"
        )
    raise RequestError("화면 비율 옵션을 선택해 주세요.")


def send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, str]) -> None:
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
        self.send_header("Content-Type", "video/mp4")
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
            video_filter = make_filter(mode) if isinstance(mode, str) else make_filter("")
        except (json.JSONDecodeError, UnicodeDecodeError):
            send_json(self, 400, {"error": "요청 내용을 확인해 주세요."})
            return
        except RequestError as exc:
            send_json(self, 400, {"error": str(exc)})
            return

        try:
            with tempfile.TemporaryDirectory(prefix="makeshort-") as temp_dir:
                source_template = str(Path(temp_dir) / "source.%(ext)s")
                options = {
                    "format": "bv*+ba/b",
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
                    downloader.download([f"https://www.youtube.com/watch?v={video_id}"])

                candidates = [
                    path for path in Path(temp_dir).glob("source.*")
                    if path.is_file() and not path.name.endswith((".part", ".ytdl"))
                ]
                if not candidates:
                    raise RuntimeError("yt-dlp completed without an output file")
                source = candidates[0]
                output = Path(temp_dir) / "makeshort_clip.mp4"
                duration = end - start
                command = [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-ss", str(start), "-i", str(source), "-t", str(duration),
                    "-map", "0:v:0", "-map", "0:a?", "-vf", video_filter,
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
                    "-pix_fmt", "yuv420p", str(output),
                ]
                logger.info("Creating %s clip (%s to %s)", mode, start, end)
                result = shutil.which("ffmpeg")
                if not result:
                    raise RuntimeError("ffmpeg was not found on PATH")
                import subprocess
                subprocess.run(command, check=True, capture_output=True, timeout=3600)
                if not output.is_file() or output.stat().st_size == 0:
                    raise RuntimeError("ffmpeg did not produce a clip")

                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(output.stat().st_size))
                self.send_header("Content-Disposition", 'attachment; filename="makeshort_clip.mp4"')
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

    def render_composite(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "업로드한 영상 크기를 확인해 주세요."})
            return
        if length <= 0 or length > 1_000_000_000:
            send_json(self, 413, {"error": "영상 파일이 비어 있거나 1GB를 초과합니다."})
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

        media_key = uuid.uuid4().hex
        response_started = False
        try:
            with tempfile.TemporaryDirectory(prefix="makeshort-render-") as temp_dir:
                temp_root = Path(temp_dir)
                input_path = temp_root / "input.mp4"
                output_path = temp_root / "captioned.mp4"
                props_path = temp_root / "props.json"
                remaining = length
                with input_path.open("wb") as video_file:
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise RequestError("영상 업로드가 중간에 끊겼습니다.")
                        video_file.write(chunk)
                        remaining -= len(chunk)

                props["src"] = f"http://{HOST}:{self.server.server_port}/api/media/{media_key}"
                props_path.write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
                with MEDIA_FILES_LOCK:
                    MEDIA_FILES[media_key] = input_path

                command = [
                    str(remotion_cli), "render", str(ROOT / "web" / "src" / "remotion" / "index.jsx"),
                    "CaptionedClip", str(output_path), "--props", str(props_path),
                    "--duration", str(props["durationInFrames"]), "--codec", "h264", "--crf", "18",
                    "--concurrency", "2",
                ]
                logger.info("Rendering Remotion composition for %s", media_key)
                import subprocess
                result = subprocess.run(
                    command, cwd=ROOT, capture_output=True, text=True, timeout=7200,
                )
                if result.returncode != 0:
                    logger.error("Remotion render failed: %s", result.stderr[-6000:])
                    send_json(self, 500, {"error": "Remotion 합성에 실패했습니다. 입력 설정을 확인한 뒤 다시 시도해 주세요."})
                    return
                if not output_path.is_file() or output_path.stat().st_size == 0:
                    raise RuntimeError("Remotion completed without an output file")

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
                send_json(self, 500, {"error": "텍스트를 합성하는 중 문제가 생겼습니다. 서버 로그를 확인해 주세요."})
        finally:
            with MEDIA_FILES_LOCK:
                MEDIA_FILES.pop(media_key, None)

    def log_message(self, format: str, *args: object) -> None:
        logger.info("%s - %s", self.address_string(), format % args)


def validate_render_props(props: object) -> dict[str, object]:
    if not isinstance(props, dict):
        raise RequestError("텍스트 설정을 확인해 주세요.")
    try:
        duration_frames = int(props.get("durationInFrames", 0))
    except (TypeError, ValueError):
        raise RequestError("클립 길이를 확인해 주세요.") from None
    if duration_frames < 1 or duration_frames > FPS * 3600:
        raise RequestError("클립 길이는 1초 이상 1시간 이하여야 합니다.")
    captions = props.get("captions", [])
    if not isinstance(captions, list) or len(captions) > 120:
        raise RequestError("텍스트 레이어는 최대 120개까지 사용할 수 있습니다.")

    position_layout = {
        "top-left": (5, 5, 0, 0), "top-center": (50, 5, 0.5, 0), "top-right": (95, 5, 1, 0),
        "middle-left": (5, 50, 0, 0.5), "middle-center": (50, 50, 0.5, 0.5), "middle-right": (95, 50, 1, 0.5),
        "bottom-left": (5, 95, 0, 1), "bottom-center": (50, 95, 0.5, 1), "bottom-right": (95, 95, 1, 1),
    }
    fonts = {"noto", "black-han", "serif", "system"}
    animations = {"none", "fade", "pop", "typewriter"}
    decorations = {"none", "shadow", "outline", "box"}
    checked: list[dict[str, object]] = []
    duration_seconds = duration_frames / FPS
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
    return {"durationInFrames": duration_frames, "captions": checked}


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
