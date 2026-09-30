const form = document.querySelector("#clip-form");
const urlInput = document.querySelector("#youtube-url");
const startInput = document.querySelector("#start-time");
const endInput = document.querySelector("#end-time");
const createButton = document.querySelector("#create-button");
const errorBox = document.querySelector("#form-error");
const previewScreen = document.querySelector("#preview-screen");
const pasteButton = document.querySelector("#paste-button");
const importButton = document.querySelector("#import-clip-button");
const importInput = document.querySelector("#import-clip-input");

function selectedMode() {
  return document.querySelector('input[name="mode"]:checked')?.value ?? "fill";
}

function updateModePreview() {
  document.querySelectorAll(".mode-card").forEach((card) => {
    const input = card.querySelector("input");
    card.classList.toggle("selected", input.checked);
  });
  previewScreen.classList.toggle("fit-preview", selectedMode() === "fit");
  previewScreen.classList.toggle("fill-preview", selectedMode() === "fill");
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

function setBusy(busy) {
  createButton.disabled = busy;
  createButton.querySelector(".button-label").textContent = busy ? "클립을 만들고 있어요…" : "세로 클립 만들기";
  createButton.querySelector(".button-arrow").textContent = busy ? "⋯" : "↗";
}

function parseClientTime(raw) {
  const value = raw.trim();
  if (!value) return NaN;
  if (!value.includes(":")) return Number(value);
  const parts = value.split(":");
  if (parts.length !== 2 && parts.length !== 3) return NaN;
  const numbers = parts.map(Number);
  if (numbers.some((number) => !Number.isFinite(number) || number < 0)) return NaN;
  if (numbers.length === 2) {
    if (numbers[1] >= 60) return NaN;
    return numbers[0] * 60 + numbers[1];
  }
  if (numbers[1] >= 60 || numbers[2] >= 60) return NaN;
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

function openTimeline(blob, duration, name, fps = 30) {
  window.dispatchEvent(new CustomEvent("makeshort:clip-ready", {
    detail: { blob, duration, name, fps },
  }));
}

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", updateModePreview);
});

pasteButton.addEventListener("click", async () => {
  try {
    urlInput.value = await navigator.clipboard.readText();
    urlInput.focus();
  } catch {
    showError("클립보드에 접근할 수 없어요. 링크를 직접 붙여넣어 주세요.");
  }
});

importButton.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", () => {
  const file = importInput.files?.[0];
  if (!file) return;
  clearError();
  if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v)$/i.test(file.name)) {
    showError("MP4 또는 MOV 영상 파일을 선택해 주세요.");
    importInput.value = "";
    return;
  }
  const probeUrl = URL.createObjectURL(file);
  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.onloadedmetadata = () => {
    URL.revokeObjectURL(probeUrl);
    if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
      showError("영상 길이를 확인할 수 없습니다.");
      return;
    }
    openTimeline(file, probe.duration, file.name);
  };
  probe.onerror = () => {
    URL.revokeObjectURL(probeUrl);
    showError("이 영상 파일을 열 수 없습니다.");
  };
  probe.src = probeUrl;
});

form.addEventListener("input", clearError);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  const start = parseClientTime(startInput.value);
  const end = parseClientTime(endInput.value);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    showError("시간을 초 또는 MM:SS 형식으로 입력해 주세요.");
    return;
  }
  if (end <= start) {
    showError("종료 시간은 시작 시간보다 뒤여야 해요.");
    return;
  }

  setBusy(true);
  try {
    const response = await fetch("/api/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: urlInput.value.trim(),
        start: startInput.value.trim(),
        end: endInput.value.trim(),
        mode: selectedMode(),
      }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "클립을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    const fps = Number(response.headers.get("X-Makeshort-FPS")) || 30;
    openTimeline(await response.blob(), end - start, "YouTube 클립", fps);
  } catch (error) {
    showError(error instanceof Error ? error.message : "클립을 만들지 못했어요.");
  } finally {
    setBusy(false);
  }
});

updateModePreview();
