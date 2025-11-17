import { EventBus } from "../../core/EventBus";
import { GameView } from "../../core/game/GameView";
import { GameStartingModal } from "../GameStartingModal";
import { RefreshGraphicsEvent as RedrawGraphicsEvent } from "../InputHandler";
import { TransformHandler } from "./TransformHandler";
import { UIState } from "./UIState";
import { BuildMenu } from "./layers/BuildMenu";
import { CargoTruckLayer } from "./layers/CargoTruckLayer";
import { ChatDisplay } from "./layers/ChatDisplay";
import { ChatModal } from "./layers/ChatModal";
import { ControlPanel } from "./layers/ControlPanel";
import { ControlPanel2 } from "./layers/ControlPanel2";
import { EmojiTable } from "./layers/EmojiTable";
import { EventsDisplay } from "./layers/EventsDisplay";
import { FxLayer } from "./layers/FxLayer";
import { GameLeftSidebar } from "./layers/GameLeftSidebar";
import { HeadsUpMessage } from "./layers/HeadsUpMessage";
import { Layer } from "./layers/Layer";
import { Leaderboard } from "./layers/Leaderboard";
import { MultiTabModal } from "./layers/MultiTabModal";
import { NameLayer } from "./layers/NameLayer";
import { OptionsMenu } from "./layers/OptionsMenu";
import { PlayerInfoOverlay } from "./layers/PlayerInfoOverlay";
import { PlayerPanel } from "./layers/PlayerPanel";
import { PointerCoordsLayer } from "./layers/PointerCoordsLayer";
import { RadialMenu } from "./layers/RadialMenu";
import { RangeOverlayLayer } from "./layers/RangeOverlayLayer";
import { ReplayPanel } from "./layers/ReplayPanel";
import { ResearchToggleButton } from "./layers/ResearchToggleButton";
import { RoadLayer } from "./layers/RoadLayer";
import { SpawnTimer } from "./layers/SpawnTimer";
import { StructureLayer } from "./layers/StructureLayer";
import { TeamStats } from "./layers/TeamStats";
import { TechUnlockNotification } from "./layers/TechUnlockNotification";
import { TerrainLayer } from "./layers/TerrainLayer";
import { TerritoryLayer } from "./layers/TerritoryLayer";
import { TopBar } from "./layers/TopBar";
import { UILayer } from "./layers/UILayer";
import { UnitLayer } from "./layers/UnitLayer";
import { WinModal } from "./layers/WinModal";

// Debug flags (keep off for normal gameplay)
const DEBUG_SHOW_POINTER_COORDS = false;

