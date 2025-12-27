import doveIcon from "../../../../proprietary/images/dove.png";
import allianceIcon from "../../../../resources/images/AllianceIcon.svg";
import allianceRequestBlackIcon from "../../../../resources/images/AllianceRequestBlackIcon.svg";
import allianceRequestWhiteIcon from "../../../../resources/images/AllianceRequestWhiteIcon.svg";
import crownIcon from "../../../../resources/images/CrownIcon.svg";
import disconnectedIcon from "../../../../resources/images/DisconnectedIcon.svg";
import embargoBlackIcon from "../../../../resources/images/EmbargoBlackIcon.svg";
import embargoWhiteIcon from "../../../../resources/images/EmbargoWhiteIcon.svg";
import nukeRedIcon from "../../../../resources/images/NukeIconRed.svg";
import nukeWhiteIcon from "../../../../resources/images/NukeIconWhite.svg";
import shieldIcon from "../../../../resources/images/ShieldIconBlack.svg";
import swordIconBlack from "../../../../resources/images/SwordIcon.svg";
import targetIcon from "../../../../resources/images/TargetIcon.svg";
import traitorIcon from "../../../../resources/images/TraitorIcon.svg";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { BotPersonality } from "../../../core/execution/FakeHumanExecution";
import {
  AllPlayers,
  Cell,
  nukeTypes,
  PlayerType,
} from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { AlternateViewEvent } from "../../InputHandler";
import { createCanvas, renderNumber, renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

function getPersonalityName(personality: number): string {
  switch (personality) {
    case BotPersonality.Balanced:
      return "Balanced";
    case BotPersonality.LandWarfare:
      return "Land Warfare";
    case BotPersonality.AirSupremacy:
      return "Air Supremacy";
    case BotPersonality.NavalPower:
      return "Naval Power";
    case BotPersonality.Nuclear:
      return "Nuclear";
    default:
      return "Unknown";
  }
}

class RenderInfo {
  public icons: Map<string, HTMLImageElement> = new Map(); // Track icon elements

  constructor(
    public player: PlayerView,
    public lastRenderCalc: number,
    public location: Cell | null,
    public fontSize: number,
    public fontColor: string,
    public element: HTMLElement,
  ) {}
}

export class NameLayer implements Layer {
  layerName = "NameLayer";
  private canvas: HTMLCanvasElement;
  private lastChecked = 0;
  private renderCheckRate = 100;
  private renderRefreshRate = 500;
  private rand = new PseudoRandom(10);
  private renders: RenderInfo[] = [];
  private seenPlayers: Set<PlayerView> = new Set();
  private traitorIconImage: HTMLImageElement;
  private disconnectedIconImage: HTMLImageElement;
  private allianceRequestBlackIconImage: HTMLImageElement;
  private allianceRequestWhiteIconImage: HTMLImageElement;
  private allianceIconImage: HTMLImageElement;
  private targetIconImage: HTMLImageElement;
  private crownIconImage: HTMLImageElement;
  private embargoBlackIconImage: HTMLImageElement;
  private embargoWhiteIconImage: HTMLImageElement;
  private nukeWhiteIconImage: HTMLImageElement;
  private nukeRedIconImage: HTMLImageElement;
  private shieldIconImage: HTMLImageElement;
  private warIconImage: HTMLImageElement;
  private doveIconImage: HTMLImageElement;
  private container: HTMLDivElement;
  private firstPlace: PlayerView | null = null;
  private theme: Theme = this.game.config().theme();
  private userSettings: UserSettings = new UserSettings();
  private isVisible: boolean = true;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private eventBus: EventBus,
  ) {
    this.traitorIconImage = new Image();
    this.traitorIconImage.src = traitorIcon;
    this.disconnectedIconImage = new Image();
    this.disconnectedIconImage.src = disconnectedIcon;
    this.allianceIconImage = new Image();
    this.allianceIconImage.src = allianceIcon;
    this.allianceRequestBlackIconImage = new Image();
    this.allianceRequestBlackIconImage.src = allianceRequestBlackIcon;
    this.allianceRequestWhiteIconImage = new Image();
    this.allianceRequestWhiteIconImage.src = allianceRequestWhiteIcon;
    this.crownIconImage = new Image();
    this.crownIconImage.src = crownIcon;
    this.targetIconImage = new Image();
    this.targetIconImage.src = targetIcon;
    this.embargoBlackIconImage = new Image();
    this.embargoBlackIconImage.src = embargoBlackIcon;
    this.embargoWhiteIconImage = new Image();
    this.embargoWhiteIconImage.src = embargoWhiteIcon;
    this.nukeWhiteIconImage = new Image();
    this.nukeWhiteIconImage.src = nukeWhiteIcon;
    this.nukeRedIconImage = new Image();
    this.nukeRedIconImage.src = nukeRedIcon;
    this.shieldIconImage = new Image();
    this.shieldIconImage.src = shieldIcon;
    this.warIconImage = new Image();
    this.warIconImage.src = swordIconBlack;
    this.doveIconImage = new Image();
    this.doveIconImage.src = doveIcon;
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  shouldTransform(): boolean {
    return false;
  }

  redraw() {
    this.theme = this.game.config().theme();
  }

  public init() {
    this.canvas = createCanvas();
    window.addEventListener("resize", () => this.resizeCanvas());
    this.resizeCanvas();

    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.left = "50%";
    this.container.style.top = "50%";
    this.container.style.pointerEvents = "none";
    // Ensure player names render above the gameplay canvas (z-30) but below HUD overlays (z-50)
    this.container.style.zIndex = "40";
    document.body.appendChild(this.container);

    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternateViewChange(e));
  }

  private onAlternateViewChange(event: AlternateViewEvent) {
    this.isVisible = !event.alternateView;
    // Update visibility of all name elements immediately
    for (const render of this.renders) {
      this.updateElementVisibility(render);
    }
  }

  private updateElementVisibility(render: RenderInfo) {
    if (!render.player.nameLocation() || !render.player.isAlive()) {
      return;
    }

    const baseSize = Math.max(1, Math.floor(render.player.nameLocation().size));
    const size = this.transformHandler.scale * baseSize;
    const isOnScreen = render.location
      ? this.transformHandler.isOnScreen(render.location)
      : false;

    if (!this.isVisible || size < 7 || !isOnScreen) {
      render.element.style.display = "none";
    } else {
      render.element.style.display = "flex";
    }
  }

  private getAllianceProgress(
    myPlayer: PlayerView,
    otherPlayer: PlayerView,
  ): number {
    const alliances = this.game.alliances();
    const alliance = alliances.find(
      (a) =>
        (a.requestorID === myPlayer.smallID() &&
          a.recipientID === otherPlayer.smallID()) ||
        (a.recipientID === myPlayer.smallID() &&
          a.requestorID === otherPlayer.smallID()),
    );

    if (!alliance) return 0;

    const currentTick = this.game.ticks();
    const timeSinceCreation = currentTick - alliance.createdAt;
    const duration = this.game.config().allianceDuration();

    // Return 0 (fresh) to 1 (about to expire)
    return Math.min(1, Math.max(0, timeSinceCreation / duration));
  }

  public tick() {
    if (this.game.ticks() % 10 !== 0) {
      return;
    }
    const sorted = this.game
      .playerViews()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    if (sorted.length > 0) {
      this.firstPlace = sorted[0];
    }

    for (const player of this.game.playerViews()) {
      if (player.isAlive()) {
        if (!this.seenPlayers.has(player)) {
          this.seenPlayers.add(player);
          this.renders.push(
            new RenderInfo(
              player,
              0,
              null,
              0,
              "",
              this.createPlayerElement(player),
            ),
          );
        }
      }
    }
  }

  public renderLayer(mainContex: CanvasRenderingContext2D) {
    const screenPosOld = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0),
    );
    const screenPos = new Cell(
      screenPosOld.x - window.innerWidth / 2,
      screenPosOld.y - window.innerHeight / 2,
    );
    this.container.style.transform = `translate(${screenPos.x}px, ${screenPos.y}px) scale(${this.transformHandler.scale})`;

    const now = Date.now();
    if (now > this.lastChecked + this.renderCheckRate) {
      this.lastChecked = now;
      for (const render of this.renders) {
        this.renderPlayerInfo(render);
      }
    }

    mainContex.drawImage(
      this.canvas,
      0,
      0,
      mainContex.canvas.width,
      mainContex.canvas.height,
    );
  }

  private createPlayerElement(player: PlayerView): HTMLDivElement {
    const element = document.createElement("div");
    element.style.position = "absolute";
    element.style.display = "flex";
    element.style.flexDirection = "column";
    element.style.alignItems = "center";
    element.style.gap = "0px";

    const iconsDiv = document.createElement("div");
    iconsDiv.classList.add("player-icons");
    iconsDiv.style.display = "flex";
    iconsDiv.style.gap = "4px";
    iconsDiv.style.justifyContent = "center";
    iconsDiv.style.alignItems = "center";
    iconsDiv.style.zIndex = "2";
    iconsDiv.style.opacity = "0.8";
    element.appendChild(iconsDiv);

    const nameDiv = document.createElement("div");
    if (player.flag()) {
      const flagImg = document.createElement("img");
      flagImg.classList.add("player-flag");
      flagImg.style.opacity = "0.8";
      flagImg.src = "/flags/" + player.flag() + ".svg";
      flagImg.style.zIndex = "1";
      flagImg.style.aspectRatio = "3/4";
      nameDiv.appendChild(flagImg);
    }
    nameDiv.classList.add("map-player-name");
    nameDiv.style.color = this.theme.textColor(player);
    nameDiv.style.fontFamily = this.theme.font();
    nameDiv.style.whiteSpace = "nowrap";
    nameDiv.style.zIndex = "3";
    nameDiv.style.display = "flex";
    nameDiv.style.justifyContent = "center";
    nameDiv.style.alignItems = "center";

    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name-span";

    // In dev mode, show bot personality instead of name (if enabled)
    const showPersonality = this.game.config().showBotPersonalityNames();
    const pers = player.botPersonality();
    if (showPersonality && pers !== undefined) {
      nameSpan.innerHTML = getPersonalityName(pers);
    } else {
      nameSpan.innerHTML = player.name();
    }

    nameDiv.appendChild(nameSpan);
    element.appendChild(nameDiv);

    const troopsDiv = document.createElement("div");
    troopsDiv.classList.add("player-troops");
    troopsDiv.setAttribute("translate", "no");
    troopsDiv.textContent = renderTroops(player.troops());
    troopsDiv.style.color = this.theme.textColor(player);
    troopsDiv.style.fontFamily = this.theme.font();
    troopsDiv.style.zIndex = "3";
    troopsDiv.style.marginTop = "-5%";
    element.appendChild(troopsDiv);

    // if (player.type() !== PlayerType.Bot) {
    //   const shieldDiv = document.createElement("div");
    //   shieldDiv.classList.add("player-shield");
    //   shieldDiv.style.zIndex = "3";
    //   shieldDiv.style.marginTop = "-5%";
    //   shieldDiv.style.display = "flex";
    //   shieldDiv.style.alignItems = "center";
    //   shieldDiv.style.gap = "0px";
    //   const shieldImg = document.createElement("img");
    //   shieldImg.src = this.shieldIconImage.src;
    //   shieldImg.style.width = "16px";
    //   shieldImg.style.height = "16px";

    //   const shieldSpan = document.createElement("span");
    //   shieldSpan.textContent = "0";
    //   shieldSpan.style.color = "black";
    //   shieldSpan.style.fontSize = "10px";
    //   shieldSpan.style.marginTop = "-2px";

    //   shieldDiv.appendChild(shieldImg);
    //   shieldDiv.appendChild(shieldSpan);
    //   element.appendChild(shieldDiv);
    // }

    // Start off invisible so it doesn't flash at 0,0
    element.style.display = "none";

    this.container.appendChild(element);
    return element;
  }

  renderPlayerInfo(render: RenderInfo) {
    if (!render.player.nameLocation() || !render.player.isAlive()) {
      this.renders = this.renders.filter((r) => r !== render);
      render.element.remove();
      return;
    }

    const oldLocation = render.location;
    render.location = new Cell(
      render.player.nameLocation().x,
      render.player.nameLocation().y,
    );

    // Calculate base size and scale
    const baseSize = Math.max(1, Math.floor(render.player.nameLocation().size));
    render.fontSize = Math.max(4, Math.floor(baseSize * 0.4));
    render.fontColor = this.theme.textColor(render.player);

    // Update element visibility (handles Ctrl key, size, and screen position)
    this.updateElementVisibility(render);

    // If element is hidden, don't continue with rendering
    if (render.element.style.display === "none") {
      return;
    }

    // Throttle updates
    const now = Date.now();
    if (now - render.lastRenderCalc <= this.renderRefreshRate) {
      return;
    }
    render.lastRenderCalc = now + this.rand.nextInt(0, 100);

    // Update text sizes
    const nameDiv = render.element.querySelector(
      ".map-player-name",
    ) as HTMLDivElement;
    const flagDiv = render.element.querySelector(
      ".player-flag",
    ) as HTMLDivElement;
    const troopsDiv = render.element.querySelector(
      ".player-troops",
    ) as HTMLDivElement;
    nameDiv.style.fontSize = `${render.fontSize}px`;
    nameDiv.style.lineHeight = `${render.fontSize}px`;
    nameDiv.style.color = render.fontColor;
    const span = nameDiv.querySelector(".player-name-span");
    if (span) {
      // In dev mode, show bot personality instead of name (if enabled)
      const showPersonality = this.game.config().showBotPersonalityNames();
      const personality = render.player.botPersonality();
      if (showPersonality && personality !== undefined) {
        span.innerHTML = getPersonalityName(personality);
      } else {
        span.innerHTML = render.player.name();
      }
    }
    if (flagDiv) {
      flagDiv.style.height = `${render.fontSize}px`;
    }
    troopsDiv.style.fontSize = `${render.fontSize}px`;
    troopsDiv.style.color = render.fontColor;
    troopsDiv.textContent = renderTroops(render.player.troops());

    const density = renderNumber(
      render.player.troops() / render.player.numTilesOwned(),
    );
    // const shieldDiv: HTMLDivElement | null =
    //   render.element.querySelector(".player-shield");
    // const shieldImg = shieldDiv?.querySelector("img");
    // const shieldNumber = shieldDiv?.querySelector("span");
    // if (shieldImg) {
    //   shieldImg.style.width = `${render.fontSize * 0.8}px`;
    //   shieldImg.style.height = `${render.fontSize * 0.8}px`;
    // }
    // if (shieldNumber) {
    //   shieldNumber.style.fontSize = `${render.fontSize * 0.6}px`;
    //   shieldNumber.style.marginTop = `${-render.fontSize * 0.1}px`;
    //   shieldNumber.textContent = density;
    // }

    // Handle icons
    const iconsDiv = render.element.querySelector(
      ".player-icons",
    ) as HTMLDivElement;
    const iconSize = Math.min(render.fontSize * 1.5, 48);
    const myPlayer = this.game.myPlayer();
    const isDarkMode = this.userSettings.darkMode();

    // Crown icon
    const existingCrown = iconsDiv.querySelector('[data-icon="crown"]');
    if (render.player === this.firstPlace) {
      if (!existingCrown) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.crownIconImage.src,
            iconSize,
            "crown",
            false,
          ),
        );
      }
    } else if (existingCrown) {
      existingCrown.remove();
    }

    // Traitor icon
    const existingTraitor = iconsDiv.querySelector('[data-icon="traitor"]');
    if (render.player.isTraitor()) {
      if (!existingTraitor) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.traitorIconImage.src,
            iconSize,
            "traitor",
          ),
        );
      }
    } else if (existingTraitor) {
      existingTraitor.remove();
    }

    // Disconnected icon
    const existingDisconnected = iconsDiv.querySelector(
      '[data-icon="disconnected"]',
    );
    if (render.player.isDisconnected()) {
      if (!existingDisconnected) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.disconnectedIconImage.src,
            iconSize,
            "disconnected",
          ),
        );
      }
    } else if (existingDisconnected) {
      existingDisconnected.remove();
    }

    // Alliance icon
    const existingAlliance = iconsDiv.querySelector('[data-icon="alliance"]');
    const isSelf = myPlayer !== null && render.player === myPlayer;
    const isHumanOrFakeHuman =
      render.player.type() === PlayerType.Human ||
      render.player.type() === PlayerType.FakeHuman;
    if (
      !isSelf &&
      isHumanOrFakeHuman &&
      myPlayer !== null &&
      myPlayer.isAlliedWith(render.player)
    ) {
      const allianceProgress = this.getAllianceProgress(
        myPlayer,
        render.player,
      );

      if (!existingAlliance) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.allianceIconImage.src,
            iconSize,
            "alliance",
            false,
            allianceProgress,
          ),
        );
      } else {
        // Update existing alliance icon's clip-path
        const topPadding = 18.3;
        const iconHeight = 62.2;
        const drainPercent = Math.max(
          0,
          topPadding + allianceProgress * iconHeight - 0.2,
        );
        const fgSvg = (existingAlliance as HTMLElement).querySelector(
          "svg:last-child",
        );
        if (fgSvg) {
          (fgSvg as HTMLElement).style.clipPath =
            `inset(${drainPercent}% 0 0 0)`;
        }
      }
    } else if (existingAlliance) {
      existingAlliance.remove();
    }

    // War icon
    const existingWar = iconsDiv.querySelector('[data-icon="war"]');
    if (
      !isSelf &&
      isHumanOrFakeHuman &&
      myPlayer !== null &&
      myPlayer.isAtWarWith(render.player)
    ) {
      if (!existingWar) {
        iconsDiv.appendChild(
          this.createIconElement(this.warIconImage.src, iconSize, "war"),
        );
      }
    } else if (existingWar) {
      existingWar.remove();
    }

    // Neutral icon
    const existingNeutral = iconsDiv.querySelector('[data-icon="neutral"]');
    if (
      !isSelf &&
      isHumanOrFakeHuman &&
      myPlayer !== null &&
      !myPlayer.isAlliedWith(render.player) &&
      !myPlayer.isAtWarWith(render.player)
    ) {
      if (!existingNeutral) {
        iconsDiv.appendChild(
          this.createIconElement(this.doveIconImage.src, iconSize, "neutral"),
        );
      }
    } else if (existingNeutral) {
      existingNeutral.remove();
    }

    // Alliance request icon
    let existingRequestAlliance = iconsDiv.querySelector(
      '[data-icon="alliance-request"]',
    );
    const isThemeAllianceRequestIcon =
      existingRequestAlliance?.getAttribute("dark-mode") ===
      isDarkMode.toString();
    const AllianceRequestIconImageSrc = isDarkMode
      ? this.allianceRequestWhiteIconImage.src
      : this.allianceRequestBlackIconImage.src;

    if (myPlayer !== null && render.player.isRequestingAllianceWith(myPlayer)) {
      // Create new icon to match theme
      if (existingRequestAlliance && !isThemeAllianceRequestIcon) {
        existingRequestAlliance.remove();
        existingRequestAlliance = null;
      }

      if (!existingRequestAlliance) {
        iconsDiv.appendChild(
          this.createIconElement(
            AllianceRequestIconImageSrc,
            iconSize,
            "alliance-request",
          ),
        );
      }
    } else if (existingRequestAlliance) {
      existingRequestAlliance.remove();
    }

    // Target icon
    const existingTarget = iconsDiv.querySelector('[data-icon="target"]');
    if (
      myPlayer !== null &&
      new Set(myPlayer.transitiveTargets()).has(render.player)
    ) {
      if (!existingTarget) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.targetIconImage.src,
            iconSize,
            "target",
            true,
          ),
        );
      }
    } else if (existingTarget) {
      existingTarget.remove();
    }

    // Emoji handling
    const existingEmoji = iconsDiv.querySelector('[data-icon="emoji"]');
    const emojis = render.player
      .outgoingEmojis()
      .filter(
        (emoji) =>
          emoji.recipientID === AllPlayers ||
          emoji.recipientID === myPlayer?.smallID(),
      );

    if (this.game.config().userSettings()?.emojis() && emojis.length > 0) {
      if (!existingEmoji) {
        const emojiDiv = document.createElement("div");
        emojiDiv.setAttribute("data-icon", "emoji");
        emojiDiv.style.fontSize = `${iconSize}px`;
        emojiDiv.textContent = emojis[0].message;
        emojiDiv.style.position = "absolute";
        emojiDiv.style.top = "50%";
        emojiDiv.style.transform = "translateY(-50%)";
        iconsDiv.appendChild(emojiDiv);
      }
    } else if (existingEmoji) {
      existingEmoji.remove();
    }

    // Embargo icon
    let existingEmbargo = iconsDiv.querySelector('[data-icon="embargo"]');
    const hasEmbargo =
      myPlayer &&
      (render.player.hasEmbargoAgainst(myPlayer) ||
        myPlayer.hasEmbargoAgainst(render.player));
    const isThemeEmbargoIcon =
      existingEmbargo?.getAttribute("dark-mode") === isDarkMode.toString();
    const embargoIconImageSrc = isDarkMode
      ? this.embargoWhiteIconImage.src
      : this.embargoBlackIconImage.src;

    if (myPlayer && hasEmbargo) {
      // Create new icon to match theme
      if (existingEmbargo && !isThemeEmbargoIcon) {
        existingEmbargo.remove();
        existingEmbargo = null;
      }

      if (!existingEmbargo) {
        iconsDiv.appendChild(
          this.createIconElement(embargoIconImageSrc, iconSize, "embargo"),
        );
      }
    } else if (existingEmbargo) {
      existingEmbargo.remove();
    }

    const nukesSentByOtherPlayer = this.game.units().filter((unit) => {
      const isSendingNuke = render.player.id() === unit.owner().id();
      const notMyPlayer = !myPlayer || unit.owner().id() !== myPlayer.id();
      return (
        nukeTypes.includes(unit.type()) &&
        isSendingNuke &&
        notMyPlayer &&
        unit.isActive()
      );
    });
    const isMyPlayerTarget = nukesSentByOtherPlayer.find((unit) => {
      const detonationDst = unit.targetTile();
      if (detonationDst === undefined) return false;
      const targetId = this.game.owner(detonationDst).id();
      return myPlayer && targetId === myPlayer.id();
    });
    const existingNuke = iconsDiv.querySelector(
      '[data-icon="nuke"]',
    ) as HTMLImageElement;

    if (existingNuke) {
      if (nukesSentByOtherPlayer.length === 0) {
        existingNuke.remove();
      } else if (
        isMyPlayerTarget &&
        existingNuke.src !== this.nukeRedIconImage.src
      ) {
        existingNuke.src = this.nukeRedIconImage.src;
      } else if (
        !isMyPlayerTarget &&
        existingNuke.src !== this.nukeWhiteIconImage.src
      ) {
        existingNuke.src = this.nukeWhiteIconImage.src;
      }
    } else if (nukesSentByOtherPlayer.length > 0) {
      if (!existingNuke) {
        const icon = isMyPlayerTarget
          ? this.nukeRedIconImage.src
          : this.nukeWhiteIconImage.src;
        iconsDiv.appendChild(this.createIconElement(icon, iconSize, "nuke"));
      }
    }

    // Position element with scale
    if (render.location && render.location !== oldLocation) {
      const scale = Math.min(baseSize * 0.25, 3);
      render.element.style.transform = `translate(${render.location.x}px, ${render.location.y}px) translate(-50%, -50%) scale(${scale})`;
    }
  }

  private createIconElement(
    src: string,
    size: number,
    id: string,
    center: boolean = false,
    allianceProgress?: number,
  ): HTMLElement {
    // Make war icon 20% smaller
    const actualSize = id === "war" ? size * 0.8 : size;

    if (id === "alliance" && allianceProgress !== undefined) {
      // Create container for two-layer alliance icon
      const container = document.createElement("div");
      container.style.position = "relative";
      container.style.width = `${actualSize}px`;
      container.style.height = `${actualSize}px`;
      container.setAttribute("data-icon", id);
      container.setAttribute(
        "dark-mode",
        this.userSettings.darkMode().toString(),
      );

      // SVG viewBox is 834x834, but actual icon spans roughly y=153 to y=672
      // Top padding: ~18.3%, Icon: ~62.2%, Bottom padding: ~19.5%
      const topPadding = 18.3;
      const iconHeight = 62.2;
      // Subtract 0.2% to ensure complete coverage and avoid edge artifacts
      const drainPercent = Math.max(
        0,
        topPadding + allianceProgress * iconHeight - 0.2,
      );

      // Dynamic stroke width based on icon size to prevent edge artifacts
      const bgStrokeWidth =
        actualSize < 32 ? "8" : actualSize < 42 ? "8.5" : "9";
      const fgStrokeWidth =
        actualSize < 32 ? "8.5" : actualSize < 42 ? "9" : "9.5";

      // SVG with built-in stroke
      const svgNS = "http://www.w3.org/2000/svg";

      // Background SVG: light matte green (unloaded state)
      const bgSvg = document.createElementNS(svgNS, "svg");
      bgSvg.setAttribute("viewBox", "0 0 834 834");
      bgSvg.setAttribute("shape-rendering", "geometricPrecision");
      bgSvg.style.width = `${actualSize}px`;
      bgSvg.style.height = `${actualSize}px`;
      bgSvg.style.position = "absolute";
      bgSvg.style.top = "0";
      bgSvg.style.left = "0";
      bgSvg.style.overflow = "visible";
      bgSvg.style.willChange = "transform";
      bgSvg.innerHTML = `
        <g stroke="rgba(0,0,0,0.7)" stroke-width="${bgStrokeWidth}">
          <path fill="#b8e6a8" d="M -0.5,397.5 C -0.5,395.833 -0.5,394.167 -0.5,392.5C 44.6795,312.648 90.0129,232.815 135.5,153C 137.167,152.333 138.833,152.333 140.5,153C 161.252,165.458 181.752,178.291 202,191.5C 202.638,192.609 203.138,193.775 203.5,195C 159.14,275.555 114.14,355.722 68.5,435.5C 65.4383,437.997 62.4383,437.83 59.5,435C 39.3038,422.739 19.3038,410.239 -0.5,397.5 Z"/>
          <path fill="#b8e6a8" d="M 833.5,392.5 C 833.5,394.167 833.5,395.833 833.5,397.5C 812.262,411.707 790.429,425.041 768,437.5C 766.715,437.05 765.548,436.383 764.5,435.5C 718.86,355.722 673.86,275.555 629.5,195C 630.083,192.501 631.416,190.501 633.5,189C 653.333,177.251 673,165.251 692.5,153C 694.167,152.333 695.833,152.333 697.5,153C 742.987,232.815 788.32,312.648 833.5,392.5 Z"/>
          <path fill="#b8e6a8" d="M 432.5,217.5 C 454.565,216.918 476.565,217.751 498.5,220C 526.867,225.508 555.2,231.175 583.5,237C 589.167,237.667 594.833,237.667 600.5,237C 610.347,235.451 620.014,233.451 629.5,231C 665.047,292.944 699.88,355.11 734,417.5C 723.137,428.697 711.971,439.53 700.5,450C 693.085,455.46 685.252,460.293 677,464.5C 597.446,397.776 511.279,340.609 418.5,293C 414.302,290.486 409.802,288.653 405,287.5C 390.991,291.461 377.158,295.961 363.5,301C 349.788,321.712 332.455,338.712 311.5,352C 297.958,359.51 283.458,363.677 268,364.5C 264.417,363.942 260.917,363.109 257.5,362C 255.418,359.591 254.418,356.757 254.5,353.5C 255.061,347.256 256.561,341.256 259,335.5C 280.319,301.023 303.486,267.856 328.5,236C 339.522,230.327 351.188,226.66 363.5,225C 386.537,221.431 409.537,218.931 432.5,217.5 Z"/>
          <path fill="#b8e6a8" d="M 201.5,232.5 C 211.945,238.224 222.612,243.724 233.5,249C 252.001,253.528 270.668,257.195 289.5,260C 272.05,283.055 256.217,307.222 242,332.5C 230.84,367.414 243.34,383.247 279.5,380C 296.864,377.547 312.864,371.547 327.5,362C 345.877,349.29 361.21,333.624 373.5,315C 384.249,310.745 395.249,307.745 406.5,306C 473.343,338.897 536.343,377.564 595.5,422C 620.377,440.276 644.71,459.276 668.5,479C 685.816,495.374 685.816,511.708 668.5,528C 658.279,533.794 647.612,534.794 636.5,531C 591.897,504.053 547.064,477.553 502,451.5C 492.799,454.525 491.299,459.691 497.5,467C 539.083,492.041 580.583,517.208 622,542.5C 625.242,566.905 614.742,580.405 590.5,583C 586.167,583.667 581.833,583.667 577.5,583C 541.33,561.747 504.997,540.747 468.5,520C 459.972,519.844 456.805,524.011 459,532.5C 494.337,554.004 530.004,575.004 566,595.5C 567.107,607.85 563.274,618.35 554.5,627C 551.052,628.927 547.385,630.261 543.5,631C 534.78,631.839 526.113,631.505 517.5,630C 489.289,616.061 460.955,602.394 432.5,589C 422.952,588.253 419.785,592.42 423,601.5C 423.833,602.333 424.667,603.167 425.5,604C 453.042,616.955 480.375,630.289 507.5,644C 490.599,668.862 467.432,677.362 438,669.5C 419.079,665.812 400.579,660.645 382.5,654C 399.437,634.309 400.937,613.476 387,591.5C 376.531,578.176 363.031,571.843 346.5,572.5C 348.341,546.672 337.675,528.172 314.5,517C 308.736,514.786 302.903,513.953 297,514.5C 299.293,484.475 286.127,464.975 257.5,456C 241.526,453.323 228.359,458.157 218,470.5C 215.027,474.974 211.86,479.307 208.5,483.5C 194.849,452.501 172.182,442.668 140.5,454C 136.682,457.185 133.015,460.185 129.5,463C 118.644,448.964 107.31,435.298 95.5,422C 131.491,359.182 166.824,296.016 201.5,232.5 Z"/>
          <path fill="#b8e6a8" d="M 158.5,464.5 C 175.508,465.009 186.675,473.342 192,489.5C 193.31,496.871 192.31,503.871 189,510.5C 181.527,520.607 173.694,530.44 165.5,540C 147.399,546.072 133.899,540.572 125,523.5C 121.399,514.654 121.733,505.988 126,497.5C 133.473,487.393 141.306,477.56 149.5,468C 152.571,466.704 155.571,465.538 158.5,464.5 Z"/>
          <path fill="#b8e6a8" d="M 246.5,471.5 C 271.231,474.34 282.064,488.007 279,512.5C 260.055,539.779 240.721,566.779 221,593.5C 210.288,603.218 198.788,604.052 186.5,596C 174.201,586.578 170.035,574.412 174,559.5C 193.728,531.104 214.228,503.271 235.5,476C 239.053,473.879 242.72,472.379 246.5,471.5 Z"/>
          <path fill="#b8e6a8" d="M 293.5,530.5 C 312.401,530.236 324.234,539.236 329,557.5C 330.405,564.717 329.071,571.384 325,577.5C 309.833,598 294.667,618.5 279.5,639C 259.89,647.459 245.39,641.959 236,622.5C 232.774,615.487 232.774,608.487 236,601.5C 251.422,579.657 267.088,557.99 283,536.5C 286.101,533.648 289.601,531.648 293.5,530.5 Z"/>
          <path fill="#b8e6a8" d="M 344.5,588.5 C 368.069,589.569 379.902,601.902 380,625.5C 379.144,629.544 377.478,633.211 375,636.5C 366.09,647.988 357.423,659.655 349,671.5C 339.128,681.673 327.961,683.173 315.5,676C 301.764,666.368 297.264,653.535 302,637.5C 313.116,622.049 324.616,606.883 336.5,592C 339.309,590.907 341.976,589.74 344.5,588.5 Z"/>
        </g>
      `;
      container.appendChild(bgSvg);

      // Foreground SVG: bright green (loaded state) that drains
      const fgSvg = document.createElementNS(svgNS, "svg");
      fgSvg.setAttribute("viewBox", "0 0 834 834");
      fgSvg.setAttribute("shape-rendering", "geometricPrecision");
      fgSvg.style.width = `${actualSize}px`;
      fgSvg.style.height = `${actualSize}px`;
      fgSvg.style.position = "absolute";
      fgSvg.style.top = "0";
      fgSvg.style.left = "0";
      fgSvg.style.overflow = "visible";
      fgSvg.style.clipPath = `inset(${drainPercent}% 0 0 0)`;
      fgSvg.style.transition = "clip-path 0.5s ease-out";
      fgSvg.style.willChange = "clip-path, transform";
      fgSvg.innerHTML = `
        <g stroke="rgba(0,0,0,0.7)" stroke-width="${fgStrokeWidth}">
          <path fill="#2da015" d="M -0.5,397.5 C -0.5,395.833 -0.5,394.167 -0.5,392.5C 44.6795,312.648 90.0129,232.815 135.5,153C 137.167,152.333 138.833,152.333 140.5,153C 161.252,165.458 181.752,178.291 202,191.5C 202.638,192.609 203.138,193.775 203.5,195C 159.14,275.555 114.14,355.722 68.5,435.5C 65.4383,437.997 62.4383,437.83 59.5,435C 39.3038,422.739 19.3038,410.239 -0.5,397.5 Z"/>
          <path fill="#2da015" d="M 833.5,392.5 C 833.5,394.167 833.5,395.833 833.5,397.5C 812.262,411.707 790.429,425.041 768,437.5C 766.715,437.05 765.548,436.383 764.5,435.5C 718.86,355.722 673.86,275.555 629.5,195C 630.083,192.501 631.416,190.501 633.5,189C 653.333,177.251 673,165.251 692.5,153C 694.167,152.333 695.833,152.333 697.5,153C 742.987,232.815 788.32,312.648 833.5,392.5 Z"/>
          <path fill="#2da015" d="M 432.5,217.5 C 454.565,216.918 476.565,217.751 498.5,220C 526.867,225.508 555.2,231.175 583.5,237C 589.167,237.667 594.833,237.667 600.5,237C 610.347,235.451 620.014,233.451 629.5,231C 665.047,292.944 699.88,355.11 734,417.5C 723.137,428.697 711.971,439.53 700.5,450C 693.085,455.46 685.252,460.293 677,464.5C 597.446,397.776 511.279,340.609 418.5,293C 414.302,290.486 409.802,288.653 405,287.5C 390.991,291.461 377.158,295.961 363.5,301C 349.788,321.712 332.455,338.712 311.5,352C 297.958,359.51 283.458,363.677 268,364.5C 264.417,363.942 260.917,363.109 257.5,362C 255.418,359.591 254.418,356.757 254.5,353.5C 255.061,347.256 256.561,341.256 259,335.5C 280.319,301.023 303.486,267.856 328.5,236C 339.522,230.327 351.188,226.66 363.5,225C 386.537,221.431 409.537,218.931 432.5,217.5 Z"/>
          <path fill="#2da015" d="M 201.5,232.5 C 211.945,238.224 222.612,243.724 233.5,249C 252.001,253.528 270.668,257.195 289.5,260C 272.05,283.055 256.217,307.222 242,332.5C 230.84,367.414 243.34,383.247 279.5,380C 296.864,377.547 312.864,371.547 327.5,362C 345.877,349.29 361.21,333.624 373.5,315C 384.249,310.745 395.249,307.745 406.5,306C 473.343,338.897 536.343,377.564 595.5,422C 620.377,440.276 644.71,459.276 668.5,479C 685.816,495.374 685.816,511.708 668.5,528C 658.279,533.794 647.612,534.794 636.5,531C 591.897,504.053 547.064,477.553 502,451.5C 492.799,454.525 491.299,459.691 497.5,467C 539.083,492.041 580.583,517.208 622,542.5C 625.242,566.905 614.742,580.405 590.5,583C 586.167,583.667 581.833,583.667 577.5,583C 541.33,561.747 504.997,540.747 468.5,520C 459.972,519.844 456.805,524.011 459,532.5C 494.337,554.004 530.004,575.004 566,595.5C 567.107,607.85 563.274,618.35 554.5,627C 551.052,628.927 547.385,630.261 543.5,631C 534.78,631.839 526.113,631.505 517.5,630C 489.289,616.061 460.955,602.394 432.5,589C 422.952,588.253 419.785,592.42 423,601.5C 423.833,602.333 424.667,603.167 425.5,604C 453.042,616.955 480.375,630.289 507.5,644C 490.599,668.862 467.432,677.362 438,669.5C 419.079,665.812 400.579,660.645 382.5,654C 399.437,634.309 400.937,613.476 387,591.5C 376.531,578.176 363.031,571.843 346.5,572.5C 348.341,546.672 337.675,528.172 314.5,517C 308.736,514.786 302.903,513.953 297,514.5C 299.293,484.475 286.127,464.975 257.5,456C 241.526,453.323 228.359,458.157 218,470.5C 215.027,474.974 211.86,479.307 208.5,483.5C 194.849,452.501 172.182,442.668 140.5,454C 136.682,457.185 133.015,460.185 129.5,463C 118.644,448.964 107.31,435.298 95.5,422C 131.491,359.182 166.824,296.016 201.5,232.5 Z"/>
          <path fill="#2da015" d="M 158.5,464.5 C 175.508,465.009 186.675,473.342 192,489.5C 193.31,496.871 192.31,503.871 189,510.5C 181.527,520.607 173.694,530.44 165.5,540C 147.399,546.072 133.899,540.572 125,523.5C 121.399,514.654 121.733,505.988 126,497.5C 133.473,487.393 141.306,477.56 149.5,468C 152.571,466.704 155.571,465.538 158.5,464.5 Z"/>
          <path fill="#2da015" d="M 246.5,471.5 C 271.231,474.34 282.064,488.007 279,512.5C 260.055,539.779 240.721,566.779 221,593.5C 210.288,603.218 198.788,604.052 186.5,596C 174.201,586.578 170.035,574.412 174,559.5C 193.728,531.104 214.228,503.271 235.5,476C 239.053,473.879 242.72,472.379 246.5,471.5 Z"/>
          <path fill="#2da015" d="M 293.5,530.5 C 312.401,530.236 324.234,539.236 329,557.5C 330.405,564.717 329.071,571.384 325,577.5C 309.833,598 294.667,618.5 279.5,639C 259.89,647.459 245.39,641.959 236,622.5C 232.774,615.487 232.774,608.487 236,601.5C 251.422,579.657 267.088,557.99 283,536.5C 286.101,533.648 289.601,531.648 293.5,530.5 Z"/>
          <path fill="#2da015" d="M 344.5,588.5 C 368.069,589.569 379.902,601.902 380,625.5C 379.144,629.544 377.478,633.211 375,636.5C 366.09,647.988 357.423,659.655 349,671.5C 339.128,681.673 327.961,683.173 315.5,676C 301.764,666.368 297.264,653.535 302,637.5C 313.116,622.049 324.616,606.883 336.5,592C 339.309,590.907 341.976,589.74 344.5,588.5 Z"/>
        </g>
      `;
      container.appendChild(fgSvg);

      return container;
    }

    const icon = document.createElement("img");
    icon.style.width = `${actualSize}px`;
    icon.style.height = `${actualSize}px`;
    icon.setAttribute("data-icon", id);
    icon.setAttribute("dark-mode", this.userSettings.darkMode().toString());

    if (id === "war") {
      // Use CSS mask with exact warColor #8B0000 from radial menu
      // Set transparent 1x1 image as src to maintain dimensions
      icon.src =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
      icon.style.backgroundColor = "#8B0000";
      icon.style.webkitMaskImage = `url(${src})`;
      icon.style.maskImage = `url(${src})`;
      icon.style.webkitMaskSize = "contain";
      icon.style.maskSize = "contain";
      icon.style.webkitMaskRepeat = "no-repeat";
      icon.style.maskRepeat = "no-repeat";
      icon.style.webkitMaskPosition = "center";
      icon.style.maskPosition = "center";
    } else {
      icon.src = src;
    }

    if (center) {
      icon.style.position = "absolute";
      icon.style.top = "50%";
      icon.style.transform = "translateY(-50%)";
    }
    return icon;
  }
}
