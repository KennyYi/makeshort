import React from "react";
import { Composition } from "remotion";
import { CaptionVideo } from "./CaptionVideo";

export const RemotionRoot = () => (
  <Composition
    id="CaptionedClip"
    component={CaptionVideo}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={90}
    defaultProps={{ src: "", captions: [], selectedId: null }}
  />
);
