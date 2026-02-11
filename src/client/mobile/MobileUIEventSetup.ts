import type { PlayerView } from "../../core/game/GameView";
import {
  bindOpenHandlers,
  bindPointerDownHandler,
} from "./MobileUIEventBindings";

type EconomyOverlayLike = HTMLElement & {
  open: () => void;
};

type SidebarLike = {
  open: () => void;
};

type PlayerToastLike = HTMLElement;

type ActionGridLike = HTMLElement;

export function setupMobileUIEventListeners(params: {
  topBar: HTMLElement;
  economyOverlay: EconomyOverlayLike;
  intelSidebar: SidebarLike;
  researchSidebar: SidebarLike;
  playerToast: PlayerToastLike;
  actionGrid: ActionGridLike;
  economyTab: HTMLButtonElement;
  intelTab: HTMLButtonElement;
  researchTab: HTMLButtonElement;
  zoomInButton: HTMLButtonElement;
  zoomCenterButton: HTMLButtonElement;
  zoomOutButton: HTMLButtonElement;
  onSettingsClick: () => void;
  onZoomIn: () => void;
  onZoomCenter: () => void;
  onZoomOut: () => void;
  onAttackRatioChanged: (ratio: number) => void;
  onPlayerChatClicked: (player: PlayerView) => void;
  onPlayerEmojiClicked: (player: PlayerView) => void;
  onPlayerDonateTroopsClicked: (player: PlayerView) => void;
  onPlayerDonateGoldClicked: (player: PlayerView) => void;
  onActionSelected: (action: string) => void;
  orientationChangeHandler: () => void;
}): void {
  const {
    topBar,
    economyOverlay,
    intelSidebar,
    researchSidebar,
    playerToast,
    actionGrid,
    economyTab,
    intelTab,
    researchTab,
    zoomInButton,
    zoomCenterButton,
    zoomOutButton,
    onSettingsClick,
    onZoomIn,
    onZoomCenter,
    onZoomOut,
    onAttackRatioChanged,
    onPlayerChatClicked,
    onPlayerEmojiClicked,
    onPlayerDonateTroopsClicked,
    onPlayerDonateGoldClicked,
    onActionSelected,
    orientationChangeHandler,
  } = params;

  topBar.addEventListener("settings-click", () => {
    onSettingsClick();
  });

  bindOpenHandlers(economyTab, () => {
    economyOverlay.open();
  });

  bindOpenHandlers(intelTab, () => {
    intelSidebar.open();
  });

  bindOpenHandlers(researchTab, () => {
    researchSidebar.open();
  });

  bindPointerDownHandler(zoomInButton, () => {
    onZoomIn();
  });

  bindPointerDownHandler(zoomCenterButton, () => {
    onZoomCenter();
  });

  bindPointerDownHandler(zoomOutButton, () => {
    onZoomOut();
  });

  economyOverlay.addEventListener("attack-ratio-changed", (e: Event) => {
    const event = e as CustomEvent<{ ratio: number }>;
    onAttackRatioChanged(event.detail.ratio);
  });

  playerToast.addEventListener("toast-clicked", () => {
    intelSidebar.open();
  });

  playerToast.addEventListener("chat-clicked", (e: Event) => {
    const event = e as CustomEvent<{ player: PlayerView }>;
    onPlayerChatClicked(event.detail.player);
  });

  playerToast.addEventListener("emoji-clicked", (e: Event) => {
    const event = e as CustomEvent<{ player: PlayerView }>;
    onPlayerEmojiClicked(event.detail.player);
  });

  playerToast.addEventListener("donate-troops-clicked", (e: Event) => {
    const event = e as CustomEvent<{ player: PlayerView }>;
    onPlayerDonateTroopsClicked(event.detail.player);
  });

  playerToast.addEventListener("donate-gold-clicked", (e: Event) => {
    const event = e as CustomEvent<{ player: PlayerView }>;
    onPlayerDonateGoldClicked(event.detail.player);
  });

  actionGrid.addEventListener("action-selected", (e: Event) => {
    const event = e as CustomEvent<{ action: string }>;
    onActionSelected(event.detail.action);
  });

  window.addEventListener("orientationchange", orientationChangeHandler);
}
