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

/**
 * Apply a baseline UI scale based on the player's current resolution.
 * Uses 1920x1080 as reference and adjusts proportionally within sane bounds.
 * Exposes values via CSS variables:
 *  - --resolution-scale: pure resolution factor
 *  - --ui-scale-base: multiplicative base for `.ui-scale-surface`
 *  - --ui-panel-zoom: default panel zoom (replaces hardcoded 0.9)
 */
export const initializeResolutionScale = () => {
  if (!isDomAvailable()) return;

  const root = document.documentElement;
  if (!root) return;

  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));

  const update = () => {
    const w =
      (window.screen && window.screen.width) || window.innerWidth || 1280;
    const h =
      (window.screen && window.screen.height) || window.innerHeight || 800;
    const resScale = clamp(Math.min(w / 1280, h / 800), 0.75, 1.25);
    const panelZoom = clamp(0.9 * resScale, 0.7, 1.2);

    // Debug: log the computed resolution scale
    console.log("w", w, "h", h);
    console.log("resScale", resScale);

    root.style.setProperty("--resolution-scale", resScale.toString());
    root.style.setProperty("--ui-scale-base", resScale.toString());
    root.style.setProperty("--ui-panel-zoom", panelZoom.toString());
  };

  update();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update as EventListener);
};
