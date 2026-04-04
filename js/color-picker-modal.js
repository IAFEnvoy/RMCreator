import {
  clamp,
  escapeHtml,
  formatColorWithAlpha,
  mergeColorAndAlpha,
  normalizeColor,
  splitColorAndAlpha
} from "./utils.js";

const historyStorageKey = "rmcreator.colorHistory.v1";
const maxHistoryItems = 12;

export function createColorPickerModal({ elements }) {
  const {
    colorPickerModal,
    closeColorPickerBtn,
    colorPickerInput,
    colorPickerAlpha,
    colorPickerAlphaNumber,
    colorPickerPreview,
    colorPickerHistoryList,
    colorPickerCancelBtn,
    colorPickerConfirmBtn,
    colorPickerTitle,
    colorPickerValue
  } = elements;

  if (!colorPickerModal) {
    return {
      open: () => { }
    };
  }

  let currentColor = "#2f5d9dff";
  let onConfirm = null;

  const readHistory = () => {
    try {
      const raw = localStorage.getItem(historyStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeHistory = (colors) => {
    try {
      localStorage.setItem(historyStorageKey, JSON.stringify(colors));
    } catch {
      // Ignore storage errors.
    }
  };

  const formatColorLabel = (color) => formatColorWithAlpha(color);

  const renderHistory = () => {
    if (!colorPickerHistoryList) {
      return;
    }

    const history = readHistory();
    colorPickerHistoryList.innerHTML = history.length
      ? ""
      : "<div class=\"kv\">暂无历史记录。</div>";

    history.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-history-item";
      button.setAttribute("data-color", color);
      button.innerHTML = `
        <span class="color-history-swatch" style="--swatch-color:${escapeHtml(color)}"></span>
        <span class="color-history-label">${escapeHtml(formatColorLabel(color))}</span>
      `;
      button.addEventListener("click", () => {
        setColor(color);
      });
      colorPickerHistoryList.appendChild(button);
    });
  };

  const setColor = (color) => {
    const normalized = normalizeColor(color);
    const parsed = splitColorAndAlpha(normalized);
    colorPickerInput.value = parsed.hex;
    const alphaPercent = Math.round(parsed.alpha * 100);
    colorPickerAlpha.value = String(alphaPercent);
    colorPickerAlphaNumber.value = String(alphaPercent);
    updatePreview();
  };

  const updatePreview = () => {
    const alphaPercent = clamp(Number(colorPickerAlpha.value) || 0, 0, 100);
    const alpha = alphaPercent / 100;
    const merged = mergeColorAndAlpha(colorPickerInput.value, alpha);
    currentColor = merged;
    if (colorPickerPreview) {
      colorPickerPreview.style.setProperty("--swatch-color", merged);
    }
    if (colorPickerValue) {
      colorPickerValue.textContent = formatColorLabel(merged);
    }
  };

  const open = ({ color, title, onConfirm: onConfirmCb } = {}) => {
    colorPickerModal.hidden = false;
    if (colorPickerTitle && title) {
      colorPickerTitle.textContent = String(title || "颜色选择");
    }
    onConfirm = typeof onConfirmCb === "function" ? onConfirmCb : null;
    setColor(color || "#2f5d9dff");
    renderHistory();
  };

  const close = () => {
    colorPickerModal.hidden = true;
    onConfirm = null;
  };

  const confirm = () => {
    const history = readHistory();
    const normalized = normalizeColor(currentColor);
    const nextHistory = [normalized, ...history.filter((item) => item !== normalized)].slice(0, maxHistoryItems);
    writeHistory(nextHistory);
    onConfirm?.(normalized);
    close();
  };

  const syncAlphaFromNumber = () => {
    const alpha = clamp(Number(colorPickerAlphaNumber.value) || 0, 0, 100);
    colorPickerAlphaNumber.value = String(alpha);
    colorPickerAlpha.value = String(alpha);
    updatePreview();
  };

  const syncAlphaFromRange = () => {
    const alpha = clamp(Number(colorPickerAlpha.value) || 0, 0, 100);
    colorPickerAlpha.value = String(alpha);
    colorPickerAlphaNumber.value = String(alpha);
    updatePreview();
  };

  closeColorPickerBtn?.addEventListener("click", close);
  colorPickerCancelBtn?.addEventListener("click", close);
  colorPickerConfirmBtn?.addEventListener("click", confirm);

  colorPickerInput.addEventListener("input", updatePreview);
  colorPickerAlpha.addEventListener("input", syncAlphaFromRange);
  colorPickerAlphaNumber.addEventListener("input", syncAlphaFromNumber);
  colorPickerAlphaNumber.addEventListener("change", syncAlphaFromNumber);

  return {
    open,
    close
  };
}