export function createRenderer(
  canvas: HTMLCanvasElement,
  game: GameView,
  eventBus: EventBus,
): GameRenderer {
  const transformHandler = new TransformHandler(game, eventBus, canvas);

  // Prevent main menu/page scrolling during gameplay
  const previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  const uiState: UIState = {
    attackRatio: 0.2, // 20% as a float
    investmentRate: 0.5, // 50% default investment rate
    pendingBuildUnitType: null,
    multibuildEnabled: false,
    upgradeMode: false,
    unitLevels: {},
  };

  //hide when the game renders
  const startingModal = document.querySelector(
    "game-starting-modal",
  ) as GameStartingModal;
  startingModal.hide();

  // TODO maybe append this to dcoument instead of querying for them?
  const emojiTable = document.querySelector("emoji-table") as EmojiTable;
  if (!emojiTable || !(emojiTable instanceof EmojiTable)) {
    console.error("EmojiTable element not found in the DOM");
  }
  emojiTable.transformHandler = transformHandler;
  emojiTable.game = game;
  emojiTable.initEventBus(eventBus);

  const buildMenu = document.querySelector("build-menu") as BuildMenu;
  if (!buildMenu || !(buildMenu instanceof BuildMenu)) {
    console.error("BuildMenu element not found in the DOM");
  }
  buildMenu.game = game;
  buildMenu.eventBus = eventBus;
  buildMenu.uiState = uiState;

  const leaderboard = document.querySelector("leader-board") as Leaderboard;
  if (!leaderboard || !(leaderboard instanceof Leaderboard)) {
    console.error("LeaderBoard element not found in the DOM");
  }
  leaderboard.eventBus = eventBus;
  leaderboard.game = game;

  const gameLeftSidebar = document.querySelector(
    "game-left-sidebar",
  ) as GameLeftSidebar;
  if (!gameLeftSidebar || !(gameLeftSidebar instanceof GameLeftSidebar)) {
    console.error("GameLeftSidebar element not found in the DOM");
  }
  gameLeftSidebar.game = game;

  const teamStats = document.querySelector("team-stats") as TeamStats;
  if (!teamStats || !(teamStats instanceof TeamStats)) {
    console.error("TeamStats element not found in the DOM");
  }
  teamStats.eventBus = eventBus;
  teamStats.game = game;

  const controlPanel = document.querySelector("control-panel") as ControlPanel;
  if (!(controlPanel instanceof ControlPanel)) {
    console.error("ControlPanel element not found in the DOM");
  }
  controlPanel.eventBus = eventBus;
  controlPanel.uiState = uiState;
  controlPanel.game = game;

  const controlPanel2 = document.querySelector(
    "control-panel2",
  ) as ControlPanel2;
  if (!(controlPanel2 instanceof ControlPanel2)) {
    console.error("ControlPanel2 element not found in the DOM");
  }
  controlPanel2.eventBus = eventBus;
  controlPanel2.uiState = uiState;
  controlPanel2.game = game;

  const researchToggleButton = document.querySelector(
    "research-toggle-button",
  ) as ResearchToggleButton;
  if (!(researchToggleButton instanceof ResearchToggleButton)) {
    console.error("ResearchToggleButton element not found in the DOM");
  }
  researchToggleButton.eventBus = eventBus;
  researchToggleButton.game = game;

  const techUnlockNotification = document.querySelector(
    "tech-unlock-notification",
  ) as TechUnlockNotification;
  if (!(techUnlockNotification instanceof TechUnlockNotification)) {
    console.error("TechUnlockNotification element not found in the DOM");
  }
  techUnlockNotification.eventBus = eventBus;
  techUnlockNotification.game = game;

  const eventsDisplay = document.querySelector(
    "events-display",
  ) as EventsDisplay;
  if (!(eventsDisplay instanceof EventsDisplay)) {
    console.error("events display not found");
  }
  eventsDisplay.eventBus = eventBus;
  eventsDisplay.game = game;

  const chatDisplay = document.querySelector("chat-display") as ChatDisplay;
  if (!(chatDisplay instanceof ChatDisplay)) {
    console.error("chat display not found");
  }
  chatDisplay.eventBus = eventBus;
  chatDisplay.game = game;

  const playerInfo = document.querySelector(
    "player-info-overlay",
  ) as PlayerInfoOverlay;
  if (!(playerInfo instanceof PlayerInfoOverlay)) {
    console.error("player info overlay not found");
  }
  playerInfo.eventBus = eventBus;
  playerInfo.transform = transformHandler;
  playerInfo.game = game;

  const winModel = document.querySelector("win-modal") as WinModal;
  if (!(winModel instanceof WinModal)) {
    console.error("win modal not found");
  }
  winModel.eventBus = eventBus;
  winModel.game = game;

  const optionsMenu = document.querySelector("options-menu") as OptionsMenu;
  if (!(optionsMenu instanceof OptionsMenu)) {
    console.error("options menu not found");
  }
  optionsMenu.eventBus = eventBus;
  optionsMenu.game = game;

  const replayPanel = document.querySelector("replay-panel") as ReplayPanel;
  if (!(replayPanel instanceof ReplayPanel)) {
    console.error("ReplayPanel element not found in the DOM");
  }
  replayPanel.eventBus = eventBus;
  replayPanel.game = game;

  const topBar = document.querySelector("top-bar") as TopBar;
  if (!(topBar instanceof TopBar)) {
    console.error("top bar not found");
  }
  topBar.game = game;

  const playerPanel = document.querySelector("player-panel") as PlayerPanel;
  if (!(playerPanel instanceof PlayerPanel)) {
    console.error("player panel not found");
  }
  playerPanel.g = game;
  playerPanel.eventBus = eventBus;
  playerPanel.emojiTable = emojiTable;
  playerPanel.uiState = uiState;

  const chatModal = document.querySelector("chat-modal") as ChatModal;
  if (!(chatModal instanceof ChatModal)) {
    console.error("chat modal not found");
  }
  chatModal.g = game;
  chatModal.eventBus = eventBus;

  const multiTabModal = document.querySelector(
    "multi-tab-modal",
  ) as MultiTabModal;
  if (!(multiTabModal instanceof MultiTabModal)) {
    console.error("multi-tab modal not found");
  }
  multiTabModal.game = game;

  const headsUpMessage = document.querySelector(
    "heads-up-message",
  ) as HeadsUpMessage;
  if (!(headsUpMessage instanceof HeadsUpMessage)) {
    console.error("heads-up message not found");
  }
  headsUpMessage.game = game;

  // Provide a lightweight teardown hook to restore page scroll if needed

  const cleanup = () => {
    document.body.style.overflow = previousBodyOverflow;
  };

  const structureLayer = new StructureLayer(game, eventBus, transformHandler);

  const layers: Layer[] = [
    new TerrainLayer(game, transformHandler),
    new TerritoryLayer(game, eventBus, transformHandler),
    new RoadLayer(game, transformHandler),
    new CargoTruckLayer(game, transformHandler),
    // World-space ring overlay for Defense Posts/SAMs
    new RangeOverlayLayer(game, eventBus, transformHandler, uiState),
    structureLayer,
    new UnitLayer(game, eventBus, transformHandler, uiState),
    new FxLayer(game),
    // Draw name labels in world space along with other transformed layers
    new NameLayer(game, transformHandler, eventBus),
    // UI layer comes after world-space drawing to minimize save/restore
    new UILayer(game, eventBus, transformHandler),
    // Pointer coordinates (screen-space, debug only)
    ...(DEBUG_SHOW_POINTER_COORDS
      ? [new PointerCoordsLayer(game, eventBus, transformHandler)]
      : []),
    eventsDisplay,
    chatDisplay,
    new RadialMenu(
      eventBus,
      game,
      transformHandler,
      emojiTable as EmojiTable,
      uiState,
      playerInfo,
      playerPanel,
    ),
    new SpawnTimer(game, transformHandler),
    leaderboard,
    gameLeftSidebar,
    controlPanel,
    controlPanel2,
    researchToggleButton,
    techUnlockNotification,
    playerInfo,
    winModel,
    optionsMenu,
    replayPanel,
    teamStats,
    topBar,
    playerPanel,
    headsUpMessage,
    multiTabModal,
  ];

  return new GameRenderer(
    game,
    eventBus,
    canvas,
    transformHandler,
    uiState,
    layers,
  );
}

