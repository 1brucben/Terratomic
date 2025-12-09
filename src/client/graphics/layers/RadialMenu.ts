import * as d3 from "d3";
import doveIcon from "../../../../proprietary/images/dove.png";
import warIcon from "../../../../proprietary/images/waricon.png";
import airAttackIcon from "../../../../resources/images/AirAttackIconWhite.svg";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import boatIcon from "../../../../resources/images/BoatIconWhite.svg";
import disabledIcon from "../../../../resources/images/DisabledIcon.svg";
import infoIcon from "../../../../resources/images/InfoIcon.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import {
  Cell,
  PlayerActions,
  PlayerType,
  TerraNullius,
  UnitType,
  UpgradeType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
} from "../../InputHandler";
import {
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDeclareWarIntentEvent,
  SendParatrooperAttackIntentEvent,
  SendPeaceRequestIntentEvent,
  SendSpawnIntentEvent,
} from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerPanel } from "./PlayerPanel";

enum Slot {
  Info,
  Boat,
  Ally,
  Peace,
  AirAttack,
}

export class RadialMenu implements Layer {
  layerName = "RadialMenu";
  private clickedCell: Cell | null = null;
  private lastClosed: number = 0;

  private originalTileOwner: PlayerView | TerraNullius;
  private menuElement: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  private isVisible: boolean = false;
  private readonly menuItems: Map<
    Slot,
    {
      name: string;
      disabled: boolean;
      action: () => void;
      color?: string | null;
      icon?: string | null;
    }
  > = new Map([
    [
      Slot.Boat,
      {
        name: "boat",
        disabled: true,
        action: () => {},
        color: null,
        icon: null,
      },
    ],
    [
      Slot.AirAttack,
      {
        name: "airAttack",
        disabled: true,
        action: () => {},
        color: null,
        icon: null,
      },
    ],
    [
      Slot.Info,
      {
        name: "info",
        disabled: true,
        action: () => {},
        color: null,
        icon: null,
      },
    ],
    [Slot.Ally, { name: "ally", disabled: true, action: () => {} }],
    [
      Slot.Peace,
      {
        name: "peace",
        // Disabled by default; enabled when canRequestPeace is true
        disabled: true,
        action: () => {},
        // Color is set when activated via activateMenuElement; keep null by default
        color: null,
        icon: doveIcon,
      },
    ],
  ]);

  private readonly menuSize = 190;
  private readonly centerButtonSize = 30;
  private readonly iconSize = 32;
  private readonly centerIconSize = 48;
  private readonly disabledColor = d3.rgb(128, 128, 128).toString();
  // Scale factor specifically for the Peace (dove) icon relative to iconSize
  private readonly peaceIconScale = 1.2;

  private isCenterButtonEnabled = false;

  constructor(
    private eventBus: EventBus,
    private g: GameView,
    private transformHandler: TransformHandler,
    private emojiTable: EmojiTable,
    private uiState: UIState,
    private playerInfoOverlay: PlayerInfoOverlay,
    private playerPanel: PlayerPanel,
  ) {}

