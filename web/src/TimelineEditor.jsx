import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { CaptionVideo } from "./remotion/CaptionVideo.jsx";
import { SocialDistribution } from "./SocialDistribution.jsx";

const DEFAULT_FPS = 30;
const POSITION_LABELS = [
  ["top-left", "위 왼쪽", 5, 5, 0, 0], ["top-center", "위 가운데", 50, 5, 0.5, 0], ["top-right", "위 오른쪽", 95, 5, 1, 0],
  ["middle-left", "중간 왼쪽", 5, 50, 0, 0.5], ["middle-center", "중간 가운데", 50, 50, 0.5, 0.5], ["middle-right", "중간 오른쪽", 95, 50, 1, 0.5],
  ["bottom-left", "아래 왼쪽", 5, 95, 0, 1], ["bottom-center", "아래 가운데", 50, 95, 0.5, 1], ["bottom-right", "아래 오른쪽", 95, 95, 1, 1],
];
const POSITION_DETAILS = Object.fromEntries(POSITION_LABELS.map(([position, label, x, y, anchorX, anchorY]) => [
  position,
  { label, x, y, anchorX, anchorY },
]));

const createCaption = (duration, start = 0) => ({
  id: crypto.randomUUID().replaceAll("-", ""),
  text: "새로운 텍스트",
  start,
  end: Math.min(start + 3.5, duration),
  boxWidth: 84,
  boxHeight: 10,
  position: "bottom-center",
  positionX: POSITION_DETAILS["bottom-center"].x,
  positionY: POSITION_DETAILS["bottom-center"].y,
  font: "noto",
  fontSize: 72,
  color: "#ffffff",
  animation: "fade",
  decoration: "shadow",
});

const STYLE_PRESETS = [
  { id: "classic", label: "기본", sample: "가나다", font: "noto", fontSize: 72, color: "#ffffff", animation: "fade", decoration: "shadow" },
  { id: "impact", label: "임팩트", sample: "강조!", font: "black-han", fontSize: 104, color: "#ffe45c", animation: "pop", decoration: "outline" },
  { id: "clean", label: "깔끔한 자막", sample: "자막", font: "noto", fontSize: 56, color: "#ffffff", animation: "none", decoration: "box" },
  { id: "mint", label: "민트 포인트", sample: "포인트", font: "black-han", fontSize: 88, color: "#c8f45a", animation: "pop", decoration: "outline" },
];

const VOICE_GENDERS = [
  { id: "male", label: "남성" },
  { id: "female", label: "여성" },
];

