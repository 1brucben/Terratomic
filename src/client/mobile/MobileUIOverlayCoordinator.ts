type Tickable = {
  tick?: () => void;
};

export function syncTopOverlayPositions(params: {
  componentsAttached: boolean;
  topBar: HTMLElement;
  attackBar: HTMLElement & { currentHeight: number };
  chatEmojiBar: HTMLElement;
}): void {
  const { componentsAttached, topBar, attackBar, chatEmojiBar } = params;

  if (!componentsAttached) {
    return;
  }

  const topBarBottom = Math.ceil(topBar.getBoundingClientRect().bottom);
  attackBar.style.top = `${topBarBottom + 2}px`;
  chatEmojiBar.style.top = `${topBarBottom + attackBar.currentHeight + 8}px`;
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