  init() {
    this.eventBus.on(ContextMenuEvent, (e) => this.onContextMenu(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onPointerUp(e));
    this.eventBus.on(CloseViewEvent, () => this.closeMenu());

    this.createMenuElement();
  }

  private closeMenu() {
    if (this.isVisible) {
      this.hideRadialMenu();
    }
  }

  private createMenuElement() {
    this.menuElement = d3
      .select(document.body)
      .append("div")
      .style("position", "fixed")
      .style("display", "none")
      .style("z-index", "9999")
      .style("touch-action", "none")
      .on("contextmenu", (e) => {
        e.preventDefault();
        this.hideRadialMenu();
      });

    const svg = this.menuElement
      .append("svg")
      .attr("width", this.menuSize)
      .attr("height", this.menuSize)
      .append("g")
      .attr(
        "transform",
        `translate(${this.menuSize / 2},${this.menuSize / 2})`,
      );

    const pie = d3
      .pie<any>()
      .value(() => 1)
      .padAngle(0.03);

    const arc = d3
      .arc<any>()
      .innerRadius(this.centerButtonSize + 5)
      .outerRadius(this.menuSize / 2 - 10);

    const arcs = svg
      .selectAll("path")
      .data(pie(Array.from(this.menuItems.values())))
      .enter()
      .append("g");

    arcs
      .append("path")
      .attr("d", arc)
      .attr("fill", (d) =>
        d.data.disabled ? this.disabledColor : d.data.color,
      )
      .attr("stroke", "#ffffff")
      .attr("stroke-width", "2")
      .style("cursor", (d) => (d.data.disabled ? "not-allowed" : "pointer"))
      .style("opacity", (d) => (d.data.disabled ? 0.5 : 1))
      .attr("data-name", (d) => d.data.name)
      .on("mouseover", function (event, d) {
        if (!d.data.disabled) {
          d3.select(this)
            .transition()
            .duration(200)
            .attr("transform", "scale(1.05)")
            .attr("filter", "url(#glow)");
        }
      })
      .on("mouseout", function (event, d) {
        if (!d.data.disabled) {
          d3.select(this)
            .transition()
            .duration(200)
            .attr("transform", "scale(1)")
            .attr("filter", null);
        }
      })
      .on("click", (event, d) => {
        if (!d.data.disabled) {
          d.data.action();
          this.hideRadialMenu();
        }
      })
      .on("touchstart", (event, d) => {
        event.preventDefault();
        if (!d.data.disabled) {
          d.data.action();
          this.hideRadialMenu();
        }
      });

    arcs
      .append("image")
      .attr("xlink:href", (d) => d.data.icon)
      .attr("width", (d) =>
        d.data.name === "peace" && !d.data.disabled
          ? this.iconSize * this.peaceIconScale
          : this.iconSize,
      )
      .attr("height", (d) =>
        d.data.name === "peace" && !d.data.disabled
          ? this.iconSize * this.peaceIconScale
          : this.iconSize,
      )
      .attr("x", (d) => {
        const w =
          d.data.name === "peace" && !d.data.disabled
            ? this.iconSize * this.peaceIconScale
            : this.iconSize;
        // Offset both peace and war icons when enabled
        const offset = d.data.name === "peace" && !d.data.disabled ? 2 : 0;
        return arc.centroid(d)[0] - w / 2 + offset;
      })
      .attr("y", (d) => {
        const h =
          d.data.name === "peace" && !d.data.disabled
            ? this.iconSize * this.peaceIconScale
            : this.iconSize;
        // Offset both peace and war icons when enabled
        const offset = d.data.name === "peace" && !d.data.disabled ? 2 : 0;
        return arc.centroid(d)[1] - h / 2 + offset;
      })
      .style("pointer-events", "none")
      .attr("data-name", (d) => d.data.name);

    // (Removed text label rendering for radial items)

    // Add glow filter
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    const centerButton = svg.append("g").attr("class", "center-button");

    centerButton
      .append("circle")
      .attr("class", "center-button-hitbox")
      .attr("r", this.centerButtonSize)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("click", () => this.handleCenterButtonClick())
      .on("touchstart", (event: Event) => {
        event.preventDefault();
        this.handleCenterButtonClick();
      })
      .on("mouseover", () => this.onCenterButtonHover(true))
      .on("mouseout", () => this.onCenterButtonHover(false));

    centerButton
      .append("circle")
      .attr("class", "center-button-visible")
      .attr("r", this.centerButtonSize)
      .attr("fill", "#2c3e50")
      .style("pointer-events", "none");

    centerButton
      .append("image")
      .attr("class", "center-button-icon")
      .attr("xlink:href", swordIcon)
      .attr("width", this.centerIconSize)
      .attr("height", this.centerIconSize)
      .attr("x", -this.centerIconSize / 2)
      .attr("y", -this.centerIconSize / 2)
      .style("pointer-events", "none");
  }

  async tick() {
    // Only update when menu is visible
    if (!this.isVisible || this.clickedCell === null) return;
    const myPlayer = this.g.myPlayer();
    if (myPlayer === null || !myPlayer.isAlive()) return;
    const tile = this.g.ref(this.clickedCell.x, this.clickedCell.y);
    if (this.originalTileOwner.isPlayer()) {
      if (this.g.owner(tile) !== this.originalTileOwner) {
        this.closeMenu();
        return;
      }
    } else {
      if (this.g.owner(tile).isPlayer() ?? this.g.owner(tile) === myPlayer) {
        this.closeMenu();
        return;
      }
    }
    const actions = await myPlayer.actions(tile);
    this.disableAllButtons();
    this.handlePlayerActions(myPlayer, actions, tile);
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // No need to render anything on the canvas
  }

  shouldTransform(): boolean {
    return false;
  }

  private onContextMenu(event: ContextMenuEvent) {
    if (this.lastClosed + 200 > new Date().getTime()) return;
    if (this.isVisible) {
      this.hideRadialMenu();
      return;
    } else {
      this.showRadialMenu(event.x, event.y);
    }
    this.disableAllButtons();
    this.clickedCell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.g.isValidCoord(this.clickedCell.x, this.clickedCell.y)) {
      return;
    }
    const tile = this.g.ref(this.clickedCell.x, this.clickedCell.y);
    this.originalTileOwner = this.g.owner(tile);
    if (this.g.inSpawnPhase()) {
      if (this.g.isLand(tile) && !this.g.hasOwner(tile)) {
        this.enableCenterButton(true);
      }
      return;
    }

    const myPlayer = this.g.myPlayer();
    if (myPlayer === null) {
      console.warn("my player not found");
      return;
    }
    if (myPlayer && !myPlayer.isAlive() && !this.g.inSpawnPhase()) {
      return this.hideRadialMenu();
    }
    myPlayer.actions(tile).then((actions) => {
      this.handlePlayerActions(myPlayer, actions, tile);
    });
  }

