import { LitElement, TemplateResult, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import {
  PlayerProfile,
  PlayerType,
  Relation,
  Unit,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { MouseMoveEvent } from "../../InputHandler";
import { renderNumber, renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

function euclideanDistWorld(
  coord: { x: number; y: number },
  tileRef: TileRef,
  game: GameView,
): number {
  const x = game.x(tileRef);
  const y = game.y(tileRef);
  const dx = coord.x - x;
  const dy = coord.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distSortUnitWorld(coord: { x: number; y: number }, game: GameView) {
  return (a: Unit | UnitView, b: Unit | UnitView) => {
    const distA = euclideanDistWorld(coord, a.tile(), game);
    const distB = euclideanDistWorld(coord, b.tile(), game);
    return distA - distB;
  };
}

@customElement("player-info-overlay")
export class PlayerInfoOverlay extends LitElement implements Layer {
  layerName = "PlayerInfoOverlay";
  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public transform!: TransformHandler;

  @state()
  private player: PlayerView | null = null;

  @state()
  private playerProfile: PlayerProfile | null = null;

  @state()
  private unit: UnitView | null = null;

  @state()
  private _isInfoVisible: boolean = false;

  private _isActive = false;

  private lastMouseUpdate = 0;

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) =>
      this.onMouseEvent(e),
    );
    this._isActive = true;
  }

  private onMouseEvent(event: MouseMoveEvent) {
    const now = Date.now();
    if (now - this.lastMouseUpdate < 100) {
      return;
    }
    this.lastMouseUpdate = now;
    this.maybeShow(event.x, event.y);
  }

  public hide() {
    this.setVisible(false);
    this.unit = null;
    this.player = null;
  }

  public maybeShow(x: number, y: number) {
    this.hide();
    const worldCoord = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) {
      return;
    }

    const tile = this.game.ref(worldCoord.x, worldCoord.y);
    if (!tile) return;

    const owner = this.game.owner(tile);

    if (owner && owner.isPlayer()) {
      this.player = owner as PlayerView;
      this.player.profile().then((p) => {
        this.playerProfile = p;
      });
      this.setVisible(true);
    } else if (!this.game.isLand(tile)) {
      const units = this.game
        .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
        .filter((u) => euclideanDistWorld(worldCoord, u.tile(), this.game) < 50)
        .sort(distSortUnitWorld(worldCoord, this.game));

      if (units.length > 0) {
        this.unit = units[0];
        this.setVisible(true);
      }
    }
  }

  tick() {
    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Implementation for Layer interface
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisible(visible: boolean) {
    this._isInfoVisible = visible;
    this.requestUpdate();
  }

  private getRelationClass(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return "text-red-500";
      case Relation.Distrustful:
        return "text-red-300";
      case Relation.Neutral:
        return "text-white";
      case Relation.Friendly:
        return "text-green-500";
      default:
        return "text-white";
    }
  }

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Neutral:
        return translateText("relation.neutral");
      case Relation.Friendly:
        return translateText("relation.friendly");
      default:
        return translateText("relation.default");
    }
  }

  private renderPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player);
    let relationHtml: TemplateResult | null = null;
    let relationClassForType = "";
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);

    if (myPlayer !== null) {
      let displayRelation = false;
      let relationClass = "";
      let relationName = "";
      // Icons are not shown in overlay; text only

      if (myPlayer.isFriendly(player)) {
        relationClass = this.getRelationClass(Relation.Friendly);
        relationName = translateText("relation.allied");
        displayRelation = true;
      } else if (myPlayer.isAtWarWith(player)) {
        relationClass = "text-red-500";
        relationName = translateText("relation.hostile");
        displayRelation = true;
      } else if (
        !myPlayer.isAlliedWith(player) &&
        !myPlayer.isAtWarWith(player)
      ) {
        // Neutral
        relationClass = "text-yellow-300";
        relationName = translateText("relation.neutral");
        displayRelation = true;
      } else if (player.type() === PlayerType.FakeHuman) {
        const relation =
          this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
        relationClass = this.getRelationClass(relation);
        relationName = this.getRelationName(relation);
        displayRelation = true;
      }

      if (displayRelation) {
        relationHtml = html`
          <span class="${relationClass}">${relationName}</span>
        `;
        relationClassForType = relationClass;
      }
    }
    let playerType = "";
    switch (player.type()) {
      case PlayerType.Bot:
        playerType = translateText("player_info_overlay.bot");
        break;
      case PlayerType.FakeHuman:
        playerType = translateText("player_info_overlay.nation");
        break;
      case PlayerType.Human:
        playerType = translateText("player_info_overlay.player");
        break;
    }

    const unitTypes = [
      UnitType.City,
      UnitType.Hospital,
      UnitType.Academy,
      UnitType.ResearchLab,
      UnitType.Factory,
      UnitType.Port,
      UnitType.Warship,
      UnitType.Artillery,
      UnitType.MissileSilo,
      UnitType.SAMLauncher,
      UnitType.Airfield,
      UnitType.FighterJet,
      UnitType.DefensePost,
    ];

    const unitIconMap: { [key in UnitType]?: string } = {
      [UnitType.City]: "/images/CityIconWhite.svg",
      [UnitType.Hospital]: "/images/HospitalIconWhite.svg",
      [UnitType.Academy]: "/images/AcademyIconWhite.png",
      [UnitType.ResearchLab]: "/images/researchlab.png",
      [UnitType.Factory]: "/images/factoryicon.png",
      [UnitType.Port]: "/images/PortIcon.svg",
      [UnitType.Warship]: "/images/BattleshipIconWhite.svg",
      [UnitType.Artillery]: "/images/artillery-battery.png",
      [UnitType.MissileSilo]: "/images/MissileSiloIconWhite.svg",
      [UnitType.SAMLauncher]: "/images/SamLauncherIconWhite.svg",
      [UnitType.Airfield]: "/images/AirfieldIcon.svg",
      [UnitType.FighterJet]: "/images/FighterJetIcon.svg",
      [UnitType.DefensePost]: "/images/ShieldIconWhite.svg",
    };

    return html`
      <div class="flex flex-col p-2 min-w-max">
        <!-- Box 0: Name, Relation, Type, Team -->
        <div
          class="flex justify-center items-center gap-2 mb-2 w-full border border-gray-400 rounded py-1 px-12 relative"
        >
          <div
            class="absolute left-2 flex items-center gap-1 text-sm opacity-80"
          >
            <img
              src="/images/flask.png"
              class="w-5 h-5"
              style="transform: translateY(-1px); filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.8));"
              alt="Research"
            />
            ${player.researchTechLevel().toFixed(1)}
          </div>

          <div
            class="text-bold text-lg font-bold inline-flex items-center break-all ${isFriendly
              ? "text-green-500"
              : "text-white"}"
          >
            ${player.flag()
              ? html`<img
                  class="h-8 mr-1 aspect-[3/4] self-center"
                  src=${`/flags/${player.flag()}.svg`}
                />`
              : ""}
            ${player.name()}
          </div>
          <div class="text-sm opacity-80 relative top-[1px]">
            ${relationHtml}
            <span
              class="${relationHtml
                ? relationClassForType
                : isFriendly
                  ? "text-green-500"
                  : ""}"
              >${playerType}</span
            >
            ${player.team() !== null
              ? html`<span class="ml-1"
                  >· ${translateText("player_info_overlay.team")}
                  ${player.team()}</span
                >`
              : ""}
          </div>
        </div>

        <!-- Bottom Section -->
        <div class="flex flex-row gap-2 items-stretch">
          <!-- Left Column (Box 2 & 3 Merged) -->
          <div
            class="flex flex-col justify-between p-1 border border-gray-400 rounded min-w-fit"
          >
            <!-- Box 2 Content -->
            <div class="flex items-center gap-2 text-sm opacity-80">
              ${player.troops() >= 1
                ? html`<span translate="no">
                    <img
                      src="/images/TroopIconWhite.png"
                      class="inline-block w-4 h-4 mr-1"
                      alt="Troops"
                    />
                    ${renderTroops(player.troops())}
                  </span>`
                : ""}
              ${attackingTroops >= 1
                ? html`<span translate="no">
                    <img
                      src="/images/SwordIconWhite.svg"
                      class="inline-block w-4 h-4 mr-1"
                      alt="Attack"
                    />
                    ${renderTroops(attackingTroops)}
                  </span>`
                : ""}
            </div>
            <!-- Box 3 Content -->
            <div class="flex items-center gap-2 text-sm opacity-80">
              <span translate="no">
                <img
                  src="/images/GoldCoinIcon.svg"
                  class="inline-block w-4 h-4 mr-1"
                  alt="Gold"
                />
                ${renderNumber(player.gold())}
              </span>
              <span translate="no">
                <img
                  src="/images/ProductionRateIcon.svg"
                  class="inline-block w-4 h-4 mr-1"
                  alt="Productivity"
                />
                ${Math.round(player.productivity() * 100)}%
              </span>
            </div>
          </div>

          <!-- Right Column (Box 1 Refactored) -->
          <div class="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1">
            ${unitTypes.map((unitType) => {
              const iconSrc = unitIconMap[unitType];
              if (!iconSrc) return null;

              // Use unitsOwned for all stackable structures
              // so counts reflect summed stack counts + constructions, consistent with server.
              const count =
                unitType === UnitType.City ||
                unitType === UnitType.Port ||
                unitType === UnitType.Hospital ||
                unitType === UnitType.Academy ||
                unitType === UnitType.ResearchLab ||
                unitType === UnitType.Factory ||
                unitType === UnitType.SAMLauncher ||
                unitType === UnitType.Airfield ||
                unitType === UnitType.MissileSilo
                  ? player.unitsOwned(unitType)
                  : player.units(unitType).length;

              return html`
                <div
                  class="flex flex-col items-center justify-between p-1 border border-gray-400 rounded"
                >
                  <img
                    src="${iconSrc}"
                    class="inline-block w-4 h-4"
                    alt="${unitType}"
                  />
                  <span class="text-sm opacity-80">${count}</span>
                </div>
              `;
            })}
          </div>
        </div>
      </div>
    `;
  }

  private renderUnitInfo(unit: UnitView) {
    const isAlly =
      (unit.owner() === this.game.myPlayer() ||
        this.game.myPlayer()?.isFriendly(unit.owner())) ??
      false;

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${isAlly ? "text-green-500" : "text-white"}">
          ${unit.owner().name()}
        </div>
        <div class="mt-1">
          <div class="text-sm opacity-80">${unit.type()}</div>
          ${unit.hasHealth()
            ? html`
                <div class="text-sm opacity-80">
                  ${translateText("player_info_overlay.health")}:
                  ${unit.health()}
                </div>
              `
            : ""}
        </div>
      </div>
    `;
  }

  render() {
    if (!this._isActive) {
      return html``;
    }

    const containerClasses = this._isInfoVisible
      ? "opacity-100 visible pointer-events-auto"
      : "opacity-0 invisible pointer-events-none";

    return html`
      <div
        class="fixed inset-0 z-50 pointer-events-none"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div
          class="absolute top-0 lg:top-2.5 left-1/2 transform -translate-x-1/2 scale-[0.9] origin-top submarine-panel transition-all duration-300 text-lg md:text-base ${containerClasses}"
          style="box-shadow: inset 0 0 18px rgba(2, 8, 20, 0.8), 0 2px 6px rgba(0, 0, 0, 0.5);"
        >
          ${this.player !== null ? this.renderPlayerInfo(this.player) : ""}
          ${this.unit !== null ? this.renderUnitInfo(this.unit) : ""}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
