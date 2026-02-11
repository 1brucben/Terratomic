export function getMobileAttackBarBottom(): number {
  const attackBar = document.querySelector("mobile-attack-bar") as
    | (HTMLElement & { currentHeight?: number })
    | null;

  if (!attackBar) return 0;

  const knownHeight = attackBar.currentHeight ?? 0;
  if (knownHeight > 0) {
    const rect = attackBar.getBoundingClientRect();
    return rect.top + knownHeight;
  }

  const container = attackBar.shadowRoot?.querySelector(
    ".container",
  ) as HTMLElement | null;

  if (!container) {
    return 0;
  }

  if (container.children.length === 0 || container.offsetHeight <= 0) {
    return 0;
  }

  return container.getBoundingClientRect().bottom;
}

export function computeAnchoredTop(
  baseTopPx: number,
  anchorBottom: number,
  gapPx: number,
): number {
  return anchorBottom > 0
    ? Math.max(baseTopPx, anchorBottom + gapPx)
    : baseTopPx;
}

export function startRepositionInterval(
  timer: number | null,
  callback: () => void,
  intervalMs: number = 180,
): number {
  if (timer !== null) {
    window.clearInterval(timer);
  }

  return window.setInterval(callback, intervalMs);
}

export function stopRepositionInterval(timer: number | null): number | null {
  if (timer !== null) {
    window.clearInterval(timer);
  }

  return null;
}