  private handlePlayerActions(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
  ) {
    if (this.g.hasOwner(tile)) {
      this.activateMenuElement(Slot.Info, "#64748B", infoIcon, () => {
        this.playerPanel.show(actions, tile);
      });
    }

    if (actions?.interaction?.canSendAllianceRequest) {
      this.activateMenuElement(Slot.Ally, "#53ac75", allianceIcon, () => {
        this.eventBus.emit(
          new SendAllianceRequestIntentEvent(
            myPlayer,
            this.g.owner(tile) as PlayerView,
          ),
        );
      });
    }
    if (actions?.interaction?.canBreakAlliance) {
      this.activateMenuElement(Slot.Ally, "#c74848", traitorIcon, () => {
        this.eventBus.emit(
          new SendBreakAllianceIntentEvent(
            myPlayer,
            this.g.owner(tile) as PlayerView,
          ),
        );
      });
    }
    if (actions?.interaction?.canRequestPeace) {
      // Use light gray to match the intended neutral/diplomatic styling
      this.activateMenuElement(Slot.Peace, "#e5e7eb", doveIcon, () => {
        this.eventBus.emit(
          new SendPeaceRequestIntentEvent(
            myPlayer,
            this.g.owner(tile) as PlayerView,
          ),
        );
      });
    }
    if (actions?.interaction?.canDeclareWar) {
      // Use dark red for war declaration
      this.activateMenuElement(Slot.Peace, "#8B0000", warIcon, () => {
        this.eventBus.emit(
          new SendDeclareWarIntentEvent(
            myPlayer,
            this.g.owner(tile) as PlayerView,
          ),
        );
      });
    }
    if (
      actions.buildableUnits.find((bu) => bu.type === UnitType.TransportShip)
        ?.canBuild
    ) {
      this.activateMenuElement(Slot.Boat, "#3f6ab1", boatIcon, () => {
        // BestTransportShipSpawn is an expensive operation, so
        // we calculate it here and send the spawn tile to other clients.
        myPlayer.bestTransportShipSpawn(tile).then((spawn) => {
          let spawnTile: Cell | null = null;
          if (spawn !== false) {
            spawnTile = new Cell(this.g.x(spawn), this.g.y(spawn));
          }

          if (this.clickedCell === null) return;

          const dst = this.g.ref(this.clickedCell.x, this.clickedCell.y);
          const src = spawnTile ? this.g.ref(spawnTile.x, spawnTile.y) : null;
          this.eventBus.emit(
            new SendBoatAttackIntentEvent(
              this.g.owner(tile).id(),
              dst,
              this.uiState.attackRatio * myPlayer.troops(),
              src,
            ),
          );
        });
      });
    }
    if (actions.canAttack) {
      this.enableCenterButton(true);
    }

    if (this.shouldShowAirAttack(myPlayer, tile)) {
      this.activateMenuElement(Slot.AirAttack, "#8B0000", airAttackIcon, () => {
        if (this.clickedCell === null) return;
        const dst = this.g.ref(this.clickedCell.x, this.clickedCell.y);
        this.eventBus.emit(
          new SendParatrooperAttackIntentEvent(
            this.g.owner(tile).id(),
            dst,
            this.uiState.attackRatio * myPlayer.troops(),
          ),
        );
      });
    }

    if (!this.g.hasOwner(tile)) {
      return;
    }
  }

