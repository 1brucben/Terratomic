const UI_SCALE_STORAGE_KEY = "settings.uiScale";
export const UI_SCALE_CHANGED_EVENT = "ui-scale-changed";

export const UI_SCALE_MIN_PERCENT = 75;
export const UI_SCALE_MAX_PERCENT = 150;
export const UI_SCALE_DEFAULT_PERCENT = 100;
export const UI_SCALE_STEP_PERCENT = 5;

const isDomAvailable = () =>
  typeof window !== "undefined" && typeof document !== "undefined";

export const clampUiScalePercent = (percent: number) =>
  Math.min(UI_SCALE_MAX_PERCENT, Math.max(UI_SCALE_MIN_PERCENT, percent));

const percentToScale = (percent: number) => percent / 100;

export const getStoredUiScalePercent = () => {
  if (!isDomAvailable()) return UI_SCALE_DEFAULT_PERCENT;
  const raw = window.localStorage.getItem(UI_SCALE_STORAGE_KEY);
  if (raw === null) return UI_SCALE_DEFAULT_PERCENT;

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) return UI_SCALE_DEFAULT_PERCENT;

  const percent = Math.round(parsed * 100);
  return clampUiScalePercent(percent);
};

export const saveUiScalePercent = (percent: number) => {
  if (!isDomAvailable()) return;
  const clamped = clampUiScalePercent(percent);
  window.localStorage.setItem(
    UI_SCALE_STORAGE_KEY,
    percentToScale(clamped).toString(),
  );
};

export const applyUiScalePercent = (percent: number) => {
  if (!isDomAvailable()) return;

  const clamped = clampUiScalePercent(percent);
  const scale = percentToScale(clamped);
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return;

  root.style.setProperty("--ui-scale", scale.toString());
  root.setAttribute("data-ui-scale", String(clamped));
  body.dataset.uiScale = String(clamped);

  (body.style as CSSStyleDeclaration & { zoom?: string }).zoom = "";
  root.style.setProperty("--ui-scale-font-size", `${scale * 100}%`);
  root.style.fontSize = `var(--ui-scale-font-size)`;

  window.dispatchEvent(
    new CustomEvent(UI_SCALE_CHANGED_EVENT, { detail: { percent: clamped } }),
  );
};

export const adjustUiScalePercent = (currentPercent: number, delta: number) =>
  clampUiScalePercent(currentPercent + delta);

export const initializeUiScaleFromStorage = () => {
  if (!isDomAvailable()) return;
  const applyStoredScale = () => applyUiScalePercent(getStoredUiScalePercent());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyStoredScale, {
      once: true,
    });
  } else {
    applyStoredScale();
  }
};
