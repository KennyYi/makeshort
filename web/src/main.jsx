import React from "react";
import { createRoot } from "react-dom/client";
import "./form.js";
import { TimelineEditor } from "./TimelineEditor.jsx";

createRoot(document.querySelector("#timeline-editor-root")).render(<TimelineEditor />);
