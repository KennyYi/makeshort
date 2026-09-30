import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { CaptionVideo } from "./remotion/CaptionVideo.jsx";

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

const createCaption = (duration) => ({
  id: crypto.randomUUID().replaceAll("-", ""),
  text: "새로운 텍스트",
  start: 0,
  end: Math.min(3.5, duration),
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const formatTime = (seconds) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}.${tenths}`;
};

const encodeProps = (props) => {
  const bytes = new TextEncoder().encode(JSON.stringify(props));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
};

export const TimelineEditor = () => {
  const [clip, setClip] = useState(null);
  const [clipUrl, setClipUrl] = useState("");
  const [clipName, setClipName] = useState("");
  const [duration, setDuration] = useState(0);
  const [frameRate, setFrameRate] = useState(DEFAULT_FPS);
  const [captions, setCaptions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [renderedUrl, setRenderedUrl] = useState("");
  const playerRef = useRef(null);
  const playerWrapRef = useRef(null);
  const timelineContentRef = useRef(null);
  const dragRef = useRef(null);

  const durationInFrames = Math.max(1, Math.ceil(duration * frameRate));
  const selectedCaption = captions.find((caption) => caption.id === selectedId) ?? null;
  const timelineWidth = Math.max(720, duration * 28);
  const rulerTicks = useMemo(() => {
    const ticks = [];
    for (let second = 0; second <= duration; second += 5) ticks.push(second);
    if (duration > 0 && (!ticks.length || duration - ticks[ticks.length - 1] > 1)) ticks.push(duration);
    return ticks;
  }, [duration]);

  const acceptClip = useCallback((detail) => {
    if (!detail?.blob || !Number.isFinite(detail.duration) || detail.duration <= 0) return;
    setClip(detail.blob);
    setClipUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(detail.blob);
    });
    setClipName(detail.name || "클립");
    setDuration(detail.duration);
    setFrameRate(Number.isFinite(detail.fps) && detail.fps >= 1 && detail.fps <= 120 ? detail.fps : DEFAULT_FPS);
    setCaptions([]);
    setSelectedId(null);
    setCurrentFrame(0);
    setError("");
    setRenderedUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    document.querySelector(".hero").hidden = true;
    document.querySelector(".workspace").hidden = true;
    document.querySelector("#timeline-editor-root").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const onClipReady = useCallback((event) => acceptClip(event.detail), [acceptClip]);

  useEffect(() => {
    window.addEventListener("makeshort:clip-ready", onClipReady);
    return () => window.removeEventListener("makeshort:clip-ready", onClipReady);
  }, [onClipReady]);

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
      const boardWidth = board.getBoundingClientRect().width;
      const delta = ((event.clientX - drag.pointerX) / boardWidth) * duration;
      setCaptions((current) => current.map((caption) => {
        if (caption.id !== drag.id) return caption;
        const span = drag.end - drag.start;
        if (drag.mode === "move") {
          const start = clamp(drag.start + delta, 0, Math.max(0, duration - span));
          return { ...caption, start, end: start + span };
        }
        if (drag.mode === "start") {
          return { ...caption, start: clamp(drag.start + delta, 0, drag.end - 0.1) };
        }
        return { ...caption, end: clamp(drag.end + delta, drag.start + 0.1, duration) };
      }));
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
  };

  const updateCaption = (patch) => {
    if (!selectedId) return;
    setCaptions((current) => current.map((caption) => caption.id === selectedId ? { ...caption, ...patch } : caption));
    clearRendered();
  };

  const applyStylePreset = (preset) => {
    const { font, fontSize, color, animation, decoration } = preset;
    updateCaption({ font, fontSize, color, animation, decoration });
  };

  const addCaption = () => {
    const caption = createCaption(duration);
    setCaptions((current) => [...current, caption]);
    selectCaption(caption);
    setError("");
    setRenderedUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setCaptions((current) => current.filter((caption) => caption.id !== selectedId));
    setSelectedId(null);
    setRenderedUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
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

  const beginDrag = (event, caption, mode) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(caption.id);
    clearRendered();
    dragRef.current = {
      id: caption.id,
      mode,
      pointerX: event.clientX,
      start: caption.start,
      end: caption.end,
    };
  };

  const beginPositionDrag = (event, caption) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(caption.id);
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
  };

  const finishPositionDrag = () => {
    if (dragRef.current?.mode === "position") dragRef.current = null;
  };

  const selectCaption = (caption) => {
    setSelectedId(caption.id);
    const time = currentFrame / frameRate;
    if (time < caption.start || time >= caption.end || time - caption.start < 0.2) {
      const previewTime = caption.start + Math.min(0.25, (caption.end - caption.start) / 2);
      const targetFrame = Math.min(Math.ceil(caption.end * frameRate) - 1, Math.round(previewTime * frameRate));
      playerRef.current?.seekTo(Math.max(0, targetFrame));
      setCurrentFrame(Math.max(0, targetFrame));
    }
  };

  const seekTimeline = (event) => {
    if (event.target.closest(".timeline-caption")) return;
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
    if (captions.length === 0) {
      setError("먼저 타임라인에 텍스트 레이어를 추가해 주세요.");
      return;
    }
    setRendering(true);
    try {
      const props = {
        fps: frameRate,
        durationInFrames,
        captions: captions.map(({ id, text, start, end, boxWidth, boxHeight, position, positionX, positionY, font, fontSize, color, animation, decoration }) => ({
          id, text, start, end, boxWidth, boxHeight, position, positionX, positionY, font, fontSize, color, animation, decoration,
        })),
      };
      const response = await fetch("/api/render", {
        method: "POST",
        headers: {
          "Content-Type": "video/mp4",
          "X-Makeshort-Props": encodeProps(props),
        },
        body: clip,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Remotion 합성에 실패했습니다.");
      }
      const output = await response.blob();
      const outputUrl = URL.createObjectURL(output);
      setRenderedUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return outputUrl;
      });
      const anchor = document.createElement("a");
      anchor.href = outputUrl;
      anchor.download = "makeshort_captioned_clip.mp4";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : "합성에 실패했습니다.");
    } finally {
      setRendering(false);
    }
  };

  const downloadSource = () => {
    if (!clipUrl) return;
    const anchor = document.createElement("a");
    anchor.href = clipUrl;
    anchor.download = clipName.replace(/\.[^.]+$/, "") + ".mp4";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  const resetEditor = () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    setClip(null);
    setClipUrl("");
    setRenderedUrl("");
    setCaptions([]);
    setSelectedId(null);
    setDuration(0);
    setFrameRate(DEFAULT_FPS);
    setError("");
    document.querySelector("#clip-form").reset();
    document.querySelector("#import-clip-input").value = "";
    document.querySelector("#timeline-editor-root").hidden = true;
    document.querySelector(".workspace").hidden = false;
    document.querySelector(".hero").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!clip) return null;

  return (
    <div className="video-editor">
      <header className="video-editor-header">
        <div className="editor-title-wrap">
          <button type="button" className="back-button" onClick={resetEditor} aria-label="다른 영상 선택">←</button>
          <div><span className="section-index">TEXT & TIMELINE</span><h2>자막과 텍스트 편집</h2><p>{clipName} <span>·</span> {formatTime(duration)}</p></div>
        </div>
        <div className="editor-header-actions">
          <button type="button" className="quiet-button" onClick={downloadSource}>원본 클립 다운로드</button>
          <button type="button" className="add-caption-button" onClick={addCaption}>＋ 텍스트 추가</button>
        </div>
      </header>

      <div className="editor-stage">
        <section className="player-panel" aria-label="영상 미리보기">
          <div className="player-topline"><span>REMOTION PREVIEW</span><span>9:16 · 1080 × 1920 · {frameRate.toFixed(2).replace(/\.00$/, "")}fps</span></div>
          <div className="remotion-player-wrap" ref={playerWrapRef}>
            <Player
              ref={playerRef}
              component={CaptionVideo}
              inputProps={{ src: clipUrl, captions, selectedId, onCaptionPointerDown: beginPositionDrag, onCaptionPointerMove: movePositionDrag, onCaptionPointerUp: finishPositionDrag }}
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
          <div className="player-hint"><span>✦</span> 텍스트 설정과 타임라인 변경이 미리보기에 바로 반영됩니다.</div>
        </section>

        <aside className="caption-panel" aria-label="텍스트 레이어 설정">
          <div className="caption-panel-heading"><div><span className="section-index">TEXT LAYERS</span><h3>텍스트 레이어</h3></div><button type="button" className="small-add-button" onClick={addCaption}>＋ 추가</button></div>
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
                <label className="control-field font-select"><span>폰트</span><select value={selectedCaption.font} onChange={(event) => updateCaption({ font: event.target.value })}><option value="noto">Noto Sans KR</option><option value="black-han">Black Han Sans</option><option value="serif">Noto Serif KR</option><option value="system">시스템 고딕</option></select></label>
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
        </aside>
      </div>

      <section className="timeline-panel" aria-label="텍스트 타임라인">
        <div className="timeline-heading"><div><span className="section-index">EDIT TIMING</span><h3>타임라인</h3></div><div className="timeline-legend"><span><i className="video-legend" />영상</span><span><i className="text-legend" />텍스트</span><span className="timeline-clock">{formatTime(currentFrame / frameRate)} <b>/</b> {formatTime(duration)}</span></div></div>
        <div className="timeline-scroll">
          <div className="timeline-board" ref={timelineContentRef} style={{ width: `${timelineWidth}px` }} onClick={seekTimeline}>
            <div className="timeline-ruler"><div className="track-name ruler-label">시간</div><div className="track-lane ruler-lane">{rulerTicks.map((second) => <span className="ruler-tick" key={second} style={{ left: `${(second / duration) * 100}%` }}><i />{formatTime(second)}</span>)}</div></div>
            <div className="timeline-track"><div className="track-name"><span className="track-symbol film-symbol">▰</span> 영상</div><div className="track-lane video-lane"><div className="video-clip-block" /></div></div>
            {captions.map((caption, index) => (
              <div className="timeline-track" key={caption.id}>
                <div className="track-name"><span className="track-symbol text-symbol">T</span> 텍스트 {index + 1}</div>
                <div className="track-lane caption-lane">
                  <div className={`timeline-caption ${selectedId === caption.id ? "selected" : ""}`} style={{ left: `${(caption.start / duration) * 100}%`, width: `${Math.max(1.5, ((caption.end - caption.start) / duration) * 100)}%` }} onPointerDown={(event) => beginDrag(event, caption, "move")} onClick={(event) => { event.stopPropagation(); setSelectedId(caption.id); }} title={`${caption.text} · ${formatTime(caption.start)}–${formatTime(caption.end)}`}>
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
        <p className="timeline-help"><span>↔</span> 미리보기의 자막을 드래그해 위치를 미세 조정하세요. 타임라인에서는 텍스트 막대를 옮기거나 양쪽 끝을 끌어 노출 시간을 바꿀 수 있어요.</p>
      </section>

      <div className="render-footer">
        <div className="render-status" aria-live="polite">{rendering ? <><span className="render-spinner" />Remotion으로 합성 중입니다. 클립 길이에 따라 시간이 걸릴 수 있어요.</> : renderedUrl ? <><span className="render-success">✓</span> 합성이 끝났습니다. 완성본을 다운로드할 수 있어요.</> : <><span className="render-spark">✦</span> 미리보기 내용을 Remotion으로 합성해 MP4로 저장합니다.</>}</div>
        <div className="render-actions">
          {renderedUrl && <button type="button" className="quiet-button" onClick={() => { const a = document.createElement("a"); a.href = renderedUrl; a.download = "makeshort_captioned_clip.mp4"; a.click(); }}>완성본 다시 받기</button>}
          <button type="button" className="render-button" onClick={exportClip} disabled={rendering}>{rendering ? "합성 중…" : "텍스트 합성 및 다운로드"}<span aria-hidden="true">↗</span></button>
        </div>
      </div>
      {error && <div className="editor-error" role="alert">{error}</div>}
    </div>
  );
};