const VOICE_TONES = [
  { id: "calm", label: "차분함", detail: "부드럽고 안정적으로" },
  { id: "playful", label: "장난기", detail: "가볍고 생기 있게" },
  { id: "angry", label: "화남", detail: "단호하고 강하게" },
  { id: "whisper", label: "속삭임", detail: "작고 가까운 목소리로" },
  { id: "bright", label: "밝고 활기참", detail: "경쾌하고 환하게" },
  { id: "sad", label: "슬픔", detail: "차분하고 먹먹하게" },
  { id: "confident", label: "자신감", detail: "또렷하고 확신 있게" },
  { id: "narration", label: "내레이션", detail: "발음을 살려 전달력 있게" },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const formatTime = (seconds) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}.${tenths}`;
};

const parseTime = (raw) => {
  const value = String(raw).trim();
  if (!value) return NaN;
  if (!value.includes(":")) return Number(value);
  const parts = value.split(":");
  if (parts.length !== 2 && parts.length !== 3) return NaN;
  const numbers = parts.map(Number);
  if (numbers.some((number) => !Number.isFinite(number) || number < 0)) return NaN;
  if (numbers.length === 2) return numbers[1] < 60 ? numbers[0] * 60 + numbers[1] : NaN;
  return numbers[1] < 60 && numbers[2] < 60 ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2] : NaN;
};

const filenameForTitle = (title) => {
  const safeTitle = String(title ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\.(?:mp4|mov|m4v)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180)
    .trim();
  return `${safeTitle || "makeshort_clip"}.mp4`;
};

const encodeProps = (props) => {
  const bytes = new TextEncoder().encode(JSON.stringify(props));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
};

const downloadFile = (url, filename) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
};

const copyTextToClipboard = async (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the browser's copy command when clipboard access is unavailable.
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("클립보드에 복사하지 못했습니다.");
};

export const TimelineEditor = () => {
  const [clip, setClip] = useState(null);
  const [clipUrl, setClipUrl] = useState("");
  const [sourceVolume, setSourceVolume] = useState(1);
  const [duckSourceDuringVoiceover, setDuckSourceDuringVoiceover] = useState(true);
  const [videoTitle, setVideoTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [durationEdited, setDurationEdited] = useState(false);
  const [frameRate, setFrameRate] = useState(DEFAULT_FPS);
  const [captions, setCaptions] = useState([]);
  const [images, setImages] = useState([]);
  const [voiceovers, setVoiceovers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [selectedVoiceoverId, setSelectedVoiceoverId] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [renderedUrl, setRenderedUrl] = useState("");
  const [renderedBlob, setRenderedBlob] = useState(null);
  const [copiedCaptionJson, setCopiedCaptionJson] = useState("");
  const [youtubePanelOpen, setYoutubePanelOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeStart, setYoutubeStart] = useState("00:00");
  const [youtubeEnd, setYoutubeEnd] = useState("00:30");
  const [youtubeMode, setYoutubeMode] = useState("fill");
  const [includeYoutubeAudio, setIncludeYoutubeAudio] = useState(true);
  const [addingYoutube, setAddingYoutube] = useState(false);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState(null);
  const [scriptText, setScriptText] = useState("");
  const [scriptSegments, setScriptSegments] = useState([]);
  const [voiceGender, setVoiceGender] = useState("female");
  const [voiceTone, setVoiceTone] = useState("calm");
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const playerRef = useRef(null);
  const playerWrapRef = useRef(null);
  const timelineContentRef = useRef(null);
  const dragRef = useRef(null);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const latestTimelineStateRef = useRef(null);

  useLayoutEffect(() => {
    latestTimelineStateRef.current = { captions, duration, durationEdited, images, voiceovers };
  }, [captions, duration, durationEdited, images, voiceovers]);

  const durationInFrames = Math.max(1, Math.round(duration * frameRate));
  const outputFilename = filenameForTitle(videoTitle);
  const selectedCaption = captions.find((caption) => caption.id === selectedId) ?? null;
  const selectedImage = images.find((image) => image.id === selectedImageId) ?? null;
  const selectedVoiceover = voiceovers.find((voiceover) => voiceover.id === selectedVoiceoverId) ?? null;
  const captionJson = useMemo(() => JSON.stringify({
    captions: captions.map(({ id, text, start, end, boxWidth, boxHeight, position, positionX, positionY, font, fontSize, color, animation, decoration }) => ({
      id, text, start, end, boxWidth, boxHeight, position, positionX, positionY, font, fontSize, color, animation, decoration,
    })),
  }, null, 2), [captions]);
  const timelineWidth = Math.max(720, duration * 28);
  const rulerTicks = useMemo(() => {
    const ticks = [];
    for (let second = 0; second <= duration; second += 5) ticks.push(second);
    if (duration > 0 && (!ticks.length || duration - ticks[ticks.length - 1] > 1)) ticks.push(duration);
    return ticks;
  }, [duration]);

  const acceptClip = useCallback((detail) => {
    if (!detail?.blob || !Number.isFinite(detail.duration) || detail.duration <= 0) return;
    const latest = latestTimelineStateRef.current;
    const nextClipUrl = URL.createObjectURL(detail.blob);
    setClip(detail.blob);
    setSourceVolume(1);
    setClipUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return nextClipUrl;
    });
    setVideoTitle(detail.title || String(detail.name || "클립").replace(/\.[^.]+$/, ""));
    const overlayEnd = Math.max(0, ...latest.captions.map((caption) => caption.end), ...latest.images.map((image) => image.end), ...latest.voiceovers.map((voiceover) => voiceover.start + voiceover.duration));
    if (!latest.durationEdited && overlayEnd === 0) {
      setDuration(detail.duration);
    } else {
      setDuration(Math.max(detail.duration, overlayEnd, latest.durationEdited ? latest.duration : 0));
    }
    setFrameRate(Number.isFinite(detail.fps) && detail.fps >= 1 && detail.fps <= 120 ? detail.fps : DEFAULT_FPS);
    setSelectedImageId(null);
    setCurrentFrame(0);
    setError("");
    setRenderedUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setRenderedBlob(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return undefined;
    const update = (event) => setCurrentFrame(event.detail.frame);
    player.addEventListener("frameupdate", update);
    return () => player.removeEventListener("frameupdate", update);
  }, [clipUrl]);

  useEffect(() => {
    const move = (event) => {
      const drag = dragRef.current;
      if (!drag || drag.mode === "position") return;
      const board = timelineContentRef.current;
      if (!board) return;
      const boardWidth = Math.max(1, board.getBoundingClientRect().width - 98);
      const delta = ((event.clientX - drag.pointerX) / boardWidth) * duration;
      const updateLayers = drag.kind === "image" ? setImages : drag.kind === "voice" ? setVoiceovers : setCaptions;
      updateLayers((current) => current.map((layer) => {
        if (layer.id !== drag.id) return layer;
        const span = drag.end - drag.start;
        if (drag.mode === "move") {
          const start = clamp(drag.start + delta, 0, Math.max(0, duration - span));
          return { ...layer, start, end: start + span };
        }
        if (drag.mode === "start") {
          return { ...layer, start: clamp(drag.start + delta, 0, drag.end - 0.1) };
        }
        return { ...layer, end: clamp(drag.end + delta, drag.start + 0.1, duration) };
      }));
      clearRendered();
    };
    const finish = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [duration]);

  const clearRendered = () => {
    setRenderedUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setRenderedBlob(null);
  };

  const updateCaption = (patch) => {
    if (!selectedId) return;
    setCaptions((current) => current.map((caption) => caption.id === selectedId ? { ...caption, ...patch } : caption));
    clearRendered();
  };

  const updateImage = (patch) => {
    if (!selectedImageId) return;
    setImages((current) => current.map((image) => image.id === selectedImageId ? { ...image, ...patch } : image));
    clearRendered();
  };

  const deleteProjectAsset = (assetKey) => {
    if (!assetKey) return;
    fetch("/api/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetKey }),
    }).catch(() => {});
  };

  const addImages = async (event) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    setError("");
    const added = [];
    try {
      if (images.length + files.length > 50) {
        throw new Error("이미지 레이어는 프로젝트당 최대 50개까지 추가할 수 있습니다.");
      }
      for (const file of files) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
          throw new Error("JPG, PNG 또는 WebP 이미지를 선택해 주세요.");
        }
        const response = await fetch("/api/media/upload", {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "이미지를 업로드하지 못했습니다.");
        const start = clamp(currentFrame / frameRate, 0, Math.max(0, duration - 0.1));
        const end = Math.min(duration, start + 3);
        added.push({
          id: crypto.randomUUID().replaceAll("-", ""),
          name: file.name,
          assetKey: result.assetKey,
          previewUrl: URL.createObjectURL(file),
          start,
          end: Math.max(start + 0.1, end),
          fit: "contain",
        });
      }
      if (added.length) {
        setImages((current) => [...current, ...added]);
        setSelectedId(null);
        setSelectedImageId(added[added.length - 1].id);
        clearRendered();
      }
    } catch (imageError) {
      added.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
        deleteProjectAsset(image.assetKey);
      });
      const message = imageError instanceof Error ? imageError.message : "이미지를 추가하지 못했습니다.";
      setError(/failed to fetch|networkerror|load failed/i.test(message)
        ? "이미지 저장 서버에 연결할 수 없습니다. MakeShort 앱을 다시 실행한 뒤 시도해 주세요."
        : message);
    }
  };

  const deleteSelectedImage = () => {
    if (!selectedImage) return;
    URL.revokeObjectURL(selectedImage.previewUrl);
    deleteProjectAsset(selectedImage.assetKey);
    setImages((current) => current.filter((image) => image.id !== selectedImage.id));
    setSelectedImageId(null);
    clearRendered();
  };

  const deleteSelectedVoiceover = () => {
    if (!selectedVoiceover) return;
    deleteProjectAsset(selectedVoiceover.assetKey);
    setVoiceovers((current) => current.filter((voiceover) => voiceover.id !== selectedVoiceover.id));
    setScriptSegments((current) => current.map((segment) => segment.voiceoverId === selectedVoiceover.id
      ? { ...segment, voiceoverId: null }
      : segment));
    setSelectedVoiceoverId(null);
    clearRendered();
  };

  const splitScript = () => {
    const parts = scriptText
      .replace(/([.!?。！？])\s+/gu, "$1\n")
      .split(/\r?\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
    setScriptSegments(parts.map((text) => ({
      id: crypto.randomUUID().replaceAll("-", ""),
      text,
      selected: false,
      voiceoverId: null,
    })));
    setError("");
  };

  const updateVoiceStatus = async () => {
    try {
      const response = await fetch("/api/voice/status");
      const result = await response.json().catch(() => ({}));
      setVoiceStatus(response.ok ? result : { available: false, unavailable: true });
    } catch {
      setVoiceStatus({ available: false, unavailable: true });
    }
  };

  useEffect(() => {
    if (voicePanelOpen) updateVoiceStatus();
  }, [voicePanelOpen]);

  const generateSelectedVoice = async () => {
    const selectedSegments = scriptSegments.filter((segment) => segment.selected);
    if (!selectedSegments.length) {
      setError("음성으로 만들 문장을 먼저 선택해 주세요.");
      return;
    }
    if (!voiceStatus?.available) {
      setError(voiceStatus?.platform_supported === false
        ? "말투 프리셋 음성 생성은 Apple Silicon Mac에서 사용할 수 있습니다."
        : "로컬 Qwen3-TTS 환경이나 모델 캐시를 찾지 못했습니다. requirements-voice.txt로 Python 3.12 음성 환경을 준비해 주세요.");
      return;
    }
    const newCount = selectedSegments.filter((segment) => !voiceovers.some((voiceover) => voiceover.segmentId === segment.id)).length;
    if (voiceovers.length + newCount > 50) {
      setError("AI 음성 레이어는 프로젝트당 최대 50개까지 만들 수 있습니다.");
      return;
    }
    setGeneratingVoice(true);
    setError("");
    let cursor = currentFrame / frameRate;
    try {
      for (const segment of selectedSegments) {
        const response = await fetch("/api/voice/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: segment.text, gender: voiceGender, tone: voiceTone, speed: ttsSpeed }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "AI 음성을 생성하지 못했습니다.");
        const previous = voiceovers.find((voiceover) => voiceover.segmentId === segment.id);
        const start = previous ? previous.start : cursor;
        const end = start + Number(result.duration);
        if (!Number.isFinite(end) || end > 3600) {
          deleteProjectAsset(result.assetKey);
          throw new Error("생성된 음성이 1시간 프로젝트 한도를 넘습니다.");
        }
        const voiceover = {
          id: crypto.randomUUID().replaceAll("-", ""),
          segmentId: segment.id,
          assetKey: result.assetKey,
          src: `/api/media/${result.assetKey}`,
          text: segment.text,
          voice: result.voice || `Qwen3-TTS · ${voiceGender === "male" ? "남성" : "여성"} · ${VOICE_TONES.find((preset) => preset.id === voiceTone)?.label || "차분함"}`,
          start,
          duration: Number(result.duration),
          volume: 1,
        };
        if (previous) deleteProjectAsset(previous.assetKey);
        setVoiceovers((current) => [...current.filter((item) => item.segmentId !== segment.id), voiceover]);
        setScriptSegments((current) => current.map((item) => item.id === segment.id
          ? { ...item, voiceoverId: voiceover.id }
          : item));
        setSelectedVoiceoverId(voiceover.id);
        setSelectedId(null);
        setSelectedImageId(null);
        setDuration((current) => Math.max(current, end));
        clearRendered();
        cursor = Math.max(cursor, end) + 0.25;
      }
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "AI 음성 생성에 실패했습니다.");
    } finally {
      void updateVoiceStatus();
      setGeneratingVoice(false);
    }
  };

  const addYoutubeClip = async (event) => {
    event.preventDefault();
    setError("");
    const start = parseTime(youtubeStart);
    const end = parseTime(youtubeEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setError("유튜브 시작·종료 시간을 확인해 주세요. 초 또는 MM:SS 형식으로 입력할 수 있습니다.");
      return;
    }
    setAddingYoutube(true);
    try {
      const response = await fetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: youtubeUrl.trim(),
          start: youtubeStart.trim(),
          end: youtubeEnd.trim(),
          mode: youtubeMode,
          include_audio: includeYoutubeAudio,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "유튜브 영상을 가져오지 못했습니다.");
      }
      const fps = Number(response.headers.get("X-Makeshort-FPS")) || DEFAULT_FPS;
      let title = "YouTube 클립";
      try { title = decodeURIComponent(response.headers.get("X-Makeshort-Title") || title); } catch {}
      acceptClip({ blob: await response.blob(), duration: end - start, fps, title, name: title });
      setYoutubePanelOpen(false);
    } catch (youtubeError) {
      setError(youtubeError instanceof Error ? youtubeError.message : "유튜브 클립을 추가하지 못했습니다.");
    } finally {
      setAddingYoutube(false);
    }
  };

  const importLocalVideo = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const probeUrl = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(probeUrl);
      if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
        setError("영상 길이를 확인할 수 없습니다.");
        return;
      }
      acceptClip({ blob: file, duration: probe.duration, name: file.name, title: file.name.replace(/\.[^.]+$/, "") });
    };
    probe.onerror = () => {
      URL.revokeObjectURL(probeUrl);
      setError("이 영상 파일을 열 수 없습니다.");
    };
    probe.src = probeUrl;
  };

  const removeVideoSource = () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    setClip(null);
    setClipUrl("");
    setSourceVolume(1);
    setVideoTitle("");
    setCurrentFrame(0);
    playerRef.current?.seekTo(0);
    clearRendered();
  };

  const changeDuration = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const lastVoiceFrame = Math.max(0, ...voiceovers.map((voiceover) => voiceover.start + voiceover.duration));
    const nextDuration = clamp(Math.max(parsed, lastVoiceFrame), 1, 3600);
    setDurationEdited(true);
    setDuration(nextDuration);
    setCaptions((current) => current.map((caption) => ({
      ...caption,
      start: Math.min(caption.start, Math.max(0, nextDuration - 0.1)),
      end: Math.min(nextDuration, Math.max(caption.start + 0.1, caption.end)),
    })));
    setImages((current) => current.map((image) => ({
      ...image,
      start: Math.min(image.start, Math.max(0, nextDuration - 0.1)),
      end: Math.min(nextDuration, Math.max(image.start + 0.1, image.end)),
    })));
    clearRendered();
  };

  const applyStylePreset = (preset) => {
    const { font, fontSize, color, animation, decoration } = preset;
    updateCaption({ font, fontSize, color, animation, decoration });
  };

  const addCaption = () => {
    const start = clamp(currentFrame / frameRate, 0, Math.max(0, duration - 0.1));
    const caption = createCaption(duration, start);
    setCaptions((current) => [...current, caption]);
    selectCaption(caption);
    setError("");
    clearRendered();
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setCaptions((current) => current.filter((caption) => caption.id !== selectedId));
    setSelectedId(null);
    clearRendered();
  };

  const updateTime = (field, value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    if (field === "start") {
      const start = clamp(parsed, 0, Math.max(0, selectedCaption.end - 0.1));
      updateCaption({ start });
    } else {
      const end = clamp(parsed, selectedCaption.start + 0.1, duration);
      updateCaption({ end });
    }
  };

  const copyCaptionSettings = async () => {
    try {
      await copyTextToClipboard(captionJson);
      setCopiedCaptionJson(captionJson);
    } catch {
      setError("자막 JSON을 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.");
    }
  };

  const beginDrag = (event, layer, mode, kind = "caption") => {
    event.preventDefault();
    event.stopPropagation();
    if (kind === "image") {
      setSelectedId(null);
      setSelectedImageId(layer.id);
      setSelectedVoiceoverId(null);
    } else if (kind === "voice") {
      setSelectedId(null);
      setSelectedImageId(null);
      setSelectedVoiceoverId(layer.id);
    } else {
      setSelectedId(layer.id);
      setSelectedImageId(null);
      setSelectedVoiceoverId(null);
    }
    clearRendered();
    dragRef.current = {
      id: layer.id,
      kind,
      mode,
      pointerX: event.clientX,
      start: layer.start,
      end: layer.end,
    };
  };

  const beginPositionDrag = (event, caption) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(caption.id);
    setSelectedImageId(null);
    setSelectedVoiceoverId(null);
    clearRendered();
    const position = POSITION_DETAILS[caption.position] ?? POSITION_DETAILS["bottom-center"];
    dragRef.current = {
      id: caption.id,
      mode: "position",
      pointerX: event.clientX,
      pointerY: event.clientY,
      position: caption.position,
      positionX: caption.positionX ?? position.x,
      positionY: caption.positionY ?? position.y,
      boxWidth: caption.boxWidth ?? 84,
      boxHeight: caption.boxHeight ?? 10,
    };
  };

  const movePositionDrag = (event) => {
    const drag = dragRef.current;
    const rect = playerWrapRef.current?.getBoundingClientRect();
    if (drag?.mode !== "position" || !rect?.width || !rect.height) return;
    const position = POSITION_DETAILS[drag.position] ?? POSITION_DETAILS["bottom-center"];
    const deltaX = ((event.clientX - drag.pointerX) / rect.width) * 100;
    const deltaY = ((event.clientY - drag.pointerY) / rect.height) * 100;
    const positionX = clamp(drag.positionX + deltaX, position.anchorX * drag.boxWidth, 100 - (1 - position.anchorX) * drag.boxWidth);
    const positionY = clamp(drag.positionY + deltaY, position.anchorY * drag.boxHeight, 100 - (1 - position.anchorY) * drag.boxHeight);
    setCaptions((current) => current.map((caption) => caption.id === drag.id
      ? { ...caption, positionX, positionY }
      : caption));
    clearRendered();
  };

  const finishPositionDrag = () => {
    if (dragRef.current?.mode === "position") dragRef.current = null;
  };

  const selectCaption = (caption) => {
    setSelectedId(caption.id);
    setSelectedImageId(null);
    setSelectedVoiceoverId(null);
    const time = currentFrame / frameRate;
    if (time < caption.start || time >= caption.end || time - caption.start < 0.2) {
      const previewTime = caption.start + Math.min(0.25, (caption.end - caption.start) / 2);
      const targetFrame = Math.min(Math.ceil(caption.end * frameRate) - 1, Math.round(previewTime * frameRate));
      playerRef.current?.seekTo(Math.max(0, targetFrame));
      setCurrentFrame(Math.max(0, targetFrame));
    }
  };

  const selectImage = (image) => {
    setSelectedId(null);
    setSelectedImageId(image.id);
    setSelectedVoiceoverId(null);
    const time = currentFrame / frameRate;
    if (time < image.start || time >= image.end) {
      const targetFrame = Math.min(Math.ceil(image.end * frameRate) - 1, Math.round(image.start * frameRate));
      playerRef.current?.seekTo(Math.max(0, targetFrame));
      setCurrentFrame(Math.max(0, targetFrame));
    }
  };

  const selectVoiceover = (voiceover) => {
    setSelectedId(null);
    setSelectedImageId(null);
    setSelectedVoiceoverId(voiceover.id);
    const targetFrame = Math.max(0, Math.round(voiceover.start * frameRate));
    playerRef.current?.seekTo(targetFrame);
    setCurrentFrame(targetFrame);
  };

  const seekTimeline = (event) => {
    if (event.target.closest(".timeline-caption, .timeline-image, .timeline-voice")) return;
    const board = timelineContentRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const laneLeft = rect.left + 98;
    const laneWidth = Math.max(1, rect.width - 98);
    const fraction = clamp((event.clientX - laneLeft) / laneWidth, 0, 1);
    const frame = Math.round(fraction * durationInFrames);
    playerRef.current?.seekTo(frame);
    setCurrentFrame(frame);
  };

  const exportClip = async () => {
    setError("");
    if (!clip && captions.length === 0 && images.length === 0 && voiceovers.length === 0) {
      setError("먼저 YouTube 영상, 이미지, 텍스트 또는 AI 음성을 추가해 주세요.");
      return;
    }
    setRendering(true);
    try {
      const props = {
        fps: frameRate,
        durationInFrames,
        sourceVolume,
        duckSourceDuringVoiceover,
        captions: captions.map(({ id, text, start, end, boxWidth, boxHeight, position, positionX, positionY, font, fontSize, color, animation, decoration }) => ({
          id, text, start, end, boxWidth, boxHeight, position, positionX, positionY, font, fontSize, color, animation, decoration,
        })),
        images: images.map(({ id, assetKey, start, end, fit }) => ({ id, assetKey, start, end, fit })),
        voiceovers: voiceovers.map(({ id, assetKey, start, duration, volume }) => ({ id, assetKey, start, duration, volume })),
      };
      const response = await fetch("/api/render", {
        method: "POST",
        headers: {
          "Content-Type": "video/mp4",
          "X-Makeshort-Props": encodeProps(props),
        },
        body: clip ?? new Blob([], { type: "video/mp4" }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Remotion 합성에 실패했습니다.");
      }
      const output = await response.blob();
      const outputUrl = URL.createObjectURL(output);
      setRenderedBlob(output);
      setRenderedUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return outputUrl;
      });
      const anchor = document.createElement("a");
      anchor.href = outputUrl;
      anchor.download = outputFilename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : "합성에 실패했습니다.");
    } finally {
      setRendering(false);
    }
  };

  const resetEditor = () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    images.forEach((image) => {
      URL.revokeObjectURL(image.previewUrl);
      deleteProjectAsset(image.assetKey);
    });
    voiceovers.forEach((voiceover) => deleteProjectAsset(voiceover.assetKey));
    setClip(null);
    setClipUrl("");
    setSourceVolume(1);
    setDuckSourceDuringVoiceover(true);
    setVideoTitle("");
    setRenderedUrl("");
    setRenderedBlob(null);
    setCaptions([]);
    setImages([]);
    setVoiceovers([]);
    setSelectedId(null);
    setSelectedImageId(null);
    setSelectedVoiceoverId(null);
    setDuration(30);
    setDurationEdited(false);
    setFrameRate(DEFAULT_FPS);
    setCurrentFrame(0);
    setYoutubeUrl("");
    setYoutubeStart("00:00");
    setYoutubeEnd("00:30");
    setYoutubeMode("fill");
    setIncludeYoutubeAudio(true);
    setYoutubePanelOpen(false);
    setScriptText("");
    setScriptSegments([]);
    setVoicePanelOpen(false);
    setError("");
  };

  return (
    <div className="video-editor">
      <header className="video-editor-header">
        <div className="editor-title-wrap">
          <button type="button" className="back-button" onClick={resetEditor} aria-label="새 프로젝트" disabled={rendering}>↺</button>
          <div><span className="section-index">TIMELINE EDITOR</span><h2>영상과 텍스트 편집</h2><p>{clip ? "영상 클립 포함" : "빈 세로 화면 프로젝트"} · {formatTime(duration)}</p></div>
        </div>
        <div className="editor-header-actions">
          <label className="duration-control"><span>길이</span><input aria-label="프로젝트 길이(초)" type="number" min="1" max="3600" step="1" value={duration} disabled={rendering} onChange={(event) => changeDuration(event.target.value)} /><small>초</small></label>
          <button type="button" className="quiet-button" disabled={rendering} onClick={() => { setYoutubePanelOpen((open) => !open); setError(""); }}>＋ YouTube 영상</button>
          <button type="button" className="quiet-button" disabled={rendering} onClick={() => imageInputRef.current?.click()}>＋ 이미지</button>
          <button type="button" className="quiet-button" disabled={rendering} onClick={() => videoInputRef.current?.click()}>영상 파일</button>
          {clip && <button type="button" className="quiet-button remove-source-button" disabled={rendering} onClick={removeVideoSource}>영상 제거</button>}
          <button type="button" className="quiet-button" disabled={rendering} onClick={() => { setVoicePanelOpen((open) => !open); setError(""); }}>AI 음성</button>
          <button type="button" className="add-caption-button" disabled={rendering} onClick={addCaption}>＋ 텍스트 추가</button>
          <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addImages} />
          <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/*" hidden onChange={importLocalVideo} />
        </div>
      </header>

      {youtubePanelOpen && (
        <form className="source-editor-panel" onSubmit={addYoutubeClip}>
          <div className="source-editor-heading"><div><span className="section-index">OPTIONAL VIDEO SOURCE</span><h3>YouTube 영상 추가</h3></div><button type="button" className="quiet-button" onClick={() => setYoutubePanelOpen(false)}>닫기</button></div>
          <label className="control-field youtube-url-control"><span>YouTube 링크</span><input type="url" required value={youtubeUrl} placeholder="https://www.youtube.com/watch?v=..." onChange={(event) => setYoutubeUrl(event.target.value)} /></label>
          <div className="source-options-row">
            <label className="control-field"><span>시작 시간</span><input type="text" inputMode="decimal" value={youtubeStart} onChange={(event) => setYoutubeStart(event.target.value)} /></label>
            <label className="control-field"><span>종료 시간</span><input type="text" inputMode="decimal" value={youtubeEnd} onChange={(event) => setYoutubeEnd(event.target.value)} /></label>
            <label className="control-field"><span>세로 화면</span><select value={youtubeMode} onChange={(event) => setYoutubeMode(event.target.value)}><option value="fill">화면 채우기 · 좌우 자르기</option><option value="fit">전체 영상 · 검은 여백</option></select></label>
            <label className="source-audio-option"><input type="checkbox" checked={includeYoutubeAudio} onChange={(event) => setIncludeYoutubeAudio(event.target.checked)} /><span>YouTube 원본 소리 포함</span></label>
            <button type="submit" className="add-caption-button" disabled={addingYoutube || rendering}>{addingYoutube ? "가져오는 중…" : "영상 추가"}</button>
          </div>
        </form>
      )}

      {voicePanelOpen && (
        <section className="voice-panel" aria-label="AI 음성 생성">
          <div className="voice-panel-heading">
            <div><span className="section-index">LOCAL OPEN MODEL</span><h3>대본에서 읽을 문장 선택</h3><p>전체 대본을 입력한 뒤, 음성으로 만들 문장만 골라 주세요.</p></div>
            <span className={`voice-status-badge ${voiceStatus?.available ? "connected" : ""}`}>{voiceStatus?.available ? (voiceStatus.model_loaded ? "로컬 모델 준비됨" : "로컬 모델 사용 가능") : voiceStatus?.platform_supported === false ? "Apple Silicon 필요" : voiceStatus ? "모델 설치 필요" : "모델 확인 중"}</span>
          </div>

          <p className="voice-language-note">Qwen3-TTS 오픈 모델이 선택한 목소리와 어투에 맞춰 한국어 음성을 만듭니다. 음성은 Apple Silicon에서 로컬로 합성되며, 이미 설치된 모델 캐시를 재사용합니다.</p>
          <div className="voice-preset-controls">
            <fieldset className="voice-preset-field" disabled={rendering || generatingVoice}>
              <legend>목소리</legend>
              <div className="voice-gender-options" role="group" aria-label="목소리 성별">
                {VOICE_GENDERS.map((preset) => (
                  <button type="button" key={preset.id} className={voiceGender === preset.id ? "selected" : ""} aria-pressed={voiceGender === preset.id} onClick={() => setVoiceGender(preset.id)}>{preset.label}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="voice-preset-field" disabled={rendering || generatingVoice}>
              <legend>어투</legend>
              <div className="voice-tone-grid" role="group" aria-label="음성 어투">
                {VOICE_TONES.map((preset) => (
                  <button type="button" key={preset.id} className={`voice-tone-option ${voiceTone === preset.id ? "selected" : ""}`} aria-pressed={voiceTone === preset.id} onClick={() => setVoiceTone(preset.id)}>
                    <strong>{preset.label}</strong><small>{preset.detail}</small>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="voice-speed-control"><label htmlFor="voice-speed">읽기 속도</label><input id="voice-speed" type="range" min="0.7" max="1.3" step="0.05" value={ttsSpeed} disabled={rendering || generatingVoice} onChange={(event) => setTtsSpeed(Number(event.target.value))} /><span>{ttsSpeed.toFixed(2)}×</span></div>

          <label className="voice-script-label" htmlFor="voice-script-text">전체 대본</label>
          <textarea id="voice-script-text" className="voice-script-text" rows="4" maxLength="20000" value={scriptText} disabled={rendering || generatingVoice} onChange={(event) => setScriptText(event.target.value)} placeholder="읽을 문장과 읽지 않을 문장을 포함해 대본을 입력하세요." />
          <div className="voice-script-actions"><span>{scriptText.length.toLocaleString()} / 20,000자</span><button type="button" className="quiet-button" disabled={rendering || !scriptText.trim() || generatingVoice} onClick={splitScript}>문장으로 나누기</button></div>

          {scriptSegments.length > 0 && (
            <div className="voice-segment-picker">
              <div className="voice-segment-heading"><strong>음성으로 만들 문장</strong><div><button type="button" className="quiet-button" disabled={rendering || generatingVoice} onClick={() => setScriptSegments((current) => current.map((segment) => ({ ...segment, selected: true })))}>모두 선택</button><button type="button" className="quiet-button" disabled={rendering || generatingVoice} onClick={() => setScriptSegments((current) => current.map((segment) => ({ ...segment, selected: false })))}>모두 해제</button></div></div>
              <div className="voice-segment-list">
                {scriptSegments.map((segment, index) => (
                  <label className="voice-segment" key={segment.id}>
                    <input type="checkbox" disabled={rendering || generatingVoice} checked={segment.selected} onChange={(event) => setScriptSegments((current) => current.map((item) => item.id === segment.id ? { ...item, selected: event.target.checked } : item))} />
                    <span className="voice-segment-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="voice-segment-text">{segment.text}</span>
                    {segment.voiceoverId && <span className="voice-generated-mark">생성됨</span>}
                  </label>
                ))}
              </div>
              <div className="voice-generate-row"><span>선택 {scriptSegments.filter((segment) => segment.selected).length}개 · 선택한 문장만 각각 음성 클립으로 만듭니다.</span><button type="button" className="add-caption-button" disabled={rendering || generatingVoice || !voiceStatus?.available || !scriptSegments.some((segment) => segment.selected)} onClick={generateSelectedVoice}>{generatingVoice ? "음성 생성 중…" : "선택 문장 음성 생성"}</button></div>
            </div>
          )}
        </section>
      )}

      {error && <div className="editor-error" role="alert">{error}</div>}

      <label className="output-title-field" htmlFor="output-video-title">
        <span>저장할 영상 제목</span>
        <input id="output-video-title" type="text" maxLength="180" value={videoTitle} disabled={rendering} onChange={(event) => setVideoTitle(event.target.value)} />
        <small>YouTube 영상은 선택 사항입니다. 입력한 제목이 MP4 파일명으로 저장됩니다.</small>
      </label>

      <div className="editor-stage">
        <section className="player-panel" aria-label="영상 미리보기">
          <div className="player-topline"><span>REMOTION PREVIEW</span><span>9:16 · 1080 × 1920 · {frameRate.toFixed(2).replace(/\.00$/, "")}fps</span></div>
          <div className="remotion-player-wrap" ref={playerWrapRef}>
            <Player
              ref={playerRef}
              component={CaptionVideo}
              inputProps={{ src: clipUrl, sourceVolume, duckSourceDuringVoiceover, captions, images: images.map((image) => ({ ...image, src: image.previewUrl })), voiceovers, selectedId, onCaptionPointerDown: beginPositionDrag, onCaptionPointerMove: movePositionDrag, onCaptionPointerUp: finishPositionDrag }}
              durationInFrames={durationInFrames}
              fps={frameRate}
              compositionWidth={1080}
              compositionHeight={1920}
              controls
              clickToPlay
              doubleClickToFullscreen
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <div className="player-hint"><span>✦</span> 이미지와 텍스트를 원하는 시점에 추가하고, 결과를 바로 확인할 수 있어요.</div>
          {clip && (
            <div className="source-audio-volume">
              <span className="source-audio-volume-heading"><strong>원본 영상 소리</strong><b>{Math.round(sourceVolume * 100)}%</b></span>
              <input aria-label="원본 영상 소리 음량" type="range" min="0" max="1" step="0.05" disabled={rendering} value={sourceVolume} onChange={(event) => {
                setSourceVolume(Number(event.target.value));
                clearRendered();
              }} />
              <small>AI 음성과 겹쳐 재생되는 원본 사운드의 음량</small>
              <label className="source-audio-ducking"><input type="checkbox" disabled={rendering} checked={duckSourceDuringVoiceover} onChange={(event) => {
                setDuckSourceDuringVoiceover(event.target.checked);
                clearRendered();
              }} /><span>AI 음성 재생 중 원본 소리 자동 낮춤</span><small>음성 구간에서 원본 음량의 20%</small></label>
            </div>
          )}
        </section>

        <aside className="caption-panel" aria-label="영상 레이어 설정">
          <div className="caption-panel-heading">
            <div><span className="section-index">TEXT LAYERS</span><h3>텍스트 레이어</h3></div>
            <div className="caption-panel-actions">
              <button type="button" className="quiet-button caption-json-button" onClick={copyCaptionSettings} disabled={captions.length === 0} title="텍스트, 시간, 스타일을 captions JSON으로 복사">
                {copiedCaptionJson === captionJson ? "복사 완료" : "JSON 복사"}
              </button>
              <button type="button" className="small-add-button" onClick={addCaption}>＋ 추가</button>
            </div>
          </div>
          {captions.length === 0 ? (
            <button type="button" className="empty-layer" onClick={addCaption}><span>＋</span><strong>첫 텍스트를 추가하세요</strong><small>시작·종료 시간을 정하고 스타일을 편집할 수 있어요.</small></button>
          ) : (
            <div className="layer-list">
              {captions.map((caption, index) => (
                <button type="button" key={caption.id} className={`layer-row ${selectedId === caption.id ? "active" : ""}`} onClick={() => selectCaption(caption)}>
                  <span className="layer-number">{String(index + 1).padStart(2, "0")}</span><span className="layer-row-text">{caption.text}</span><span className="layer-row-time">{formatTime(caption.start)}</span>
                </button>
              ))}
            </div>
          )}

          {selectedCaption && (
            <div className="caption-controls">
              <div className="inspector-section-title"><span>텍스트 내용</span><button type="button" className="delete-layer" onClick={deleteSelected}>삭제</button></div>
              <textarea aria-label="텍스트 내용" rows="2" maxLength="500" value={selectedCaption.text} onChange={(event) => updateCaption({ text: event.target.value })} />

              <div className="inspector-label-row preset-heading"><span className="inspector-label">스타일 프리셋</span><span className="inspector-unit">크기 · 색상 · 효과</span></div>
              <div className="style-presets" role="group" aria-label="텍스트 스타일 프리셋">
                {STYLE_PRESETS.map((preset) => {
                  const isActive = Object.entries(preset).filter(([key]) => key !== "id" && key !== "label" && key !== "sample")
                    .every(([key, value]) => selectedCaption[key] === value);
                  return (
                    <button type="button" key={preset.id} className={`style-preset ${isActive ? "active" : ""}`} aria-pressed={isActive} onClick={() => applyStylePreset(preset)}>
                      <span className={`preset-sample preset-${preset.id}`} style={{ color: preset.color }}>{preset.sample}</span>
                      <span className="preset-copy"><strong>{preset.label}</strong><small>{preset.fontSize}px · {preset.color}</small></span>
                    </button>
                  );
                })}
              </div>

              <div className="inspector-label-row"><span className="inspector-label">노출 시간</span><span className="inspector-unit">초</span></div>
              <div className="caption-time-inputs">
                <label><small>START</small><input type="number" min="0" max={duration} step="0.1" value={selectedCaption.start.toFixed(1)} onChange={(event) => updateTime("start", event.target.value)} /></label>
                <span>—</span>
                <label><small>END</small><input type="number" min="0" max={duration} step="0.1" value={selectedCaption.end.toFixed(1)} onChange={(event) => updateTime("end", event.target.value)} /></label>
              </div>

              <div className="inspector-label-row"><span className="inspector-label">위치 기준점</span><span className="inspector-unit">화면에서 드래그 가능</span></div>
              <div className="position-picker" role="group" aria-label="텍스트 위치">
                {POSITION_LABELS.map(([position, label, x, y]) => <button type="button" key={position} aria-label={label} title={label} className={selectedCaption.position === position ? "active" : ""} onClick={() => updateCaption({ position, positionX: x, positionY: y })}><i /></button>)}
              </div>

              <div className="style-grid">
                <label className="control-field font-select"><span>폰트</span><select value={selectedCaption.font} onChange={(event) => updateCaption({ font: event.target.value })}><option value="noto">Noto Sans KR</option><option value="black-han">Black Han Sans</option><option value="serif">Noto Serif KR</option><option value="do-hyeon">Do Hyeon · 도현체</option><option value="gowun-dodum">Gowun Dodum · 고운돋움</option><option value="gowun-batang">Gowun Batang · 고운바탕</option><option value="nanum-gothic">Nanum Gothic · 나눔고딕</option><option value="system">시스템 고딕</option></select></label>
                <label className="control-field size-control"><span>크기</span><div><input type="range" min="36" max="144" step="2" value={selectedCaption.fontSize} onChange={(event) => updateCaption({ fontSize: Number(event.target.value) })} /><b>{selectedCaption.fontSize}</b></div></label>
              </div>
              <div className="box-size-controls">
                <div className="inspector-label-row"><span className="inspector-label">텍스트박스 크기</span><span className="inspector-unit">화면 비율</span></div>
                <label className="box-size-control"><span>너비</span><input type="range" min="30" max="100" step="1" value={selectedCaption.boxWidth} onChange={(event) => updateCaption({ boxWidth: Number(event.target.value) })} /><b>{selectedCaption.boxWidth}%</b></label>
                <label className="box-size-control"><span>높이</span><input type="range" min="5" max="50" step="1" value={selectedCaption.boxHeight} onChange={(event) => updateCaption({ boxHeight: Number(event.target.value) })} /><b>{selectedCaption.boxHeight}%</b></label>
              </div>
              <div className="style-grid style-grid-bottom">
                <label className="control-field"><span>애니메이션</span><select value={selectedCaption.animation} onChange={(event) => updateCaption({ animation: event.target.value })}><option value="none">없음</option><option value="fade">페이드 인·아웃</option><option value="pop">팝업</option><option value="typewriter">타자 효과</option></select></label>
                <label className="control-field"><span>텍스트 효과</span><select value={selectedCaption.decoration} onChange={(event) => updateCaption({ decoration: event.target.value })}><option value="shadow">그림자</option><option value="outline">검은 외곽선</option><option value="box">반투명 배경</option><option value="none">없음</option></select></label>
              </div>
              <label className="color-control"><span>글자 색상</span><input type="color" value={selectedCaption.color} onChange={(event) => updateCaption({ color: event.target.value })} /><code>{selectedCaption.color.toUpperCase()}</code></label>
            </div>
          )}

          <div className="image-layer-section">
            <div className="caption-panel-heading image-layer-heading">
              <div><span className="section-index">IMAGE LAYERS</span><h3>이미지 레이어</h3></div>
              <button type="button" className="small-add-button" onClick={() => imageInputRef.current?.click()}>＋ 추가</button>
            </div>
            {images.length === 0 ? (
              <button type="button" className="empty-layer image-empty-layer" onClick={() => imageInputRef.current?.click()}><span>＋</span><strong>이미지를 원하는 시점에 추가하세요</strong><small>타임라인 재생 위치부터 기본 3초 동안 표시됩니다.</small></button>
            ) : (
              <div className="layer-list">
                {images.map((image, index) => (
                  <button type="button" key={image.id} className={`layer-row ${selectedImageId === image.id ? "active" : ""}`} onClick={() => selectImage(image)}>
                    <span className="layer-number image-layer-number">▧</span><span className="layer-row-text">{image.name || `이미지 ${index + 1}`}</span><span className="layer-row-time">{formatTime(image.start)}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedImage && (
              <div className="caption-controls image-controls">
                <div className="inspector-section-title"><span>이미지 설정</span><button type="button" className="delete-layer" disabled={rendering} onClick={deleteSelectedImage}>삭제</button></div>
                <div className="image-inspector-preview"><img src={selectedImage.previewUrl} alt={selectedImage.name || "선택한 이미지"} /></div>
                <div className="inspector-label-row"><span className="inspector-label">노출 시간</span><span className="inspector-unit">초</span></div>
                <div className="caption-time-inputs">
                  <label><small>START</small><input type="number" min="0" max={duration} step="0.1" value={selectedImage.start.toFixed(1)} onChange={(event) => {
                    const start = clamp(Number(event.target.value), 0, Math.max(0, selectedImage.end - 0.1));
                    updateImage({ start });
                  }} /></label>
                  <span>—</span>
                  <label><small>END</small><input type="number" min="0" max={duration} step="0.1" value={selectedImage.end.toFixed(1)} onChange={(event) => {
                    const end = clamp(Number(event.target.value), selectedImage.start + 0.1, duration);
                    updateImage({ end });
                  }} /></label>
                </div>
                <label className="control-field image-fit-control"><span>화면 맞춤</span><select value={selectedImage.fit} onChange={(event) => updateImage({ fit: event.target.value })}><option value="contain">전체 이미지 · 검은 여백</option><option value="cover">화면 채우기 · 가장자리 자르기</option></select></label>
              </div>
            )}
          </div>

          <div className="voiceover-layer-section">
            <div className="caption-panel-heading image-layer-heading">
              <div><span className="section-index">AI VOICE TRACK</span><h3>음성 레이어</h3></div>
              <button type="button" className="small-add-button" onClick={() => setVoicePanelOpen(true)}>＋ 대본</button>
            </div>
            {voiceovers.length === 0 ? (
              <button type="button" className="empty-layer voice-empty-layer" onClick={() => setVoicePanelOpen(true)}><span>＋</span><strong>선택한 문장으로 음성을 만드세요</strong><small>생성한 음성은 타임라인에 자동 배치됩니다.</small></button>
            ) : (
              <div className="layer-list">
                {voiceovers.map((voiceover, index) => (
                  <button type="button" key={voiceover.id} className={`layer-row ${selectedVoiceoverId === voiceover.id ? "active" : ""}`} onClick={() => selectVoiceover(voiceover)}>
                    <span className="layer-number voice-layer-number">♫</span><span className="layer-row-text">{voiceover.text}</span><span className="layer-row-time">{formatTime(voiceover.start)}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedVoiceover && (
              <div className="caption-controls voiceover-controls">
                <div className="inspector-section-title"><span>AI 음성 클립</span><button type="button" className="delete-layer" disabled={rendering || generatingVoice} onClick={deleteSelectedVoiceover}>삭제</button></div>
                <p className="voiceover-text-preview">{selectedVoiceover.text}</p>
                <audio className="voiceover-audio-preview" controls preload="metadata" src={selectedVoiceover.src} />
                <div className="inspector-label-row"><span className="inspector-label">시작 시간</span><span className="inspector-unit">초</span></div>
                <input className="voiceover-start-input" type="number" min="0" max={Math.max(0, duration - selectedVoiceover.duration)} step="0.1" disabled={rendering || generatingVoice} value={selectedVoiceover.start.toFixed(1)} onChange={(event) => {
                  const start = clamp(Number(event.target.value), 0, Math.max(0, duration - selectedVoiceover.duration));
                  setVoiceovers((current) => current.map((voiceover) => voiceover.id === selectedVoiceover.id ? { ...voiceover, start } : voiceover));
                  clearRendered();
                }} />
                <label className="voiceover-volume"><span>음량</span><input type="range" min="0" max="1" step="0.05" disabled={rendering || generatingVoice} value={selectedVoiceover.volume} onChange={(event) => {
                  const volume = Number(event.target.value);
                  setVoiceovers((current) => current.map((voiceover) => voiceover.id === selectedVoiceover.id ? { ...voiceover, volume } : voiceover));
                  clearRendered();
                }} /><b>{Math.round(selectedVoiceover.volume * 100)}%</b></label>
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className="timeline-panel" aria-label="영상, 이미지, 텍스트 타임라인">
        <div className="timeline-heading"><div><span className="section-index">EDIT TIMING</span><h3>타임라인</h3></div><div className="timeline-legend"><span><i className="video-legend" />영상/배경</span><span><i className="image-legend" />이미지</span><span><i className="text-legend" />텍스트</span><span><i className="voice-legend" />AI 음성</span><span className="timeline-clock">{formatTime(currentFrame / frameRate)} <b>/</b> {formatTime(duration)}</span></div></div>
        <div className="timeline-scroll">
          <div className="timeline-board" ref={timelineContentRef} style={{ width: `${timelineWidth}px` }} onClick={seekTimeline}>
            <div className="timeline-ruler"><div className="track-name ruler-label">시간</div><div className="track-lane ruler-lane">{rulerTicks.map((second) => <span className="ruler-tick" key={second} style={{ left: `${(second / duration) * 100}%` }}><i />{formatTime(second)}</span>)}</div></div>
            <div className="timeline-track"><div className="track-name"><span className="track-symbol film-symbol">▰</span> {clip ? "영상" : "배경"}</div><div className="track-lane video-lane">{clip ? <div className="video-clip-block" /> : <div className="blank-background-block">검은 배경 · 9:16</div>}</div></div>
            {images.map((image, index) => (
              <div className="timeline-track" key={image.id}>
                <div className="track-name"><span className="track-symbol image-symbol">▧</span> 이미지 {index + 1}</div>
                <div className="track-lane image-lane">
                  <div className={`timeline-image ${selectedImageId === image.id ? "selected" : ""}`} style={{ left: `${(image.start / duration) * 100}%`, width: `${Math.max(1.5, ((image.end - image.start) / duration) * 100)}%` }} onPointerDown={(event) => beginDrag(event, image, "move", "image")} onClick={(event) => { event.stopPropagation(); selectImage(image); }} title={`${image.name || "이미지"} · ${formatTime(image.start)}–${formatTime(image.end)}`}>
                    <span className="resize-handle left" onPointerDown={(event) => beginDrag(event, image, "start", "image")} /><span className="caption-block-label">{image.name || "이미지"}</span><span className="resize-handle right" onPointerDown={(event) => beginDrag(event, image, "end", "image")} />
                  </div>
                </div>
              </div>
            ))}
            {voiceovers.map((voiceover, index) => (
              <div className="timeline-track" key={voiceover.id}>
                <div className="track-name"><span className="track-symbol voice-symbol">♫</span> 음성 {index + 1}</div>
                <div className="track-lane voice-lane">
                  <div className={`timeline-voice ${selectedVoiceoverId === voiceover.id ? "selected" : ""}`} style={{ left: `${(voiceover.start / duration) * 100}%`, width: `${Math.max(1.5, (voiceover.duration / duration) * 100)}%` }} onPointerDown={(event) => beginDrag(event, { ...voiceover, end: voiceover.start + voiceover.duration }, "move", "voice")} onClick={(event) => { event.stopPropagation(); selectVoiceover(voiceover); }} title={`${voiceover.text} · ${formatTime(voiceover.start)} · ${voiceover.voice}`}>
                    <span className="caption-block-label">♫ {voiceover.text}</span>
                  </div>
                </div>
              </div>
            ))}
            {captions.map((caption, index) => (
              <div className="timeline-track" key={caption.id}>
                <div className="track-name"><span className="track-symbol text-symbol">T</span> 텍스트 {index + 1}</div>
                <div className="track-lane caption-lane">
                  <div className={`timeline-caption ${selectedId === caption.id ? "selected" : ""}`} style={{ left: `${(caption.start / duration) * 100}%`, width: `${Math.max(1.5, ((caption.end - caption.start) / duration) * 100)}%` }} onPointerDown={(event) => beginDrag(event, caption, "move")} onClick={(event) => { event.stopPropagation(); selectCaption(caption); }} title={`${caption.text} · ${formatTime(caption.start)}–${formatTime(caption.end)}`}>
                    <span className="resize-handle left" onPointerDown={(event) => beginDrag(event, caption, "start")} />
                    <span className="caption-block-label">{caption.text || "텍스트"}</span>
                    <span className="resize-handle right" onPointerDown={(event) => beginDrag(event, caption, "end")} />
                  </div>
                </div>
              </div>
            ))}
            {captions.length === 0 && <div className="timeline-track"><div className="track-name"><span className="track-symbol text-symbol">T</span> 텍스트</div><div className="track-lane empty-lane">텍스트를 추가하면 여기에 표시됩니다.</div></div>}
            <div className="timeline-playhead" style={{ left: `calc(98px + ${(currentFrame / durationInFrames) * Math.max(0, timelineWidth - 98)}px)` }}><span /></div>
          </div>
        </div>
        <p className="timeline-help"><span>↔</span> 영상·이미지·텍스트 막대는 길이와 위치를 조절하고, AI 음성 막대는 타임라인에서 시작 위치를 옮길 수 있습니다.</p>
      </section>

      <div className="render-footer">
        <div className="render-status" aria-live="polite">{rendering ? <><span className="render-spinner" />Remotion으로 합성 중입니다. 클립 길이에 따라 시간이 걸릴 수 있어요.</> : renderedUrl ? <><span className="render-success">✓</span> 저장 완료: {outputFilename}</> : <><span className="render-spark">✦</span> 영상·이미지·텍스트·음성 합성이 끝나면 {outputFilename} 파일로 저장합니다.</>}</div>
        <div className="render-actions">
          <SocialDistribution renderedBlob={renderedBlob} renderedUrl={renderedUrl} videoTitle={videoTitle} duration={duration} />
          {renderedUrl && <button type="button" className="quiet-button" onClick={() => downloadFile(renderedUrl, outputFilename)}>완성본 다시 받기</button>}
          <button type="button" className="render-button" onClick={exportClip} disabled={rendering || generatingVoice}>{generatingVoice ? "음성 생성 중…" : rendering ? "합성 중…" : "영상 합성 및 다운로드"}<span aria-hidden="true">↗</span></button>
        </div>
      </div>
    </div>
  );
};