export class GameRenderer {
  private context: CanvasRenderingContext2D;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private canvas: HTMLCanvasElement,
    public transformHandler: TransformHandler,
    public uiState: UIState,
    private layers: Layer[],
  ) {
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
  }

  initialize() {
    this.eventBus.on(RedrawGraphicsEvent, () => this.redraw());
    this.layers.forEach((l) => l.init?.());

    document.body.appendChild(this.canvas);
    window.addEventListener("resize", () => this.resizeCanvas());
    this.resizeCanvas();

    //show whole map on startup
    this.transformHandler.centerAll(0.9);

    let rafId = requestAnimationFrame(() => this.renderGame());
    this.canvas.addEventListener("contextlost", () => {
      cancelAnimationFrame(rafId);
    });
    this.canvas.addEventListener("contextrestored", () => {
      this.redraw();
      rafId = requestAnimationFrame(() => this.renderGame());
    });
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.transformHandler.updateCanvasBoundingRect();
    //this.redraw()
  }

  redraw() {
    this.layers.forEach((l) => {
      if (l.redraw) {
        l.redraw();
      }
    });
  }

  renderGame() {
    const start = performance.now();
    // Set background
    this.context.fillStyle = this.game
      .config()
      .theme()
      .backgroundColor()
      .toHex();
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Minimize save/restore by rendering world-space (transformed) layers in one block,
    // then UI/screen-space layers without a transform.
    // First pass: world-space layers
    this.context.save();
    this.transformHandler.handleTransform(this.context);
    for (const layer of this.layers) {
      if (layer.shouldTransform?.() ?? false) {
        layer.renderLayer?.(this.context);
      }
    }
    this.context.restore();

    // Second pass: UI layers (no transform)
    for (const layer of this.layers) {
      if (!(layer.shouldTransform?.() ?? false)) {
        layer.renderLayer?.(this.context);
      }
    }
    this.transformHandler.resetChanged();

    requestAnimationFrame(() => this.renderGame());

    const duration = performance.now() - start;
    if (duration > 50) {
      console.warn(
        `tick ${this.game.ticks()} took ${duration}ms to render frame`,
      );
    }
  }

  tick() {
    this.layers.forEach((l) => l.tick?.());
  }

  resize(width: number, height: number): void {
    this.canvas.width = Math.ceil(width / window.devicePixelRatio);
    this.canvas.height = Math.ceil(height / window.devicePixelRatio);
  }
}
