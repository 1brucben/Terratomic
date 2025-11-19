import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import randomMap from "../../resources/images/RandomMap.webp";
import { formatStartingGold, translateText } from "../client/Utils";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  GameType,
  Quads,
  Trios,
  UnitType,
  mapCategories,
} from "../core/game/Game";
import {
  PeaceTimerDuration,
  StartingGoldValues,
  TeamCountConfig,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./components/Difficulties";
import { DifficultyDescription } from "./components/Difficulties";
import "./components/Maps";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import { renderUnitTypeOptions } from "./utilities/RenderUnitTypeOptions";

type StartingGoldOption = (typeof StartingGoldValues)[number];
const startingGoldList = [...StartingGoldValues] as number[];
const isStartingGoldOption = (value: number): value is StartingGoldOption =>
  startingGoldList.includes(value);

@customElement("single-player-modal")
export class SinglePlayerModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() private disableNPCs: boolean = false;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private instantBuild: boolean = false;
  @state() private instantResearchHumanOnly: boolean = false;
  @state() private researchAllTechs: boolean = false;
  @state() private useRandomMap: boolean = false;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;
  @state() private selectedPeaceTimerDuration: PeaceTimerDuration =
    PeaceTimerDuration.None;
  @state() private startingGold: StartingGoldOption = StartingGoldValues[0];

  @state() private disabledUnits: UnitType[] = [];
  @state() private showUnitSettings = true; // Open by default

  render() {
    // Calculate percentage for the CSS variable
    const sliderPercent = (this.bots / 400) * 100;

    return html`
      <style>
        /* Modal Internal Layout */
        .sp-layout {
          display: grid;
          grid-template-columns: 1fr 1fr; /* 50/50 Split */
          gap: 16px;
          /* Fixed height to prevent layout jumping when settings expand */
          height: 70vh;
          overflow: hidden;
        }

        @media (max-width: 1024px) {
          .sp-layout {
            grid-template-columns: 1fr;
            height: auto;
            max-height: 80vh;
            overflow-y: auto;
          }
          .sp-map-col {
            height: 40vh; /* Fixed height for maps on mobile */
          }
        }

        /* Map Column (Left) */
        .sp-map-col {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 12px;
          padding: 16px 4px 16px 16px;
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .sp-scroll-area {
          flex: 1;
          overflow-y: scroll; /* Force scrollbar to prevent layout shift */
          padding-right: 12px;
          padding-bottom: 12px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) rgba(0, 0, 0, 0.1);
        }
        .sp-scroll-area::-webkit-scrollbar {
          width: 8px;
        }
        .sp-scroll-area::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 4px;
        }
        .sp-scroll-area::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }

        /* Settings Column (Right) */
        .sp-settings-col {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          padding-bottom: 4px;
        }

        .sp-settings-scroll {
          flex: 1;
          overflow-y: scroll; /* Force scrollbar to prevent layout shift */
          padding-right: 8px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) rgba(0, 0, 0, 0.1);
        }
        .sp-settings-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .sp-settings-scroll::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 4px;
        }
        .sp-settings-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }

        /* Compact Section Container */
        .sp-section {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 12px;
          padding: 12px;
        }

        .sp-title {
          font-size: 14px;
          color: var(--ui-text-light);
          margin-bottom: 6px;
          text-align: left;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* Compact Button Grid */
        .sp-btn-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
          gap: 8px;
        }

        /* Smaller grid for team counts */
        .sp-btn-grid-small {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(55px, 1fr));
          gap: 6px;
        }

        /* Standard Settings Toggle Button */
        .sp-btn {
          background: var(--ui-panel-shell-top);
          border: 1px solid var(--ui-panel-border);
          border-radius: 6px;
          padding: 6px 8px;
          cursor: pointer;
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          transition: all 0.15s ease;
          min-height: 36px;
          position: relative;
        }
        .sp-btn:hover {
          background: var(--ui-panel-shell-bottom);
          border-color: rgba(255, 255, 255, 0.3);
          transform: translateY(-1px);
        }
        .sp-btn.selected {
          background: rgba(39, 71, 110, 0.35);
          border-color: var(--ui-secondary);
          box-shadow: inset 0 0 0 1px var(--ui-secondary-hover);
        }
        .sp-btn-label {
          font-size: 13px;
          color: var(--ui-text-muted);
          text-align: left;
          line-height: 1.1;
        }
        .sp-btn.selected .sp-btn-label {
          color: var(--ui-text-accent);
        }

        /* Cycler Button (Difficulty/Mode) */
        .sp-cycler-btn {
          width: 100%;
          background: var(--ui-panel-shell-top);
          border: 1px solid var(--ui-panel-border);
          border-radius: 8px;
          padding: 0 16px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.2s ease;
          user-select: none;
        }
        .sp-cycler-btn:hover {
          background: var(--ui-panel-shell-bottom);
          border-color: rgba(255, 255, 255, 0.3);
          transform: translateY(-1px);
        }
        .sp-cycler-content {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 16px;
          font-weight: bold;
          color: var(--ui-text-default);
        }
        .sp-cycler-icon {
          color: var(--ui-secondary);
          font-size: 12px;
          font-weight: bold;
        }
        .sp-refresh-icon {
          color: var(--ui-text-muted);
          font-size: 18px;
        }

        /* Checkbox visual for toggle buttons */
        .sp-check {
          width: 14px;
          height: 14px;
          border: 1px solid var(--ui-text-muted);
          border-radius: 3px;
          margin-right: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .sp-btn.selected .sp-check {
          background: var(--ui-secondary);
          border-color: var(--ui-secondary);
        }
        .sp-btn.selected .sp-check::after {
          content: "✓";
          font-size: 12px;
          color: black;
          font-weight: bold;
        }

        /* Maps Grid */
        .map-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          padding: 4px;
        }
        .map-item-wrapper {
          transform: scale(1);
          transform-origin: center top;
          margin-bottom: -10px;
        }

        /* Slider Styling - THIN & NICE */
        input[type="range"] {
          -webkit-appearance: none;
          width: 100%;
          height: 20px;
          background: transparent;
          margin: 0;
          cursor: pointer;
        }
        input[type="range"]:focus {
          outline: none;
        }

        input[type="range"]::-webkit-slider-runnable-track {
          width: 100%;
          height: 4px;
          cursor: pointer;
          border-radius: 2px;
          background: linear-gradient(
            to right,
            var(--ui-secondary) 0%,
            var(--ui-secondary) var(--slider-progress),
            var(--ui-border-muted) var(--slider-progress),
            var(--ui-border-muted) 100%
          );
        }

        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          margin-top: -6px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
          border: 2px solid var(--ui-secondary);
          transition: transform 0.1s ease;
        }

        input[type="range"]:hover::-webkit-slider-thumb {
          transform: scale(1.1);
        }

        .sp-select {
          width: 100%;
          background: var(--ui-panel-shell-top);
          color: var(--ui-text-default);
          border: 1px solid var(--ui-panel-border);
          border-radius: 6px;
          padding: 8px;
          font-size: 14px;
          outline: none;
        }

        /* Collapse Header */
        .sp-collapse-header {
          cursor: pointer;
          background: rgba(0, 0, 0, 0.2);
          padding: 10px;
          border-radius: 6px;
          font-size: 15px;
          font-weight: bold;
          color: var(--ui-text-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          user-select: none;
        }
        .sp-collapse-header:hover {
          background: rgba(0, 0, 0, 0.3);
        }

        /* Smooth Transition using Grid */
        .sp-collapse-grid {
          display: grid;
          grid-template-rows: 0fr;
          transition:
            grid-template-rows 0.3s ease-out,
            opacity 0.3s ease-out;
          opacity: 0;
        }
        .sp-collapse-grid.open {
          grid-template-rows: 1fr;
          opacity: 1;
        }
        .sp-collapse-inner {
          overflow: hidden;
        }
      </style>

      <o-modal
        title=${translateText("single_modal.title")}
        max-width="1600px"
        max-height="85vh"
        content-overflow="hidden"
      >
        <div class="sp-layout">
          <!-- LEFT COLUMN: Maps -->
          <div class="sp-map-col">
            <div class="sp-scroll-area">
              ${Object.entries(mapCategories).map(
                ([categoryKey, maps]) => html`
                  <div class="w-full mb-4">
                    <h3
                      class="text-xs font-bold uppercase tracking-wider mb-2 text-center text-gray-400 border-b border-gray-700 pb-1 mx-10"
                    >
                      ${translateText(`map_categories.${categoryKey}`)}
                    </h3>
                    <div class="map-grid">
                      ${maps.map((mapValue) => {
                        const mapKey = Object.keys(GameMapType).find(
                          (key) =>
                            GameMapType[key as keyof typeof GameMapType] ===
                            mapValue,
                        );
                        return html`
                          <div
                            class="map-item-wrapper"
                            @click=${() => this.handleMapSelection(mapValue)}
                          >
                            <map-display
                              .mapKey=${mapKey}
                              .selected=${!this.useRandomMap &&
                              this.selectedMap === mapValue}
                              .translation=${translateText(
                                `map.${mapKey?.toLowerCase()}`,
                              )}
                            ></map-display>
                          </div>
                        `;
                      })}
                    </div>
                  </div>
                `,
              )}

              <!-- Random Map -->
              <div class="w-full flex justify-center mb-4 pt-2">
                <div
                  class="option-card random-map ${this.useRandomMap
                    ? "selected"
                    : ""} map-item-wrapper"
                  @click=${this.handleRandomMapToggle}
                  style="width: 100px;"
                >
                  <div class="option-image">
                    <img
                      src=${randomMap}
                      style="width:100%; aspect-ratio:4/2; object-fit:cover; border-radius:8px;"
                    />
                  </div>
                  <div class="option-card-title">
                    ${translateText("map.random")}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- RIGHT COLUMN: Settings -->
          <div class="sp-settings-col">
            <div class="sp-settings-scroll">
              <!-- Top Row: Difficulty & Mode Cyclers -->
              <div
                class="sp-section"
                style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;"
              >
                <!-- Difficulty -->
                <div class="flex flex-col gap-1">
                  <div class="sp-title">
                    ${translateText("difficulty.difficulty")}
                  </div>
                  <div class="sp-cycler-btn" @click=${this.cycleDifficulty}>
                    <div class="sp-cycler-content">
                      <difficulty-display
                        .difficultyKey=${Difficulty[this.selectedDifficulty]}
                      ></difficulty-display>
                      <span
                        >${translateText(
                          `difficulty.${DifficultyDescription[this.selectedDifficulty]}`,
                        )}</span
                      >
                    </div>
                    <div class="sp-refresh-icon">↻</div>
                  </div>
                </div>
                <!-- Mode (Arrow Icon) -->
                <div class="flex flex-col gap-1">
                  <div class="sp-title">
                    ${translateText("host_modal.mode")}
                  </div>
                  <div class="sp-cycler-btn" @click=${this.cycleGameMode}>
                    <div class="sp-cycler-content">
                      <span
                        >${this.gameMode === GameMode.FFA
                          ? translateText("game_mode.ffa")
                          : translateText("game_mode.teams")}</span
                      >
                    </div>
                    <div class="sp-cycler-icon">▼</div>
                  </div>
                </div>
              </div>

              <!-- Team Count (Animated Smooth Open/Close) -->
              <div
                class="sp-collapse-grid ${this.gameMode === GameMode.Team
                  ? "open"
                  : ""}"
              >
                <div class="sp-collapse-inner">
                  <div class="sp-section">
                    <div class="sp-title">
                      ${translateText("host_modal.team_count")}
                    </div>
                    <div class="sp-btn-grid-small">
                      ${[2, 3, 4, 5, 6, 7, Quads, Trios, Duos].map(
                        (o) => html`
                          <div
                            class="sp-btn ${this.teamCount === o
                              ? "selected"
                              : ""}"
                            @click=${() => this.handleTeamCountSelection(o)}
                            style="justify-content:center; min-height: 30px; padding: 4px;"
                          >
                            <span class="sp-btn-label" style="font-size: 12px;"
                              >${typeof o === "string"
                                ? translateText(`public_lobby.teams_${o}`)
                                : o}</span
                            >
                          </div>
                        `,
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Main Options - 3 Column Grid -->
              <div class="sp-section">
                <div class="sp-title">
                  ${translateText("single_modal.options_title")}
                </div>

                <!-- Bot Slider -->
                <div class="mb-4 px-2">
                  <div class="flex justify-between text-sm text-gray-300 mb-1">
                    <span>${translateText("single_modal.bots")}</span>
                    <span class="font-bold">${this.bots}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="400"
                    step="1"
                    .value=${String(this.bots)}
                    @input=${this.handleBotsChange}
                    style="--slider-progress: ${sliderPercent}%"
                  />
                </div>

                <!-- Dropdowns with Labels -->
                <div class="grid grid-cols-2 gap-4 mb-3">
                  <div class="flex flex-col">
                    <div class="text-sm text-gray-300 mb-1 font-bold">
                      ${translateText("starting_gold.label")}
                    </div>
                    <select
                      class="sp-select"
                      @change=${this.handleStartingGoldChange}
                      .value=${String(this.startingGold)}
                    >
                      ${StartingGoldValues.map(
                        (v) =>
                          html`<option value=${v}>
                            ${formatStartingGold(v)}
                          </option>`,
                      )}
                    </select>
                  </div>
                  <div class="flex flex-col">
                    <div class="text-sm text-gray-300 mb-1 font-bold">
                      ${translateText("host_modal.peace_timer")}
                    </div>
                    <select
                      class="sp-select"
                      @change=${this.handlePeaceTimerChange}
                      .value=${String(this.selectedPeaceTimerDuration)}
                    >
                      ${Object.values(PeaceTimerDuration)
                        .filter((v) => typeof v === "number")
                        .map(
                          (v) => html`
                            <option value=${v}>
                              ${v === 0
                                ? translateText("host_modal.peace_timer_none")
                                : translateText(
                                    "host_modal.peace_timer_minutes",
                                    { minutes: String(v) },
                                  )}
                            </option>
                          `,
                        )}
                    </select>
                  </div>
                </div>

                <!-- Toggle Grid: 3 Columns -->
                <div
                  class="sp-btn-grid"
                  style="grid-template-columns: repeat(3, 1fr);"
                >
                  ${this.renderToggle(
                    this.disableNPCs,
                    "single_modal.disable_nations",
                    this.handleDisableNPCsChange,
                  )}
                  ${this.renderToggle(
                    this.instantBuild,
                    "single_modal.instant_build",
                    this.handleInstantBuildChange,
                  )}
                  ${this.renderToggle(
                    this.instantResearchHumanOnly,
                    "single_modal.instant_research",
                    this.handleInstantResearchHumanOnlyChange,
                  )}
                  ${this.renderToggle(
                    this.researchAllTechs,
                    "single_modal.research_all_techs",
                    (e: any) => (this.researchAllTechs = e.target.checked),
                  )}
                  ${this.renderToggle(
                    this.infiniteGold,
                    "single_modal.infinite_gold",
                    this.handleInfiniteGoldChange,
                  )}
                  ${this.renderToggle(
                    this.infiniteTroops,
                    "single_modal.infinite_troops",
                    this.handleInfiniteTroopsChange,
                  )}
                </div>
              </div>

              <!-- Extra Settings (Animated Smooth Open/Close) -->
              <div class="sp-section">
                <div
                  @click=${() =>
                    (this.showUnitSettings = !this.showUnitSettings)}
                  class="sp-collapse-header"
                >
                  <span>Extra Settings</span>
                  <span style="color:var(--ui-secondary); font-size:12px;"
                    >${this.showUnitSettings ? "▼" : "▶"}</span
                  >
                </div>

                <div
                  class="sp-collapse-grid ${this.showUnitSettings
                    ? "open"
                    : ""}"
                >
                  <div class="sp-collapse-inner">
                    <div class="flex flex-wrap gap-2 justify-center mt-3">
                      ${renderUnitTypeOptions({
                        disabledUnits: this.disabledUnits,
                        toggleUnit: this.toggleUnit.bind(this),
                      }).map(
                        (template) =>
                          html`<div
                            style="transform: scale(0.85); margin: -2px;"
                          >
                            ${template}
                          </div>`,
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <!-- START BUTTON -->
              <div style="margin-top: 4px; padding-bottom: 8px;">
                <o-button
                  title=${translateText("single_modal.start")}
                  @click=${this.startGame}
                  block
                ></o-button>
              </div>
            </div>
            <!-- End Scroll Area -->
          </div>
          <!-- End Right Col -->
        </div>
      </o-modal>
    `;
  }

  private cycleDifficulty() {
    const modes = [
      Difficulty.Easy,
      Difficulty.Medium,
      Difficulty.Hard,
      Difficulty.Impossible,
    ];
    const idx = modes.indexOf(this.selectedDifficulty);
    this.selectedDifficulty = modes[(idx + 1) % modes.length];
  }

  private cycleGameMode() {
    this.gameMode =
      this.gameMode === GameMode.FFA ? GameMode.Team : GameMode.FFA;
  }

  private renderToggle(
    checked: boolean,
    labelKey: string,
    onChange: (e: any) => void,
  ) {
    return html`
      <label class="sp-btn ${checked ? "selected" : ""}">
        <div class="sp-check"></div>
        <input
          type="checkbox"
          class="hidden"
          .checked=${checked}
          @change=${onChange}
        />
        <span class="sp-btn-label">${translateText(labelKey)}</span>
      </label>
    `;
  }

  createRenderRoot() {
    return this; // light DOM
  }

  public open() {
    this.modalEl?.open();
    this.useRandomMap = false;
    this.startingGold = 0;
    this.showUnitSettings = true;
  }

  public close() {
    this.modalEl?.close();
  }

  private handleRandomMapToggle() {
    this.useRandomMap = true;
  }

  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
  }

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  private handleBotsChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  }

  private handleInstantBuildChange(e: Event) {
    this.instantBuild = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleInstantResearchHumanOnlyChange(e: Event) {
    this.instantResearchHumanOnly = Boolean(
      (e.target as HTMLInputElement).checked,
    );
  }

  private handleInfiniteGoldChange(e: Event) {
    this.infiniteGold = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleInfiniteTroopsChange(e: Event) {
    this.infiniteTroops = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleStartingGoldChange(e: Event) {
    const value = parseInt((e.target as HTMLSelectElement).value, 10);
    if (isNaN(value) || !isStartingGoldOption(value)) {
      return;
    }
    this.startingGold = value;
  }

  private handlePeaceTimerChange(e: Event) {
    this.selectedPeaceTimerDuration = parseInt(
      (e.target as HTMLSelectElement).value,
    );
  }

  private handleDisableNPCsChange(e: Event) {
    this.disableNPCs = Boolean((e.target as HTMLInputElement).checked);
  }

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  private handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
  }

  private getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  private toggleUnit(unit: UnitType, checked: boolean): void {
    console.log(`Toggling unit type: ${unit} to ${checked}`);
    this.disabledUnits = checked
      ? [...this.disabledUnits, unit]
      : this.disabledUnits.filter((u) => u !== unit);
  }

  private startGame() {
    // If random map is selected, choose a random map now
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }

    console.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]}${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!usernameInput) {
      console.warn("Username input element not found");
    }

    const flagInput = document.querySelector("flag-input") as FlagInput;
    if (!flagInput) {
      console.warn("Flag input element not found");
    }
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          clientID: clientID,
          gameID: gameID,
          gameStartInfo: {
            gameID: gameID,
            players: [
              {
                clientID,
                username: usernameInput.getCurrentUsername(),
                flag:
                  flagInput.getCurrentFlag() === "xx"
                    ? ""
                    : flagInput.getCurrentFlag(),
              },
            ],
            config: {
              gameMap: this.selectedMap,
              gameType: GameType.Singleplayer,
              gameMode: this.gameMode,
              playerTeams: this.teamCount,
              difficulty: this.selectedDifficulty,
              disableNPCs: this.disableNPCs,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              instantResearchHumanOnly: this.instantResearchHumanOnly,
              researchAllTechs: this.researchAllTechs,
              disabledUnits: this.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
              peaceTimerDurationMinutes: this.selectedPeaceTimerDuration,
              startingGold: this.startingGold,
            },
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
