/**
 * MobileUI - Main entry point for mobile UI system
 * Initializes and coordinates all mobile components
 */

import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import type { GameView, PlayerView } from "../../core/game/GameView";
import { CenterCameraEvent, DragEvent, ZoomEvent } from "../InputHandler";
import {
  BuildUnitIntentEvent,
  SendSpawnIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import { ToggleUpgradeModeEvent } from "../events/ToggleUpgradeModeEvent";
import type { TransformHandler } from "../graphics/TransformHandler";
import { MobileActionGrid } from "./MobileActionGrid";
import { MobileTopBar, TopBarStats } from "./MobileTopBar";
import {
  getBomberTargetStructures,
  parseBuildAction,
} from "./MobileUIActionUtils";
import { createMobileUIButtons } from "./MobileUIButtons";
import { setupMobileUIEventListeners } from "./MobileUIEventSetup";
import {
  handleAttackAction,
  handleDiplomacyAction,
  handlePlayerToastLongPress,
  handleSpawnAction,
  openChatModalForPlayer,
  openEmojiTableForPlayer,
  sendGoldDonationToPlayer,
  sendTroopDonationToPlayer,
} from "./MobileUIInteractions";
import {
  findUpgradeableStructureForStackTap,
  screenToTile,
} from "./MobileUIMapStack";
import {
  syncTopOverlayPositions,
  tickOverlayComponents,
} from "./MobileUIOverlayCoordinator";
import { syncMobileUIStateFromGame } from "./MobileUIStateSync";
import { MOBILE_UI_STYLE_ID, MOBILE_UI_STYLES } from "./MobileUIStyles";
import {
  getMobileResponsiveTokens,
  getMobileViewportProfile,
} from "./MobileViewportProfile";
import { GestureDetector } from "./gestures/GestureDetector";
import { MobileAllianceNotifications } from "./overlays/MobileAllianceNotifications";
import { MobileAttackBar } from "./overlays/MobileAttackBar";
import { MobileChatEmojiBar } from "./overlays/MobileChatEmojiBar";
import { MobileEconomyOverlay } from "./overlays/MobileEconomyOverlay";
import { MobileEventsDisplay } from "./overlays/MobileEventsDisplay";
import { MobileIntelSidebar } from "./overlays/MobileIntelSidebar";
import { MobilePlayerToast } from "./overlays/MobilePlayerToast";
import { MobileResearchSidebar } from "./overlays/MobileResearchSidebar";
import { MobileSettingsSidebar } from "./overlays/MobileSettingsSidebar";
import { MobileTechUnlockToast } from "./overlays/MobileTechUnlockToast";
import { MobileWinModal } from "./overlays/MobileWinModal";
import { HapticFeedback } from "./utils/HapticFeedback";

export class MobileUI {
  private actionGrid: MobileActionGrid;
  private topBar: MobileTopBar;
  private gestureDetector: GestureDetector | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private transformHandler: TransformHandler | null = null;

  // Phase 2 components
  private economyOverlay: MobileEconomyOverlay;

  // Phase 4 components
  private intelSidebar: MobileIntelSidebar;
  private playerToast: MobilePlayerToast;
  private techUnlockToast: MobileTechUnlockToast;
  private eventsDisplay: MobileEventsDisplay;
  private allianceNotifications: MobileAllianceNotifications;
  private attackBar: MobileAttackBar;
  private chatEmojiBar: MobileChatEmojiBar;
  private winModal: MobileWinModal;

  // Phase 5 components
  private researchSidebar: MobileResearchSidebar;
  private settingsSidebar: MobileSettingsSidebar;

  // Game state
  private currentGame: GameView | null = null;
  private selectedTile: TileRef | null = null;
  private attackRatio: number = 0.3; // Default 30%
  private active: boolean | null = null;
  private componentsAttached: boolean = false;
  private statsLoopId: number | null = null;
  private economyTab: HTMLButtonElement;
  private intelTab: HTMLButtonElement;
  private researchTab: HTMLButtonElement;
  private zoomInButton: HTMLButtonElement;
  private zoomCenterButton: HTMLButtonElement;
  private zoomOutButton: HTMLButtonElement;
  private lastGameTick: number = -1; // Track last processed game tick
  private gameDurationSeconds: number = 0; // Track game time in seconds (only after spawn phase)
  private currentGameId: string | null = null;
  private stackModeEnabled: boolean = false;
  private stackTargetUnitId: number | null = null;
  private readonly MOBILE_BUTTON_ZOOM_DELTA = 200;
  private readonly MOBILE_PINCH_ZOOM_MULTIPLIER = 50;
  private readonly orientationChangeHandler = (): void => {
    this.handleOrientationChange();
  };
  private readonly viewportResizeHandler = (): void => {
    this.applyResponsiveProfile();
  };

  constructor(private eventBus: EventBus) {
    if (typeof window !== "undefined") {
      (window as Window & { __MOBILE_UI__?: MobileUI }).__MOBILE_UI__ = this;
    }

    // Create and register custom elements
    this.setupCustomElements();

    // Create UI components
    this.actionGrid = document.createElement(
      "mobile-action-grid",
    ) as MobileActionGrid;
    this.topBar = document.createElement("mobile-top-bar") as MobileTopBar;

    // Create Phase 2 components
    this.economyOverlay = document.createElement(
      "mobile-economy-overlay",
    ) as MobileEconomyOverlay;

    // Create Phase 4 components
    this.intelSidebar = document.createElement(
      "mobile-intel-sidebar",
    ) as MobileIntelSidebar;
    this.playerToast = document.createElement(
      "mobile-player-toast",
    ) as MobilePlayerToast;
    this.techUnlockToast = document.createElement(
      "mobile-tech-unlock-toast",
    ) as MobileTechUnlockToast;
    this.eventsDisplay = document.createElement(
      "mobile-events-display",
    ) as MobileEventsDisplay;
    this.allianceNotifications = document.createElement(
      "mobile-alliance-notifications",
    ) as MobileAllianceNotifications;
    this.attackBar = document.createElement(
      "mobile-attack-bar",
    ) as MobileAttackBar;
    this.chatEmojiBar = document.createElement(
      "mobile-chat-emoji-bar",
    ) as MobileChatEmojiBar;
    this.chatEmojiBar.style.display = "none";
    this.winModal = document.createElement(
      "mobile-win-modal",
    ) as unknown as MobileWinModal;

    // Create Phase 5 components
    this.researchSidebar = document.createElement(
      "mobile-research-sidebar",
    ) as MobileResearchSidebar;
    this.settingsSidebar = document.createElement(
      "mobile-settings-sidebar",
    ) as MobileSettingsSidebar;

    const {
      economyTab,
      intelTab,
      researchTab,
      zoomInButton,
      zoomCenterButton,
      zoomOutButton,
    } = createMobileUIButtons();
    this.economyTab = economyTab;
    this.intelTab = intelTab;
    this.researchTab = researchTab;
    this.zoomInButton = zoomInButton;
    this.zoomCenterButton = zoomCenterButton;
    this.zoomOutButton = zoomOutButton;

    // Don't attach to DOM yet - wait for setActive(true)
    // Don't call any custom element methods yet - they're not registered until imports complete
    // this.attachComponents(); // Deferred until activation

    // Set up event listeners (will be called after first activation)
    // this.setupEventListeners(); // Deferred until activation
  }

  /**
   * Register custom elements if not already registered
   */
  private setupCustomElements(): void {
    // Import components to ensure they're registered
    import("./MobileActionGrid");
    import("./MobileTopBar");

    // Phase 2 components
    import("./overlays/MobileEconomyOverlay");

    // Phase 4 components
    import("./overlays/MobileAllianceNotifications");
    import("./overlays/MobileAttackBar");
    import("./overlays/MobileChatEmojiBar");
    import("./overlays/MobileEventsDisplay");
    import("./overlays/MobileIntelSidebar");
    import("./overlays/MobilePlayerToast");
    import("./overlays/MobileTechUnlockToast");
    import("./overlays/MobileWinModal");

    // Phase 5 components
    import("./overlays/MobileResearchSidebar");
    import("./overlays/MobileSettingsSidebar");
  }

  /**
   * Attach mobile components to the DOM
   */
  private attachComponents(): void {
    document.body.appendChild(this.topBar);
    document.body.appendChild(this.actionGrid);

    // Attach Phase 2 components
    document.body.appendChild(this.economyOverlay);

    // Attach Phase 4 components
    document.body.appendChild(this.intelSidebar);
    document.body.appendChild(this.playerToast);
    document.body.appendChild(this.techUnlockToast);
    document.body.appendChild(this.allianceNotifications);
    document.body.appendChild(this.attackBar);
    document.body.appendChild(this.chatEmojiBar);
    document.body.appendChild(this.winModal);

    // Attach Phase 5 components
    document.body.appendChild(this.researchSidebar);
    document.body.appendChild(this.settingsSidebar);
    document.body.appendChild(this.economyTab);
    document.body.appendChild(this.intelTab);
    document.body.appendChild(this.researchTab);

    // Attach zoom control buttons
    document.body.appendChild(this.zoomInButton);
    document.body.appendChild(this.zoomCenterButton);
    document.body.appendChild(this.zoomOutButton);

    // Add viewport meta tag if not present
    this.ensureViewportMeta();
  }

  /**
   * Enable or disable mobile UI visibility and behavior
   */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;

    if (active) {
      // Attach components to DOM on first activation
      if (!this.componentsAttached) {
        this.attachComponents();
        this.setupEventListeners();
        this.componentsAttached = true;
      }
      this.topBar.style.display = "";
      this.chatEmojiBar.style.display = "";
      document.body.classList.add("mobile-ui-enabled");
      this.injectMobileStyles();
      this.applyResponsiveProfile();
      window.addEventListener("resize", this.viewportResizeHandler);
      this.startStatsLoop();
    } else {
      // Only manipulate components if they've been attached
      if (this.componentsAttached) {
        if (this.stackModeEnabled) {
          this.stackModeEnabled = false;
          this.eventBus.emit(new ToggleUpgradeModeEvent(false));
          this.actionGrid.setStackModeEnabled(false);
        }
        this.topBar.style.display = "none";
        this.economyTab.style.display = "none";
        this.intelTab.style.display = "none";
        this.researchTab.style.display = "none";
        this.chatEmojiBar.style.display = "none";
        this.zoomInButton.style.display = "none";
        this.zoomCenterButton.style.display = "none";
        this.zoomOutButton.style.display = "none";
        this.closeAllOverlays();
      }
      document.body.classList.remove("mobile-ui-enabled");
      window.removeEventListener("resize", this.viewportResizeHandler);
      this.clearResponsiveProfile();
      document.getElementById("mobile-ui-styles")?.remove();
      this.stopStatsLoop();
    }
  }

  private applyResponsiveProfile(): void {
    const profile = getMobileViewportProfile(
      window.innerWidth,
      window.innerHeight,
    );
    const tokens = getMobileResponsiveTokens(profile);

    document.body.dataset.mobileClass = profile.sizeClass;
    document.body.dataset.mobileOrientation = profile.orientation;
    document.body.dataset.mobileBaseline = profile.isReferenceBaseline
      ? "reference"
      : "derived";

    for (const [token, value] of Object.entries(tokens)) {
      document.body.style.setProperty(token, value);
      this.actionGrid.style.setProperty(token, value);
    }
  }

  private clearResponsiveProfile(): void {
    delete document.body.dataset.mobileClass;
    delete document.body.dataset.mobileOrientation;
    delete document.body.dataset.mobileBaseline;

    const tokenKeys = [
      "--m-panel-top-offset",
      "--m-panel-safe-top-padding",
      "--m-grid-gap",
      "--m-grid-max-h",
      "--m-grid-padding",
      "--m-grid-padding-bottom",
      "--m-grid-radius",
      "--m-grid-column-min",
      "--m-grid-tile-min-h",
      "--m-grid-tile-min-h-multi",
      "--m-grid-tile-padding",
      "--m-grid-tile-gap",
      "--m-grid-icon-size",
      "--m-grid-icon-size-multi",
      "--m-grid-font-size",
      "--m-grid-font-size-multi",
      "--m-grid-cost-top",
      "--m-grid-cost-right",
      "--m-grid-cost-max-width-inset",
      "--m-grid-cost-min-h",
      "--m-grid-cost-padding-x",
      "--m-grid-cost-font-size",
      "--m-grid-cost-gap",
      "--m-grid-cost-multi-min-h",
      "--m-grid-cost-multi-padding-x",
      "--m-grid-cost-multi-font-size",
    ];
    for (const token of tokenKeys) {
      document.body.style.removeProperty(token);
      this.actionGrid.style.removeProperty(token);
    }
  }

  /**
   * Start the stats update loop
   */
  private startStatsLoop(): void {
    if (this.statsLoopId !== null) return;

    const updateStats = () => {
      this.updateStatsFromGame();
      this.statsLoopId = requestAnimationFrame(updateStats);
    };
    this.statsLoopId = requestAnimationFrame(updateStats);
  }

  /**
   * Stop the stats update loop
   */
  private stopStatsLoop(): void {
    if (this.statsLoopId !== null) {
      cancelAnimationFrame(this.statsLoopId);
      this.statsLoopId = null;
    }
  }

  /**
   * Update stats from current game state
   */
  private updateStatsFromGame(): void {
    const syncResult = syncMobileUIStateFromGame({
      game: this.currentGame,
      lastGameTick: this.lastGameTick,
      gameDurationSeconds: this.gameDurationSeconds,
      topBar: this.topBar,
      economyTab: this.economyTab,
      intelTab: this.intelTab,
      researchTab: this.researchTab,
      attackBar: this.attackBar,
    });
    if (!syncResult.didProcessTick) {
      return;
    }
    this.lastGameTick = syncResult.lastGameTick;
    this.gameDurationSeconds = syncResult.gameDurationSeconds;

    syncTopOverlayPositions({
      componentsAttached: this.componentsAttached,
      topBar: this.topBar,
      attackBar: this.attackBar,
      chatEmojiBar: this.chatEmojiBar,
    });

    tickOverlayComponents({
      eventsDisplay: this.eventsDisplay,
      attackBar: this.attackBar,
      chatEmojiBar: this.chatEmojiBar,
      winModal: this.winModal,
      allianceNotifications: this.allianceNotifications,
    });
  }

  private closeAllOverlays(): void {
    this.actionGrid.close();
    this.economyOverlay.close();
    this.intelSidebar.close();
    this.researchSidebar.close();
    this.settingsSidebar.close();
    this.playerToast.hide();
    this.winModal.hide();
  }

  /**
   * Ensure proper viewport meta tag is set
   */
  private ensureViewportMeta(): void {
    let viewportMeta = document.querySelector(
      'meta[name="viewport"]',
    ) as HTMLMetaElement;

    if (!viewportMeta) {
      viewportMeta = document.createElement("meta");
      viewportMeta.name = "viewport";
      document.head.appendChild(viewportMeta);
    }

    // Set viewport with safe area support
    viewportMeta.content =
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
  }

  /**
   * Inject mobile-specific global styles
   */
  private injectMobileStyles(): void {
    // Don't inject if already present
    if (document.getElementById(MOBILE_UI_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = MOBILE_UI_STYLE_ID;
    style.textContent = MOBILE_UI_STYLES;

    document.head.appendChild(style);
  }

  /**
   * Set up event listeners for UI components
   */
  private setupEventListeners(): void {
    setupMobileUIEventListeners({
      topBar: this.topBar,
      economyOverlay: this.economyOverlay,
      intelSidebar: this.intelSidebar,
      researchSidebar: this.researchSidebar,
      playerToast: this.playerToast,
      actionGrid: this.actionGrid,
      economyTab: this.economyTab,
      intelTab: this.intelTab,
      researchTab: this.researchTab,
      zoomInButton: this.zoomInButton,
      zoomCenterButton: this.zoomCenterButton,
      zoomOutButton: this.zoomOutButton,
      onSettingsClick: () => this.handleSettingsClick(),
      onZoomIn: () => this.handleZoomIn(),
      onZoomCenter: () => this.handleZoomCenter(),
      onZoomOut: () => this.handleZoomOut(),
      onAttackRatioChanged: (ratio) => {
        this.attackRatio = ratio;
      },
      onPlayerChatClicked: (player) => this.openChatModalForPlayer(player),
      onPlayerEmojiClicked: (player) => this.openEmojiTableForPlayer(player),
      onPlayerDonateTroopsClicked: (player) =>
        this.sendTroopDonationToPlayer(player),
      onPlayerDonateGoldClicked: (player) =>
        this.sendGoldDonationToPlayer(player),
      onActionSelected: (action) => {
        void this.handleActionSelected(action);
      },
      orientationChangeHandler: this.orientationChangeHandler,
    });
  }

  /**
   * Initialize gesture detection on the game canvas
   */
  initializeGestureDetection(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.gestureDetector = new GestureDetector(canvas);

    // Register gesture callbacks
    this.gestureDetector.on("tap", (gesture) => {
      this.handleMapTap(gesture.position);
    });

    this.gestureDetector.on("long-press", (gesture) => {
      this.handleMapLongPress(gesture.position);
    });

    this.gestureDetector.on("edge-swipe-left", (gesture) => {
      this.handleOpenIntelSidebar();
    });

    this.gestureDetector.on("edge-swipe-right", (gesture) => {
      this.handleOpenResearchSidebar();
    });

    this.gestureDetector.on("pinch", (gesture) => {
      if (!gesture.scale || !this.canvas) return;

      // Calculate zoom delta from scale (scale > 1 = zoom in, scale < 1 = zoom out)
      const delta = (1 - gesture.scale) * this.MOBILE_PINCH_ZOOM_MULTIPLIER;

      // Use center of canvas as zoom point
      const rect = this.canvas.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      this.eventBus.emit(new ZoomEvent(centerX, centerY, delta));
    });

    this.gestureDetector.on("drag", (gesture) => {
      if (!gesture.delta) return;
      this.eventBus.emit(new DragEvent(gesture.delta.x, gesture.delta.y));
    });
  }

  /**
   * Update game stats in the top bar
   */
  updateStats(stats: TopBarStats): void {
    this.topBar.updateStats(stats);
  }

  /**
   * Update game state
   */
  updateGameState(game: GameView): void {
    const nextGameId = game.gameID();
    const isNewGame = this.currentGameId !== nextGameId;
    this.currentGame = game;
    this.currentGameId = nextGameId;

    // Update Phase 4 components with game state
    this.intelSidebar.game = game;
    this.intelSidebar.eventsDisplay = this.eventsDisplay;
    this.playerToast.game = game;
    this.playerToast.eventBus = this.eventBus;
    this.eventsDisplay.game = game;
    this.eventsDisplay.eventBus = this.eventBus;
    this.allianceNotifications.game = game;
    this.allianceNotifications.eventBus = this.eventBus;
    this.attackBar.game = game;
    this.attackBar.eventBus = this.eventBus;
    this.chatEmojiBar.game = game;
    this.chatEmojiBar.eventBus = this.eventBus;
    this.winModal.game = game;
    this.winModal.eventBus = this.eventBus;

    // Update Phase 5 components with game state
    this.researchSidebar.game = game;
    this.researchSidebar.eventBus = this.eventBus;
    this.settingsSidebar.game = game;
    this.settingsSidebar.eventBus = this.eventBus;
    this.economyOverlay.game = game;
    this.economyOverlay.eventBus = this.eventBus;

    if (isNewGame) {
      this.lastGameTick = -1;
      this.gameDurationSeconds = 0;
      this.economyOverlay.resetInvestmentDefaults();
      this.economyOverlay.applyPreferredCombatRatios();
    }
  }

  /**
   * Provide renderer transform handler for screen-to-tile conversion
   */
  setTransformHandler(transformHandler: TransformHandler): void {
    this.transformHandler = transformHandler;
  }

  /**
   * Handle build item selected from action grid
   */
  private handleBuildItemSelected(action: string): void {
    const unitType = parseBuildAction(action);

    if (!unitType || !this.selectedTile || !this.currentGame) {
      return;
    }

    let targetTile = this.selectedTile;

    // Special handling for Port: if clicking on water, find nearest owned shore
    if (
      unitType === UnitType.Port &&
      !this.currentGame.isLand(this.selectedTile)
    ) {
      const myPlayer = this.currentGame.myPlayer();
      if (myPlayer) {
        // Find nearest owned shore tile within search radius
        const nearbyTiles = Array.from(
          this.currentGame.bfs(
            this.selectedTile,
            (gm, t) =>
              this.currentGame!.manhattanDist(this.selectedTile!, t) <= 10,
          ),
        );

        const ownedShores = nearbyTiles
          .filter(
            (t) =>
              this.currentGame!.owner(t) === myPlayer &&
              this.currentGame!.isOceanShore(t),
          )
          .sort(
            (a, b) =>
              this.currentGame!.manhattanDist(this.selectedTile!, a) -
              this.currentGame!.manhattanDist(this.selectedTile!, b),
          );

        if (ownedShores.length > 0) {
          targetTile = ownedShores[0];
        }
      }
    }

    this.eventBus.emit(new BuildUnitIntentEvent(unitType, targetTile));
    HapticFeedback.success();
  }

  /**
   * Handle attack item selected from action grid
   */
  private handleAttackItemSelected(action: string): void {
    handleAttackAction({
      action,
      game: this.currentGame,
      selectedTile: this.selectedTile,
      attackRatio: this.attackRatio,
      eventBus: this.eventBus,
      openIntelSidebar: () => this.intelSidebar.open(),
      bomberTargetStructures: getBomberTargetStructures(),
    });
  }

  /**
   * Handle diplomacy item selected from action grid
   */
  private handleDiplomacyItemSelected(action: string): void {
    handleDiplomacyAction({
      action,
      game: this.currentGame,
      selectedTile: this.selectedTile,
      eventBus: this.eventBus,
      openIntelSidebar: () => this.intelSidebar.open(),
      openEmojiTableForPlayer: (targetPlayer) =>
        this.openEmojiTableForPlayer(targetPlayer),
      sendTroopDonationToPlayer: (targetPlayer) =>
        this.sendTroopDonationToPlayer(targetPlayer),
      sendGoldDonationToPlayer: (targetPlayer) =>
        this.sendGoldDonationToPlayer(targetPlayer),
      openChatModalForPlayer: (targetPlayer) =>
        this.openChatModalForPlayer(targetPlayer),
    });
  }

  /**
   * Handle action selected from action grid
   * Routes to appropriate handlers based on action prefix
   */
  private async handleActionSelected(action: string): Promise<void> {
    if (action === "mode:stack-toggle") {
      this.handleStackModeToggle();
      return;
    }

    // Close the action grid
    this.actionGrid.close();

    if (!this.currentGame || !this.selectedTile) {
      return;
    }

    const myPlayer = this.currentGame.myPlayer();
    if (!myPlayer) {
      return;
    }

    // Spawn action
    if (action === "spawn") {
      handleSpawnAction({
        game: this.currentGame,
        selectedTile: this.selectedTile,
        eventBus: this.eventBus,
      });
      return;
    }

    // Build actions
    if (action.startsWith("build:")) {
      this.handleBuildItemSelected(action);
      return;
    }

    // Attack actions
    if (action.startsWith("attack:")) {
      this.handleAttackItemSelected(action);
      return;
    }

    // Diplomacy actions
    if (action.startsWith("diplomacy:")) {
      this.handleDiplomacyItemSelected(action);
      return;
    }
  }

  private handleStackModeToggle(): void {
    this.stackModeEnabled = !this.stackModeEnabled;
    if (!this.stackModeEnabled) {
      this.stackTargetUnitId = null;
    }
    this.eventBus.emit(new ToggleUpgradeModeEvent(this.stackModeEnabled));
    this.actionGrid.setStackModeEnabled(this.stackModeEnabled);
    HapticFeedback.tap();
  }

  /**
   * Handle map tap (for tile selection)
   */
  private handleMapTap(position: { x: number; y: number }): void {
    if (this.playerToast.visible) {
      this.playerToast.hide();
      this.actionGrid.close();
      return;
    }

    const tile = screenToTile({
      position,
      game: this.currentGame,
      transformHandler: this.transformHandler,
    });
    if (!tile) {
      return;
    }
    this.selectedTile = tile;

    if (!this.currentGame) return;

    // Handle spawn phase directly - emit spawn event immediately
    if (this.currentGame.inSpawnPhase()) {
      if (this.currentGame.isLand(tile) && !this.currentGame.hasOwner(tile)) {
        this.eventBus.emit(new SendSpawnIntentEvent(tile));
      }
      return;
    }

    if (this.stackModeEnabled) {
      this.tryStackStructureAtTile(tile, position);
      return;
    }

    // For all tiles, show action grid
    this.actionGrid.showForTile(tile, this.currentGame, this.attackRatio);
  }

  private tryStackStructureAtTile(
    tile: TileRef,
    position?: { x: number; y: number },
  ): void {
    if (!this.currentGame) return;

    const myPlayer = this.currentGame.myPlayer();
    if (!myPlayer) return;

    const { structure, nextStackTargetUnitId } =
      findUpgradeableStructureForStackTap({
        tile,
        myPlayer,
        position,
        game: this.currentGame,
        transformHandler: this.transformHandler,
        stackTargetUnitId: this.stackTargetUnitId,
      });
    this.stackTargetUnitId = nextStackTargetUnitId;

    if (!structure) {
      HapticFeedback.error();
      return;
    }

    this.stackTargetUnitId = structure.id();

    this.eventBus.emit(
      new SendUpgradeStructureIntentEvent(structure.id(), structure.type()),
    );
    HapticFeedback.success();
  }

  /**
   * Handle long-press on map
   * Shows player toast for any owned tile, economy overlay otherwise
   */
  private async handleMapLongPress(position: {
    x: number;
    y: number;
  }): Promise<void> {
    const tile = screenToTile({
      position,
      game: this.currentGame,
      transformHandler: this.transformHandler,
    });
    if (!tile || !this.currentGame) {
      return;
    }

    this.selectedTile = tile;

    const shownPlayerToast = await handlePlayerToastLongPress({
      game: this.currentGame,
      tile,
      playerToast: this.playerToast,
    });
    if (shownPlayerToast) {
      return;
    }

    // Long-press on own/neutral tiles: open economy overlay
    this.economyOverlay.open();
  }

  private sendTroopDonationToPlayer(targetPlayer: PlayerView): void {
    sendTroopDonationToPlayer({
      targetPlayer,
      game: this.currentGame,
      eventBus: this.eventBus,
      attackRatio: this.attackRatio,
    });
  }

  private sendGoldDonationToPlayer(targetPlayer: PlayerView): void {
    sendGoldDonationToPlayer({ targetPlayer, eventBus: this.eventBus });
  }

  private openChatModalForPlayer(targetPlayer: PlayerView): void {
    openChatModalForPlayer({ targetPlayer, game: this.currentGame });
  }

  private openEmojiTableForPlayer(targetPlayer: PlayerView): void {
    openEmojiTableForPlayer({
      targetPlayer,
      game: this.currentGame,
      eventBus: this.eventBus,
    });
  }

  /**
   * Handle settings button click
   */
  private handleSettingsClick(): void {
    this.settingsSidebar.toggle();
  }

  /**
   * Handle zoom in button click
   */
  private handleZoomIn(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    // Negative delta = zoom in (scale increases)
    this.eventBus.emit(
      new ZoomEvent(centerX, centerY, -this.MOBILE_BUTTON_ZOOM_DELTA),
    );
  }

  /**
   * Handle zoom out button click
   */
  private handleZoomOut(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    // Positive delta = zoom out (scale decreases)
    this.eventBus.emit(
      new ZoomEvent(centerX, centerY, this.MOBILE_BUTTON_ZOOM_DELTA),
    );
  }

  /**
   * Handle center button click - pan to player's territory center
   */
  private handleZoomCenter(): void {
    this.eventBus.emit(new CenterCameraEvent());
  }

  /**
   * Handle opening Intel sidebar
   */
  private handleOpenIntelSidebar(): void {
    this.intelSidebar.toggle();
  }

  /**
   * Handle opening Research sidebar
   */
  private handleOpenResearchSidebar(): void {
    this.researchSidebar.toggle();
  }

  /**
   * Handle orientation changes
   */
  private handleOrientationChange(): void {
    this.applyResponsiveProfile();

    syncTopOverlayPositions({
      componentsAttached: this.componentsAttached,
      topBar: this.topBar,
      attackBar: this.attackBar,
      chatEmojiBar: this.chatEmojiBar,
    });
  }

  /**
   * Clean up mobile UI
   */
  destroy(): void {
    this.stopStatsLoop();

    // Remove components from DOM
    this.topBar.remove();
    this.actionGrid.remove();
    this.economyOverlay.remove();
    this.intelSidebar.remove();
    this.playerToast.remove();
    this.techUnlockToast.remove();
    this.allianceNotifications.remove();
    this.attackBar.remove();
    this.chatEmojiBar.remove();
    this.winModal.remove();
    this.researchSidebar.remove();
    this.settingsSidebar.remove();
    this.economyTab.remove();
    this.intelTab.remove();
    this.researchTab.remove();
    this.zoomInButton.remove();
    this.zoomCenterButton.remove();
    this.zoomOutButton.remove();

    window.removeEventListener(
      "orientationchange",
      this.orientationChangeHandler,
    );
    window.removeEventListener("resize", this.viewportResizeHandler);

    // Clean up gesture detector
    if (this.gestureDetector) {
      this.gestureDetector.destroy();
    }

    // Remove mobile class from body
    document.body.classList.remove("mobile-ui-enabled");
    this.clearResponsiveProfile();

    // Remove injected styles
    document.getElementById("mobile-ui-styles")?.remove();

    if (typeof window !== "undefined") {
      const win = window as Window & { __MOBILE_UI__?: MobileUI };
      if (win.__MOBILE_UI__ === this) {
        delete win.__MOBILE_UI__;
      }
    }
  }
}
