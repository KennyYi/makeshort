import React from "react";
import { createRoot } from "react-dom/client";
import { TimelineEditor } from "./TimelineEditor.jsx";
import { applyDocumentLocale } from "./i18n.js";

applyDocumentLocale();
createRoot(document.querySelector("#timeline-editor-root")).render(<TimelineEditor />);
