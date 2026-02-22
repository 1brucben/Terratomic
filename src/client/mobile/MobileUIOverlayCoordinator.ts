type Tickable = {
  tick?: () => void;
};

export function syncTopOverlayPositions(params: {
  componentsAttached: boolean;
  topBar: HTMLElement;
  attackBar: HTMLElement & { currentHeight: number };
  chatEmojiBar: HTMLElement;
  actionGrid: HTMLElement;
}): void {
  const { componentsAttached, topBar, attackBar, chatEmojiBar, actionGrid } =
    params;

  if (!componentsAttached) {
    return;
  }

  const topBarBottom = Math.ceil(topBar.getBoundingClientRect().bottom);

  const actionGridRect = actionGrid.getBoundingClientRect();
  const actionGridVisible =
    actionGrid.hasAttribute("visible") &&
    actionGridRect.top < window.innerHeight;
  const actionGridHeight = actionGridVisible
    ? Math.max(0, window.innerHeight - actionGridRect.top)
    : 0;

  const baseBottomPx = 8;
  const gapAboveGridPx = 0;
  const attackBarBottomPx =
    baseBottomPx +
    (actionGridHeight > 0 ? Math.ceil(actionGridHeight + gapAboveGridPx) : 0);

  attackBar.style.top = "auto";
  attackBar.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${attackBarBottomPx}px)`;

  chatEmojiBar.style.top = `${topBarBottom + 8}px`;
}

function safeTick(component: Tickable | null | undefined): void {
  if (component && typeof component.tick === "function") {
    component.tick();
  }
}

export function tickOverlayComponents(params: {
  eventsDisplay: Tickable;
  attackBar: Tickable & { currentHeight: number };
  chatEmojiBar: Tickable;
  winModal: Tickable;
  allianceNotifications: (Tickable & { topOffset: number }) | null;
}): void {
  const {
    eventsDisplay,
    attackBar,
    chatEmojiBar,
    winModal,
    allianceNotifications,
  } = params;

  safeTick(eventsDisplay);
  safeTick(attackBar);
  safeTick(chatEmojiBar);
  safeTick(winModal);

  if (
    allianceNotifications &&
    typeof allianceNotifications.tick === "function"
  ) {
    allianceNotifications.tick();
    allianceNotifications.topOffset = attackBar.currentHeight;
  }
}
