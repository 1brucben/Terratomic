import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import airfieldIcon from "../../../../resources/images/AirfieldIcon.svg";
import warshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import academyIcon from "../../../../resources/images/buildings/academy_icon.png";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import fighterJetIcon from "../../../../resources/images/FighterJetIcon.svg";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import hospitalIcon from "../../../../resources/images/HospitalIconWhite.svg";
import mirvIcon from "../../../../resources/images/MIRVIcon.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloIconWhite.svg";
import hydrogenBombIcon from "../../../../resources/images/MushroomCloudIconWhite.svg";
import atomBombIcon from "../../../../resources/images/NukeIconWhite.svg";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samlauncherIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import shieldIcon from "../../../../resources/images/ShieldIconWhite.svg";
import submarineIcon from "../../../../resources/images/submarine.svg";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { Gold, UnitType, UpgradeType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { CloseViewEvent } from "../../InputHandler";
import { displayKey, renderNumber } from "../../Utils";
import { UIState } from "../UIState";

interface BuildItemDisplay {
  unitType: UnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.FighterJet,
      icon: fighterJetIcon,
      description: "build_menu.desc.fighter_jet",
      key: "unit_type.fighter_jet",
      countable: true,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      countable: true,
    },
    {
      unitType: UnitType.Submarine,
      icon: submarineIcon,
      description: "build_menu.desc.submarine",
      key: "unit_type.submarine",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "build_menu.desc.city",
      key: "unit_type.city",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
    {
      unitType: UnitType.Airfield,
      icon: airfieldIcon,
      description: "build_menu.desc.airfield",
      key: "unit_type.airfield",
      countable: true,
    },
    {
      unitType: UnitType.Hospital,
      icon: hospitalIcon,
      description: "build_menu.desc.hospital",
      key: "unit_type.hospital",
      countable: true,
    },
    {
      unitType: UnitType.Academy,
      icon: academyIcon,
      description: "build_menu.desc.academy",
      key: "unit_type.academy",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
  ],
];

@customElement("build-menu")
export class BuildMenu extends LitElement {
  constructor() {
    super();
  }

  @property({ type: Object })
  game: GameView;

  @property({ type: Object })
  eventBus: EventBus;

  @property({ type: Object })
  uiState: UIState;

  @property({ type: Array })
  unitFilter: UnitType[] | null = null;

  @state()
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;

  @state()
  private hotkeyMap: Map<UnitType, string> = new Map();

  // Recompute once after first render, and whenever relevant inputs change
  protected firstUpdated(): void {
    this.recomputeFilteredTable();
    this.buildHotkeyMap();
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("unitFilter") || changed.has("game")) {
      this.recomputeFilteredTable();
    }
  }

  private buildHotkeyMap() {
    const keybinds = {
      buildAtomBomb: "Digit5",
      buildHydrogenBomb: "Digit6",
      buildMIRV: "Digit7",
      buildFighterJet: "Digit8",
      buildWarship: "Digit9",
      buildCity: "KeyY",
      buildPort: "KeyU",
      buildAirfield: "KeyI",
      buildHospital: "KeyO",
      buildAcademy: "KeyP",
      buildMissileSilo: "KeyH",
      buildSAMLauncher: "KeyJ",
      buildDefensePost: "KeyK",
      ...JSON.parse(localStorage.getItem("settings.keybinds") ?? "{}"),
    };

    const buildHotkeys: Record<string, UnitType> = {
      [keybinds.buildAtomBomb]: UnitType.AtomBomb,
      [keybinds.buildHydrogenBomb]: UnitType.HydrogenBomb,
      [keybinds.buildMIRV]: UnitType.MIRV,
      [keybinds.buildFighterJet]: UnitType.FighterJet,
      [keybinds.buildWarship]: UnitType.Warship,
      [keybinds.buildCity]: UnitType.City,
      [keybinds.buildPort]: UnitType.Port,
      [keybinds.buildAirfield]: UnitType.Airfield,
      [keybinds.buildHospital]: UnitType.Hospital,
      [keybinds.buildAcademy]: UnitType.Academy,
      [keybinds.buildMissileSilo]: UnitType.MissileSilo,
      [keybinds.buildSAMLauncher]: UnitType.SAMLauncher,
      [keybinds.buildDefensePost]: UnitType.DefensePost,
    };

    for (const key in buildHotkeys) {
      const unitType = buildHotkeys[key];
      this.hotkeyMap.set(unitType, displayKey(key));
    }
  }

  // Centralized precomputation of the table to avoid doing it in render()
  private recomputeFilteredTable(): void {
    let current = buildTable;

    if (this.unitFilter && this.unitFilter.length > 0) {
      current = buildTable.map((row) =>
        row.filter((item) => this.unitFilter!.includes(item.unitType)),
      );
    }

    if (this.game?.config()) {
      current = current.map((row) =>
        row.filter(
          (item) => !this.game!.config().isUnitDisabled(item.unitType),
        ),
      );
    }

    if (this.game?.myPlayer()) {
      const player = this.game.myPlayer()!;
      this.filteredBuildTable = current.map((row) =>
        row.filter((item) => {
          if (item.unitType === UnitType.Submarine) {
            return player.hasUpgrade(UpgradeType.SubmarineResearch);
          }
          return true;
        }),
      );
    } else {
      this.filteredBuildTable = current;
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    .build-menu-prompt {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100%;
      color: white;
      font-size: 1.2rem;
      text-align: center;
    }
    .build-menu {
      background-color: transparent;
      padding: 0px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      max-width: 95vw;
      max-height: 95vh;
      overflow-y: auto;
    }
    .build-row {
      display: flex;
      justify-content: left;
      flex-wrap: wrap;
      width: 100%;
    }
    .build-button {
      position: relative;
      width: 120px;
      height: 50px;
      border: 2px solid #0e1a33;
      /* Darker idle surface to improve separation */
      background: #183152;
      color: #c9dbff; /* submarine palette light blue */
      border-radius: 6px;
      box-shadow:
        inset 0 0 10px rgba(0, 0, 0, 0.5),
        0 2px 6px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin: 4px;
      padding: 5px;
      gap: 8px;
    }
    .build-button:not(:disabled):hover {
      background-color: #162544; /* deeper navy on hover */
      transform: scale(1.02);
      border-color: #27476e; /* blue accent border */
      box-shadow:
        inset 0 0 10px rgba(0, 0, 0, 0.5),
        0 2px 8px rgba(0, 0, 0, 0.6);
    }
    .build-button:not(:disabled):active {
      background: linear-gradient(
        to bottom,
        #182742,
        #182742
      ); /* pressed navy */
      transform: scale(0.98);
      box-shadow:
        inset 0 0 10px rgba(0, 0, 0, 0.7),
        0 1px 3px rgba(0, 0, 0, 0.3);
    }
    .build-button:disabled {
      background-color: #0a0f1a;
      border-color: #0e1a33;
      cursor: not-allowed;
      opacity: 0.6;
      box-shadow: none;
    }
    .build-button:disabled img {
      opacity: 0.4;
    }
    .build-button:disabled .build-cost {
      color: #888;
    }
    .selected-for-build {
      border-color: #32629b; /* blue selection accent */
      box-shadow: 0 0 10px rgba(50, 98, 155, 0.65);
    }
    .build-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }
    .build-item-details {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
    }
    .build-name {
      font-size: 11px;
      font-weight: bold;
      text-align: left;
      line-height: 1.2;
      color: #e3edff; /* brighten primary label */
      font-family: monospace;
    }
    .build-description {
      font-size: 0.6rem;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      word-break: break-word;
      max-height: 2.4em;
      color: #9fb6db; /* muted info */
    }
    .build-cost {
      font-size: 10px;
      white-space: nowrap;
      text-align: left;
      color: #dbe7ff; /* readable cost color */
    }
    .build-count-chip {
      position: absolute;
      top: -5px;
      right: -5px;
      background-color: #2c2c2c;
      color: white;
      padding: 1px 5px;
      border-radius: 10px;
      font-size: 9px;
      border: 1px solid #444;
    }
    .build-hotkey {
      position: absolute;
      bottom: 2px;
      right: 4px;
      color: #93addb; /* subtle hint color */
      font-size: 9px;
    }
    .build-button:not(:disabled):hover > .build-count-chip {
      background-color: #3a3a3a;
      border-color: #666;
    }
    .build-button:not(:disabled):active > .build-count-chip {
      background-color: #4a4a4a;
    }
    .build-button:disabled > .build-count-chip {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
    }
    .build-count {
      font-weight: bold;
      font-size: 10px;
    }
  `;

  private canBuild(item: BuildItemDisplay): boolean {
    if (!this.game || !this.game.myPlayer()) {
      return false;
    }
    const player = this.game.myPlayer()!;
    if (player.gold() < this.cost(item)) {
      return false;
    }

    switch (item.unitType) {
      case UnitType.Submarine:
      case UnitType.Warship:
        return player.unitsOwned(UnitType.Port) > 0;
      case UnitType.FighterJet:
        return player.unitsOwned(UnitType.Airfield) > 0;
      case UnitType.AtomBomb:
        return (
          player.unitsOwned(UnitType.MissileSilo) > 0 ||
          (player.hasUpgrade(UpgradeType.NuclearSubmarineResearch) &&
            player.unitsOwned(UnitType.Submarine) > 0)
        );
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return player.unitsOwned(UnitType.MissileSilo) > 0;
      default:
        return true;
    }
  }

  private cost(item: BuildItemDisplay): Gold {
    return this.game
      .config()
      .unitInfo(item.unitType)
      .cost(this.game.myPlayer()!);
  }

  private count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }
    return player.units(item.unitType).length.toString();
  }

  public onBuildSelected = (item: BuildItemDisplay) => {
    if (this.uiState.pendingBuildUnitType === item.unitType) {
      this.uiState.pendingBuildUnitType = null;
    } else {
      this.uiState.pendingBuildUnitType = item.unitType;
    }
    this.eventBus.emit(new CloseViewEvent());
    this.requestUpdate();
  };

  render() {
    if (!this.uiState) {
      return html`<div>Loading build options...</div>`;
    }

    const table = this.filteredBuildTable;

    return html`
      <div
        class="build-menu"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${table.map(
          (row) => html`
            <div class="build-row">
              ${row.map((item) => {
                const name = item.key
                  ? translateText(item.key)
                  : String(item.unitType);
                const price =
                  this.game && this.game.myPlayer() ? this.cost(item) : 0;

                return html`
                  <button
                    class="build-button ${this.uiState.pendingBuildUnitType ===
                    item.unitType
                      ? "selected-for-build"
                      : ""}"
                    @click=${() => this.onBuildSelected(item)}
                    ?disabled=${!this.canBuild(item)}
                    title=${item.description
                      ? translateText(item.description)
                      : ""}
                    aria-label=${`${name}, ${renderNumber(price)} gold`}
                  >
                    <div class="build-hotkey">
                      ${this.hotkeyMap.get(item.unitType)}
                    </div>
                    <img class="build-icon" src=${item.icon} alt=${name} />
                    <div class="build-item-details">
                      <span class="build-name">${name}</span>
                      <span class="build-cost" translate="no">
                        ${renderNumber(price)}
                        <img
                          src=${goldCoinIcon}
                          alt="gold"
                          width="12"
                          height="12"
                          style="vertical-align: middle;"
                        />
                      </span>
                    </div>
                    ${item.countable
                      ? html`<div class="build-count-chip">
                          <span class="build-count">${this.count(item)}</span>
                        </div>`
                      : ""}
                  </button>
                `;
              })}
            </div>
          `,
        )}
      </div>
    `;
  }

  private getBuildableUnits(): BuildItemDisplay[][] {
    return buildTable;
  }
}
