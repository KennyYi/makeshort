import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import "./fonts.css";

const POSITION = {
  "top-left": [5, 5, 0, 0, "left"], "top-center": [50, 5, 0.5, 0, "center"], "top-right": [95, 5, 1, 0, "right"],
  "middle-left": [5, 50, 0, 0.5, "left"], "middle-center": [50, 50, 0.5, 0.5, "center"], "middle-right": [95, 50, 1, 0.5, "right"],
  "bottom-left": [5, 95, 0, 1, "left"], "bottom-center": [50, 95, 0.5, 1, "center"], "bottom-right": [95, 95, 1, 1, "right"],
};

const FONT = {
  noto: '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
  "black-han": '"Black Han Sans", "Apple SD Gothic Neo", sans-serif',
  serif: '"Noto Serif KR", "AppleMyungjo", serif',
  "do-hyeon": '"Do Hyeon", "Apple SD Gothic Neo", sans-serif',
  "gowun-dodum": '"Gowun Dodum", "Apple SD Gothic Neo", sans-serif',
  "gowun-batang": '"Gowun Batang", "AppleMyungjo", serif',
  "nanum-gothic": '"Nanum Gothic", "Apple SD Gothic Neo", sans-serif',
  system: '"Apple SD Gothic Neo", sans-serif',
};

const getSourceVolumeAtFrame = (frame, fps, voiceovers, duckEnabled) => {
  if (!duckEnabled || voiceovers.length === 0) return 1;
  const defaultFadeFrames = Math.max(1, Math.round(fps * 0.15));
  return voiceovers.reduce((volume, voiceover) => {
    const start = Math.max(0, Math.round(voiceover.start * fps));
    const end = Math.max(start + 1, Math.ceil((voiceover.start + voiceover.duration) * fps));
    const fadeFrames = Math.min(defaultFadeFrames, Math.max(1, Math.floor((end - start) / 2)));
    const fadeOutStart = Math.max(start, end - fadeFrames);
    if (frame < start || frame >= end) return volume;
    let voiceVolume = 1;
    if (frame < start + fadeFrames) {
      voiceVolume = interpolate(frame, [start, start + fadeFrames], [1, 0.2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    } else if (frame < end) {
      voiceVolume = frame < fadeOutStart
        ? 0.2
        : interpolate(frame, [fadeOutStart, end], [0.2, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    }
    return Math.min(volume, voiceVolume);
  }, 1);
};

const Decoration = ({ kind, children }) => {
  const style = {
    shadow: { textShadow: "0 5px 20px rgba(0,0,0,.8)" },
    outline: { WebkitTextStroke: "2px rgba(0,0,0,.9)", textShadow: "0 3px 8px rgba(0,0,0,.7)" },
    box: {},
    none: {},
  }[kind] ?? {};
  return <div style={style}>{children}</div>;
};

const Caption = ({ caption, selectedId, onPointerDown, onPointerMove, onPointerUp }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationFrames = Math.max(1, Math.round((caption.end - caption.start) * fps));
  const [x, y, anchorX, anchorY, align] = POSITION[caption.position] ?? POSITION["bottom-center"];
  const positionX = caption.positionX ?? x;
  const positionY = caption.positionY ?? y;
  let opacity = 1;
  let scale = 1;
  let text = caption.text;

  if (caption.animation === "fade") {
    const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const fadeOutAt = Math.max(0, durationFrames - 8);
    const fadeOut = interpolate(frame, [fadeOutAt, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    opacity = Math.min(fadeIn, fadeOut);
  } else if (caption.animation === "pop") {
    const progress = spring({ frame, fps, config: { damping: 14, stiffness: 170, mass: 0.7 } });
    scale = 0.72 + progress * 0.28;
    opacity = interpolate(frame, [0, 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  } else if (caption.animation === "typewriter") {
    text = caption.text.slice(0, Math.min(caption.text.length, Math.ceil(frame * 1.6)));
  }

  const isSelected = selectedId === caption.id;
  return (
    <div
      style={{
        position: "absolute",
        left: `${positionX}%`,
        top: `${positionY}%`,
        transform: `translate(${-anchorX * 100}%, ${-anchorY * 100}%) scale(${scale})`,
        width: `${caption.boxWidth ?? 84}%`,
        height: `${caption.boxHeight ?? 10}%`,
        display: "flex",
        alignItems: "center",
        justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
        boxSizing: "border-box",
        overflow: "hidden",
        borderRadius: caption.decoration === "box" ? 12 : 0,
        backgroundColor: caption.decoration === "box" ? "rgba(0,0,0,.66)" : "transparent",
        opacity,
        color: caption.color,
        fontFamily: FONT[caption.font] ?? FONT.noto,
        fontSize: caption.fontSize,
        lineHeight: 1.22,
        fontWeight: 800,
        textAlign: align,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        ...(isSelected ? { outline: "2px dashed rgba(189,220,78,.9)", outlineOffset: 8 } : {}),
        ...(onPointerDown ? { cursor: "grab", touchAction: "none", userSelect: "none" } : {}),
      }}
      onPointerDown={onPointerDown ? (event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onPointerDown(event, caption);
      } : undefined}
      onPointerMove={onPointerMove ? (event) => onPointerMove(event, caption) : undefined}
      onPointerUp={onPointerUp ? onPointerUp : undefined}
      onPointerCancel={onPointerUp ? onPointerUp : undefined}
    >
      <Decoration kind={caption.decoration}>{text}</Decoration>
    </div>
  );
};

export const CaptionVideo = ({ src, sourceVolume = 1, duckSourceDuringVoiceover = true, captions = [], images = [], voiceovers = [], selectedId = null, onCaptionPointerDown, onCaptionPointerMove, onCaptionPointerUp }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const visibleCaptions = captions.filter((caption) => {
    if (!caption.voiceoverId) return true;
    const voiceover = voiceovers.find((item) => item.id === caption.voiceoverId);
    return voiceover?.captionEnabled !== false;
  });
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {src ? <OffthreadVideo src={src} volume={(frame) => sourceVolume * getSourceVolumeAtFrame(frame, fps, voiceovers, duckSourceDuringVoiceover)} style={{ width: "100%", height: "100%", objectFit: "fill" }} /> : null}
      {images.map((image) => {
        const from = Math.max(0, Math.round(image.start * fps));
        const end = Math.min(durationInFrames, Math.round(image.end * fps));
        const duration = Math.max(1, end - from);
        return (
          <Sequence key={image.id} from={from} durationInFrames={duration}>
            <Img src={image.src} style={{ width: "100%", height: "100%", objectFit: image.fit === "cover" ? "cover" : "contain" }} />
          </Sequence>
        );
      })}
      {voiceovers.map((voiceover) => {
        const from = Math.max(0, Math.round(voiceover.start * fps));
        const duration = Math.max(1, Math.ceil(voiceover.duration * fps));
        return (
          <Sequence key={voiceover.id} from={from} durationInFrames={duration}>
            <Audio src={voiceover.src} volume={voiceover.volume ?? 1} />
          </Sequence>
        );
      })}
      {visibleCaptions.map((caption) => {
        const from = Math.max(0, Math.round(caption.start * fps));
        const end = Math.min(durationInFrames, Math.round(caption.end * fps));
        const duration = Math.max(1, end - from);
        return (
          <Sequence key={caption.id} from={from} durationInFrames={duration}>
            <Caption
              caption={caption}
              selectedId={selectedId}
              onPointerDown={onCaptionPointerDown}
              onPointerMove={onCaptionPointerMove}
              onPointerUp={onCaptionPointerUp}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
