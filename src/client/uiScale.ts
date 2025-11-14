const isDomAvailable = () =>
  typeof window !== "undefined" && typeof document !== "undefined";

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
