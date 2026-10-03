import React from "react";
import { createRoot } from "react-dom/client";
import { TimelineEditor } from "./TimelineEditor.jsx";

createRoot(document.querySelector("#timeline-editor-root")).render(<TimelineEditor />);