  private shouldShowAirAttack(player: PlayerView, tile: TileRef): boolean {
    if (!player.hasUpgrade(UpgradeType.AirUpgrade1)) {
      return false;
    }
    if (player.units(UnitType.Airfield).length === 0) {
      return false;
    }
    if (!this.g.isLand(tile)) {
      return false;
    }
    const owner = this.g.owner(tile);
    if (owner === player) {
      return false;
    }

    const peaceTimerEndsAtTick = this.g.peaceTimerEndsAtTick();
    const isPeaceTimerActive =
      peaceTimerEndsAtTick !== null && this.g.ticks() < peaceTimerEndsAtTick;

    if (isPeaceTimerActive && owner.isPlayer()) {
      const attackerType = player.type();
      const defenderType = (owner as PlayerView).type();

      if (
        (attackerType === PlayerType.Human ||
          attackerType === PlayerType.FakeHuman) &&
        (defenderType === PlayerType.Human ||
          defenderType === PlayerType.FakeHuman)
      ) {
        return false;
      }
    }

    if (
      owner.isPlayer &&
      owner.isPlayer() &&
      player.isFriendly(owner as PlayerView)
    ) {
      return false;
    }

    const airfields = player.units(UnitType.Airfield);
    const closestAirfield = airfields.reduce(
      (closest, airfield) => {
        const dist = this.g.manhattanDist(airfield.tile(), tile);
        if (dist < closest.dist) {
          return { airfield, dist };
        }
        return closest;
      },
      { airfield: null, dist: Infinity },
    );

    if (closestAirfield.dist > this.g.config().paratrooperMaxRange()) {
      return false;
    }

    return true;
  }

  private onPointerUp(event: MouseUpEvent) {
    this.hideRadialMenu();
    this.emojiTable.hideTable();
    this.playerInfoOverlay.hide();
  }

  private showRadialMenu(x: number, y: number) {
    // Delay so center button isn't clicked immediately on press.
    setTimeout(() => {
      this.menuElement
        .style("left", `${x - this.menuSize / 2}px`)
        .style("top", `${y - this.menuSize / 2}px`)
        .style("display", "block");
      this.playerInfoOverlay.maybeShow(x, y);
      this.isVisible = true;
    }, 50);
  }

  private hideRadialMenu() {
    this.menuElement.style("display", "none");
    this.isVisible = false;
    this.playerInfoOverlay.hide();
    this.lastClosed = new Date().getTime();
  }

  private handleCenterButtonClick() {
    if (!this.isCenterButtonEnabled) {
      return;
    }
    console.log("Center button clicked");
    if (this.clickedCell === null) return;
    const clicked = this.g.ref(this.clickedCell.x, this.clickedCell.y);
    if (this.g.inSpawnPhase()) {
      this.eventBus.emit(new SendSpawnIntentEvent(clicked));
    } else {
      const myPlayer = this.g.myPlayer();
      if (myPlayer !== null && this.g.owner(clicked) !== myPlayer) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.g.owner(clicked).id(),
            this.uiState.attackRatio * myPlayer.troops(),
          ),
        );
      }
    }
    this.hideRadialMenu();
  }

  private disableAllButtons() {
    this.enableCenterButton(false);
    for (const [slot, item] of this.menuItems.entries()) {
      // Disable everything by default; specific buttons get enabled by activateMenuElement()
      item.disabled = true;
      this.updateMenuItemState(item);
    }
  }

  private activateMenuElement(
    slot: Slot,
    color: string,
    icon: string,
    action: () => void,
  ) {
    const menuItem = this.menuItems.get(slot);
    if (menuItem === undefined) return;
    menuItem.action = action;
    menuItem.disabled = false;
    menuItem.color = color;
    menuItem.icon = icon;
    this.updateMenuItemState(menuItem);
  }

  private updateMenuItemState(item: any) {
    const menuItem = this.menuElement.select(`path[data-name="${item.name}"]`);
    menuItem
      .attr("fill", item.disabled ? this.disabledColor : item.color)
      .style("cursor", item.disabled ? "not-allowed" : "pointer")
      .style("opacity", item.disabled ? 0.5 : 1);

    this.menuElement
      .select(`image[data-name="${item.name}"]`)
      .attr("xlink:href", item.disabled ? disabledIcon : item.icon)
      .attr("fill", item.disabled ? "#999999" : "white");
  }

  private onCenterButtonHover(isHovering: boolean) {
    if (!this.isCenterButtonEnabled) return;

    const scale = isHovering ? 1.2 : 1;
    const fontSize = isHovering ? "18px" : "16px";

    this.menuElement
      .select(".center-button-hitbox")
      .transition()
      .duration(200)
      .attr("r", this.centerButtonSize * scale);
    this.menuElement
      .select(".center-button-visible")
      .transition()
      .duration(200)
      .attr("r", this.centerButtonSize * scale);
    this.menuElement
      .select(".center-button-text")
      .transition()
      .duration(200)
      .style("font-size", fontSize);
  }

  private enableCenterButton(enabled: boolean) {
    this.isCenterButtonEnabled = enabled;
    const centerButton = this.menuElement.select(".center-button");

    centerButton
      .select(".center-button-hitbox")
      .style("cursor", enabled ? "pointer" : "not-allowed");

    centerButton
      .select(".center-button-visible")
      .attr("fill", enabled ? "#2c3e50" : "#999999");

    centerButton
      .select(".center-button-text")
      .attr("fill", enabled ? "white" : "#cccccc");
  }
}
