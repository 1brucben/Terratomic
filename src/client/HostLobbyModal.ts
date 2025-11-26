import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import randomMap from "../../resources/images/RandomMap.webp";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { PastelTheme } from "../core/configuration/PastelTheme";
import type { UnitType } from "../core/game/Game";
import {
  ColoredTeams,
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  Quads,
  Trios,
  mapCategories,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import type {
  ClientInfo,
  GameConfig,
  GameInfo,
  TeamCountConfig,
} from "../core/Schemas";
import {
  GoldMultiplierValues,
  PeaceTimerDuration,
  StartingGoldValues,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import "./components/baseComponents/Modal";
import "./components/Difficulties";
import { DifficultyDescription } from "./components/Difficulties";
import "./components/Maps";
import type { JoinLobbyEvent } from "./Main";
import { renderUnitTypeOptions } from "./utilities/RenderUnitTypeOptions";
import { formatStartingGold, translateText } from "./Utils";

type StartingGoldOption = (typeof StartingGoldValues)[number];
const startingGoldList = [...StartingGoldValues] as number[];
const isStartingGoldOption = (value: number): value is StartingGoldOption =>
  startingGoldList.includes(value);

type GoldMultiplierOption = (typeof GoldMultiplierValues)[number];
const goldMultiplierList = [...GoldMultiplierValues] as number[];
const isGoldMultiplierOption = (value: number): value is GoldMultiplierOption =>
  goldMultiplierList.includes(value);

@customElement("host-lobby-modal")
export class HostLobbyModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() private disableNPCs = false;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private instantBuild: boolean = false;
  @state() private instantResearchHumanOnly: boolean = false;
  @state() private researchAllTechs: boolean = false;
  @state() private lobbyId = "";
  @state() private copySuccess = false;
  @state() private clients: ClientInfo[] = [];
  @state() private useRandomMap: boolean = false;
  @state() private disabledUnits: UnitType[] = [];
  @state() private lobbyCreatorClientID: string = "";
  @state() private lobbyIdVisible: boolean = false; // Default to hidden/censored
  @state() private selectedPeaceTimerDuration: PeaceTimerDuration =
    PeaceTimerDuration.None;
  @state() private startingGold: StartingGoldOption = StartingGoldValues[0];
  @state() private goldMultiplier: GoldMultiplierOption = 1;
  @state() private playerTeamAssignments: Record<string, number | null> = {};
  @state() private updatingTeamForClients: Set<string> = new Set();
  @state() private showUnitSettings = false; // Closed by default for Host

  private playersInterval: NodeJS.Timeout | null = null;
  private botsUpdateTimer: number | null = null;
  private userSettings: UserSettings = new UserSettings();
  private theme = new PastelTheme();

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
          height: 75vh;
          overflow: hidden;
        }

        @media (max-width: 1024px) {
          .sp-layout {
            grid-template-columns: 1fr;
            height: auto;
            max-height: 85vh;
            overflow-y: auto;
          }
          .sp-map-col {
            height: 40vh;
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

        /* Lobby ID Header Styles */
        .lobby-header {
          display: flex;
          justify-content: center;
          margin-bottom: 12px;
          padding-right: 12px;
        }
        .lobby-id-pill {
          background: var(--ui-panel-shell-top);
          border: 1px solid var(--ui-panel-border);
          border-radius: 20px;
          padding: 6px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
          color: var(--ui-text-light);
          transition: all 0.2s ease;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .lobby-id-pill:hover {
          border-color: var(--ui-secondary);
          background: var(--ui-panel-shell-bottom);
        }
        .lobby-icon-btn {
          cursor: pointer;
          display: flex;
          align-items: center;
          color: var(--ui-text-muted);
          transition: color 0.2s;
        }
        .lobby-icon-btn:hover {
          color: var(--ui-text-light);
        }
        .lobby-text {
          font-family: monospace;
          font-weight: bold;
          letter-spacing: 1px;
          cursor: pointer;
          min-width: 90px;
          text-align: center;
          user-select: all;
        }

        .sp-scroll-area {
          flex: 1;
          overflow-y: scroll;
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

        /* Settings Column (Right) - Flex Column */
        .sp-settings-col {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          padding-bottom: 0;
        }

        .sp-settings-scroll {
          flex: 1;
          overflow-y: scroll;
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

        /* Player Area - Fixed Bottom */
        .sp-player-area {
          flex-shrink: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          margin-top: 8px;
          padding-top: 12px;
          padding-right: 4px;
          display: flex;
          flex-direction: column;
          max-height: 45%;
          min-height: 200px;
        }

        .team-scroll-wrapper {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden; /* Prevent horizontal scroll */
          margin-bottom: 12px;
          padding-right: 4px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) rgba(0, 0, 0, 0.1);
        }
        .team-scroll-wrapper::-webkit-scrollbar {
          width: 8px;
        }
        .team-scroll-wrapper::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 4px;
        }
        .team-scroll-wrapper::-webkit-scrollbar-thumb {
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

        /* Cycler Button */
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

        /* Checkbox visual */
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

        /* Slider Styling */
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

        /* Smooth Transition */
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

        /* --- PLAYER LIST STYLES --- */
        .players-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .player-tag {
          background: var(--ui-panel-shell-top);
          border: 1px solid var(--ui-panel-border);
          padding: 6px 8px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          justify-content: space-between;
          min-width: 0; /* Allows shrinkage */
        }
        .player-name {
          color: var(--ui-text-light);
          font-weight: bold;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 80px; /* Limit name width to prevent explosion */
        }
        .remove-player-btn {
          background: none;
          border: none;
          color: var(--ui-text-muted);
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 0;
          margin-left: 4px;
        }
        .remove-player-btn:hover {
          color: var(--ui-alert);
        }
        .host-badge {
          font-size: 9px;
          color: var(--ui-secondary);
          text-transform: uppercase;
          font-weight: bold;
          flex-shrink: 0;
        }
        .player-team-select {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid var(--ui-border-muted);
          color: var(--ui-text-default);
          border-radius: 4px;
          padding: 2px 4px;
          font-size: 11px;
          outline: none;
          max-width: 65px;
          flex-shrink: 0;
        }

        /* Teams Grid Layout - Fix for scaling */
        .teams-layout-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 100%;
        }
        .team-columns {
          display: grid;
          /* Min 150px per column ensures name+dropdown fit nicely, wraps if needed */
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 8px;
          align-items: start;
        }
        .team-column,
        .unassigned-column,
        .spectator-column {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--ui-border-muted);
          border-radius: 8px;
          padding: 8px;
          display: flex;
          flex-direction: column;
          min-height: 60px;
        }
        .team-column-header {
          font-size: 11px;
          font-weight: bold;
          color: var(--ui-text-muted);
          margin-bottom: 8px;
          text-transform: uppercase;
          text-align: center;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding-bottom: 4px;
        }

        /* Updated to allow wrapping players inside container */
        .unassigned-body,
        .team-column-body {
          display: flex;
          flex-direction: row; /* Row layout */
          flex-wrap: wrap; /* Wrap if needed */
          gap: 6px; /* Spacing between players */
          align-items: center;
        }
      </style>

      <o-modal
        title=${translateText("host_modal.title")}
        max-width="1600px"
        max-height="85vh"
        content-overflow="hidden"
      >
        <div class="sp-layout">
          <!-- LEFT COLUMN: Maps -->
          <div class="sp-map-col">
            <!-- Lobby ID Header -->
            <div class="lobby-header">
              <div class="lobby-id-pill">
                <div
                  class="lobby-icon-btn"
                  @click=${() => (this.lobbyIdVisible = !this.lobbyIdVisible)}
                >
                  ${this.lobbyIdVisible
                    ? html`<svg
                        stroke="currentColor"
                        fill="currentColor"
                        stroke-width="0"
                        viewBox="0 0 512 512"
                        height="18px"
                        width="18px"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M256 105c-101.8 0-188.4 62.7-224 151 35.6 88.3 122.2 151 224 151s188.4-62.7 224-151c-35.6-88.3-122.2-151-224-151zm0 251.7c-56 0-101.7-45.7-101.7-101.7S200 153.3 256 153.3 357.7 199 357.7 255 312 356.7 256 356.7zm0-161.1c-33 0-59.4 26.4-59.4 59.4s26.4 59.4 59.4 59.4 59.4-26.4 59.4-59.4-26.4-59.4-59.4-59.4z"
                        ></path>
                      </svg>`
                    : html`<svg
                        stroke="currentColor"
                        fill="currentColor"
                        stroke-width="0"
                        viewBox="0 0 512 512"
                        height="18px"
                        width="18px"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M448 256s-64-128-192-128S64 256 64 256c32 64 96 128 192 128s160-64 192-128z"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="32"
                        ></path>
                        <path
                          d="M144 256l224 0"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="32"
                          stroke-linecap="round"
                        ></path>
                      </svg>`}
                </div>
                <div class="lobby-text" @click=${this.copyToClipboard}>
                  ${this.lobbyIdVisible ? this.lobbyId : "••••••••"}
                </div>
                <div class="lobby-icon-btn" @click=${this.copyToClipboard}>
                  ${this.copySuccess
                    ? "✓"
                    : html`<svg
                        stroke="currentColor"
                        fill="currentColor"
                        stroke-width="0"
                        viewBox="0 0 512 512"
                        height="16px"
                        width="16px"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M296 48H176.5C154.4 48 136 65.4 136 87.5V96h-7.5C106.4 96 88 113.4 88 135.5v288c0 22.1 18.4 40.5 40.5 40.5h208c22.1 0 39.5-18.4 39.5-40.5V416h8.5c22.1 0 39.5-18.4 39.5-40.5V176L296 48zm0 44.6l83.4 83.4H296V92.6zm48 330.9c0 4.7-3.4 8.5-7.5 8.5h-208c-4.4 0-8.5-4.1-8.5-8.5v-288c0-4.1 3.8-7.5 8.5-7.5h7.5v255.5c0 22.1 10.4 32.5 32.5 32.5H344v7.5zm48-48c0 4.7-3.4 8.5-7.5 8.5h-208c-4.4 0-8.5-4.1-8.5-8.5v-288c0-4.1 3.8-7.5 8.5-7.5H264v128h128v167.5z"
                        ></path>
                      </svg>`}
                </div>
              </div>
            </div>

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

          <!-- RIGHT COLUMN: Settings + Player List -->
          <div class="sp-settings-col">
            <!-- Settings Scroll Area (Top) -->
            <div class="sp-settings-scroll">
              <!-- Difficulty & Mode Cyclers -->
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
                <!-- Mode -->
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

              <!-- Team Count (Collapsible) -->
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

              <!-- Main Options -->
              <div class="sp-section">
                <div class="sp-title">
                  ${translateText("host_modal.options_title")}
                </div>

                <!-- Bot Slider -->
                <div class="mb-4 px-2">
                  <div
                    class="flex justify-between text-sm text-gray-300 mb-1"
                    data-i18n-title="host_modal.bots_tooltip"
                  >
                    <span>${translateText("host_modal.bots")}</span>
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
                    data-i18n-title="host_modal.bots_tooltip"
                  />
                </div>

                <!-- Dropdowns (3 columns) -->
                <div class="grid grid-cols-3 gap-4 mb-3">
                  <div class="flex flex-col">
                    <div
                      class="text-sm text-gray-300 mb-1 font-bold"
                      data-i18n-title="gold_multiplier.tooltip"
                    >
                      ${translateText("gold_multiplier.label")}
                    </div>
                    <select
                      class="sp-select"
                      @change=${this.handleGoldMultiplierChange}
                      .value=${String(this.goldMultiplier)}
                      data-i18n-title="gold_multiplier.tooltip"
                    >
                      ${GoldMultiplierValues.map(
                        (v) =>
                          html`<option value=${v}>
                            ${v}x${v === 1 ? " (default)" : ""}
                          </option>`,
                      )}
                    </select>
                  </div>
                  <div class="flex flex-col">
                    <div
                      class="text-sm text-gray-300 mb-1 font-bold"
                      data-i18n-title="starting_gold.tooltip"
                    >
                      ${translateText("starting_gold.label")}
                    </div>
                    <select
                      class="sp-select"
                      @change=${this.handleStartingGoldChange}
                      .value=${String(this.startingGold)}
                      data-i18n-title="starting_gold.tooltip"
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
                    <div
                      class="text-sm text-gray-300 mb-1 font-bold"
                      data-i18n-title="host_modal.peace_timer_tooltip"
                    >
                      ${translateText("host_modal.peace_timer")}
                    </div>
                    <select
                      class="sp-select"
                      @change=${this.handlePeaceTimerChange}
                      .value=${String(this.selectedPeaceTimerDuration)}
                      data-i18n-title="host_modal.peace_timer_tooltip"
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

                <!-- Toggle Grid (3 Columns) -->
                <div
                  class="sp-btn-grid"
                  style="grid-template-columns: repeat(3, 1fr);"
                >
                  ${this.renderToggle(
                    this.disableNPCs,
                    "host_modal.disable_nations",
                    this.handleDisableNPCsChange,
                    "host_modal.disable_nations_tooltip",
                  )}
                  ${this.renderToggle(
                    this.instantBuild,
                    "host_modal.instant_build",
                    this.handleInstantBuildChange,
                  )}
                  ${this.renderToggle(
                    this.instantResearchHumanOnly,
                    "host_modal.instant_research",
                    this.handleInstantResearchHumanOnlyChange,
                    "host_modal.instant_research_tooltip",
                  )}
                  ${this.renderToggle(
                    this.researchAllTechs,
                    "host_modal.research_all_techs",
                    (e: any) => {
                      this.researchAllTechs = e.target.checked;
                      this.putGameConfig();
                    },
                  )}
                  ${this.renderToggle(
                    this.infiniteGold,
                    "host_modal.infinite_gold",
                    this.handleInfiniteGoldChange,
                    "host_modal.infinite_gold_tooltip",
                  )}
                  ${this.renderToggle(
                    this.infiniteTroops,
                    "host_modal.infinite_troops",
                    this.handleInfiniteTroopsChange,
                  )}
                </div>
              </div>

              <!-- Extra Settings (Collapsed by default) -->
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
            </div>
            <!-- End Settings Scroll -->

            <!-- FIXED Player List & Start Button (Bottom) -->
            <div class="sp-player-area">
              <div
                class="sp-title"
                style="margin-bottom: 8px; padding-left: 8px;"
              >
                ${this.clients.length}
                ${this.clients.length === 1
                  ? translateText("host_modal.player")
                  : translateText("host_modal.players")}
              </div>

              <!-- Scrollable Team/Player List -->
              <div class="team-scroll-wrapper custom-scroll">
                ${this.renderTeamColumns()}
              </div>

              <!-- Start Button -->
              <o-button
                title=${this.clients.length === 1
                  ? translateText("host_modal.waiting")
                  : translateText("host_modal.start")}
                @click=${this.startGame}
                ?disabled=${this.clients.length < 2}
                block
              ></o-button>
            </div>
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
    this.putGameConfig();
  }

  private cycleGameMode() {
    this.gameMode =
      this.gameMode === GameMode.FFA ? GameMode.Team : GameMode.FFA;
    if (this.gameMode !== GameMode.Team) {
      this.playerTeamAssignments = {};
    }
    this.putGameConfig();
  }

  private renderToggle(
    checked: boolean,
    labelKey: string,
    onChange: (e: any) => void,
    tooltipKey?: string,
  ) {
    return html`
      <label
        class="sp-btn ${checked ? "selected" : ""}"
        data-i18n-title=${tooltipKey ?? nothing}
      >
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

  /* --- LOGIC METHODS --- */

  updated() {
    // Apply translations to tooltips after rendering
    this.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) {
        el.setAttribute("title", translateText(key));
      }
    });
  }

  createRenderRoot() {
    return this;
  }

  public open() {
    this.lobbyCreatorClientID = generateID();
    this.playerTeamAssignments = {};
    this.lobbyIdVisible = false; // Censored by default
    this.showUnitSettings = false; // Closed by default

    createLobby(this.lobbyCreatorClientID)
      .then((lobby) => {
        this.lobbyId = lobby.gameID;
        if (lobby.gameConfig?.startingGold !== undefined) {
          this.startingGold = lobby.gameConfig.startingGold;
        } else {
          this.startingGold = 0;
        }
        if (lobby.gameConfig?.goldMultiplier !== undefined) {
          this.goldMultiplier = lobby.gameConfig.goldMultiplier;
        }
      })
      .then(() => {
        this.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: {
              gameID: this.lobbyId,
              clientID: this.lobbyCreatorClientID,
            } as JoinLobbyEvent,
            bubbles: true,
            composed: true,
          }),
        );
      });
    this.modalEl?.open();
    this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
  }

  public close() {
    this.modalEl?.close();
    this.copySuccess = false;
    this.playerTeamAssignments = {};
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
      this.botsUpdateTimer = null;
    }
  }

  private async handleRandomMapToggle() {
    this.useRandomMap = true;
    this.putGameConfig();
  }

  private async handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
    this.putGameConfig();
  }

  private handleBotsChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;

    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
    }
    this.botsUpdateTimer = window.setTimeout(() => {
      this.putGameConfig();
      this.botsUpdateTimer = null;
    }, 300);
  }

  private handleInstantBuildChange(e: Event) {
    this.instantBuild = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleInstantResearchHumanOnlyChange(e: Event) {
    this.instantResearchHumanOnly = Boolean(
      (e.target as HTMLInputElement).checked,
    );
    this.putGameConfig();
  }

  private handleInfiniteGoldChange(e: Event) {
    this.infiniteGold = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleInfiniteTroopsChange(e: Event) {
    this.infiniteTroops = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private handleStartingGoldChange(e: Event) {
    const value = parseInt((e.target as HTMLSelectElement).value, 10);
    if (isNaN(value) || !isStartingGoldOption(value)) {
      return;
    }
    this.startingGold = value;
    this.putGameConfig();
  }

  private handleGoldMultiplierChange(e: Event) {
    const value = parseFloat((e.target as HTMLSelectElement).value);
    if (isNaN(value) || !isGoldMultiplierOption(value)) {
      return;
    }
    this.goldMultiplier = value;
    this.putGameConfig();
  }

  private handlePeaceTimerChange(e: Event) {
    this.selectedPeaceTimerDuration = parseInt(
      (e.target as HTMLSelectElement).value,
    );
    this.putGameConfig();
  }

  private async handleDisableNPCsChange(e: Event) {
    this.disableNPCs = Boolean((e.target as HTMLInputElement).checked);
    this.putGameConfig();
  }

  private async handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
    if (value !== GameMode.Team) {
      this.playerTeamAssignments = {};
    }
    this.putGameConfig();
  }

  private async handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
    const normalizedCount = this.computeTeamCount(value);
    const updatedAssignments: Record<string, number | null> = {};
    for (const client of this.clients) {
      const current = this.playerTeamAssignments[client.clientID] ?? null;
      updatedAssignments[client.clientID] =
        current !== null && current >= normalizedCount ? null : current;
    }
    this.playerTeamAssignments = updatedAssignments;
    await this.putGameConfig();
  }

  private computeTeamCount(value: TeamCountConfig = this.teamCount): number {
    if (typeof value === "number") {
      return Math.max(2, value);
    }
    const playerCount = Math.max(this.clients.length, 1);
    switch (value) {
      case Duos:
        return Math.max(2, Math.ceil(playerCount / 2));
      case Trios:
        return Math.max(2, Math.ceil(playerCount / 3));
      case Quads:
        return Math.max(2, Math.ceil(playerCount / 4));
      default:
        return 2;
    }
  }

  private getTeamLabels(count: number): string[] {
    const colorLabels = [
      ColoredTeams.Red,
      ColoredTeams.Blue,
      ColoredTeams.Yellow,
      ColoredTeams.Green,
      ColoredTeams.Purple,
      ColoredTeams.Orange,
      ColoredTeams.Teal,
    ];
    if (count <= colorLabels.length) {
      return colorLabels.slice(0, count);
    }
    return Array.from({ length: count }, (_, index) => `Team ${index + 1}`);
  }

  private sanitizeAssignmentsForPayload(
    assignments: Record<string, number | null>,
    teamCount: number,
  ): Record<string, number | null> {
    const sanitized: Record<string, number | null> = {};
    const maxIndex = Math.max(teamCount - 1, 0);
    const activeClientIds = new Set(
      this.clients.map((client) => client.clientID),
    );

    for (const clientID of activeClientIds) {
      const value = assignments[clientID];
      if (value === null || value === undefined) {
        sanitized[clientID] = null;
        continue;
      }
      if (
        (Number.isInteger(value) && value >= 0 && value <= maxIndex) ||
        value === -1
      ) {
        sanitized[clientID] = value;
      } else {
        sanitized[clientID] = null;
      }
    }
    return sanitized;
  }

  private handlePlayerTeamSelection(clientID: string, rawValue: string) {
    this.updatingTeamForClients.add(clientID);

    const nextAssignments: Record<string, number | null> = {
      ...this.playerTeamAssignments,
    };
    if (rawValue === "") {
      nextAssignments[clientID] = null;
    } else {
      const parsed = Number(rawValue);
      nextAssignments[clientID] = Number.isNaN(parsed) ? null : parsed;
    }
    this.playerTeamAssignments = nextAssignments;
    this.requestUpdate();

    this.putGameConfig();
  }

  private renderPlayerTeamSelect(client: ClientInfo) {
    if (this.gameMode !== GameMode.Team) {
      return null;
    }
    const teamCount = this.computeTeamCount();
    const labels = this.getTeamLabels(teamCount);
    const assignment = this.playerTeamAssignments[client.clientID] ?? null;
    const noTeamTranslation = translateText("host_modal.no_team");
    const noTeamLabel =
      noTeamTranslation === "host_modal.no_team"
        ? "No Team"
        : noTeamTranslation;
    const assignmentValue =
      assignment === null || assignment === undefined ? "" : String(assignment);

    return html`
      <select
        class="player-team-select"
        .value=${assignmentValue}
        @change=${(event: Event) =>
          this.handlePlayerTeamSelection(
            client.clientID,
            (event.target as HTMLSelectElement).value,
          )}
      >
        <option value="" ?selected=${assignment === null}>
          ${noTeamLabel}
        </option>
        <option value="-1" ?selected=${assignment === -1}>
          ${translateText("host_modal.spectator")}
        </option>
        ${labels.map(
          (label, index) => html`
            <option value="${index}" ?selected=${assignment === index}>
              ${label}
            </option>
          `,
        )}
      </select>
    `;
  }

  private renderTeamColumns() {
    if (this.gameMode !== GameMode.Team) {
      return html`
        <div class="players-list">
          ${repeat(
            this.clients,
            (client) => client.clientID,
            (client) => html`
              <span class="player-tag">
                <span class="player-name"> ${client.username} </span>
                ${client.clientID === this.lobbyCreatorClientID
                  ? html`<span class="host-badge"
                      >(${translateText("host_modal.host_badge")})</span
                    >`
                  : html`
                      <button
                        class="remove-player-btn"
                        @click=${() => this.kickPlayer(client.clientID)}
                        title=${translateText("host_modal.remove_player", {
                          username: client.username,
                        })}
                      >
                        ×
                      </button>
                    `}
              </span>
            `,
          )}
        </div>
      `;
    }

    const teams = new Map<number | null, ClientInfo[]>();
    const teamLabels = this.getTeamLabels(this.computeTeamCount());

    for (let i = 0; i < teamLabels.length; i++) {
      teams.set(i, []);
    }
    teams.set(null, []);
    teams.set(-1, []);

    for (const client of this.clients) {
      const teamIndex = this.playerTeamAssignments[client.clientID] ?? null;
      if (teams.has(teamIndex)) {
        teams.get(teamIndex)?.push(client);
      } else {
        teams.get(null)?.push(client);
      }
    }

    const unassignedPlayers = teams.get(null) ?? [];
    const spectators = teams.get(-1) ?? [];
    teams.delete(null);
    teams.delete(-1);

    const renderPlayerList = (players: ClientInfo[]) =>
      repeat(
        players,
        (client) => client.clientID,
        (client) => this.renderPlayerCard(client),
      );

    return html`
      <div class="teams-layout-container">
        <!-- Unassigned Players -->
        ${unassignedPlayers.length > 0
          ? html`
              <div class="unassigned-column">
                <div class="team-column-header">
                  ${translateText("host_modal.unassigned_players")}
                </div>
                <div class="unassigned-body">
                  ${renderPlayerList(unassignedPlayers)}
                </div>
              </div>
            `
          : ""}

        <!-- Assigned Teams -->
        <div class="team-columns">
          ${Array.from(teams.entries()).map(([teamIndex, players]) => {
            const teamLabel =
              teamLabels[teamIndex as number] ?? `Team ${teamIndex}`;
            const teamColor = this.theme
              .teamColor(teamLabel)
              .alpha(0.1)
              .toRgbString();
            return html`
              <div class="team-column" style="background-color: ${teamColor}">
                <div class="team-column-header">${teamLabel}</div>
                <div class="team-column-body">${renderPlayerList(players)}</div>
              </div>
            `;
          })}
        </div>

        <!-- Spectators -->
        ${spectators.length > 0
          ? html`
              <div class="spectator-column">
                <div class="team-column-header">
                  ${translateText("host_modal.spectator")}
                </div>
                <div class="team-column-body">
                  ${renderPlayerList(spectators)}
                </div>
              </div>
            `
          : ""}
      </div>
    `;
  }

  private renderPlayerCard(client: ClientInfo) {
    return html`
      <span class="player-tag">
        <span class="player-name">${client.username}</span>
        ${this.renderPlayerTeamSelect(client)}
        ${client.clientID !== this.lobbyCreatorClientID
          ? html`
              <button
                class="remove-player-btn"
                @click=${() => this.kickPlayer(client.clientID)}
                title=$\{translateText("host_modal.remove_player", \{ username: client.username \})\}
              >
                ×
              </button>
            `
          : html`<span class="host-badge"
              >(${translateText("host_modal.host_badge")})</span
            >`}
      </span>
    `;
  }

  private async putGameConfig() {
    const config = await getServerConfigFromClient();
    const assignmentsPayload =
      this.gameMode === GameMode.Team
        ? this.sanitizeAssignmentsForPayload(
            this.playerTeamAssignments,
            this.computeTeamCount(),
          )
        : {};
    const response = await fetch(
      `${window.location.origin}/${config.workerPath(this.lobbyId)}/api/game/${this.lobbyId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameMap: this.selectedMap,
          difficulty: this.selectedDifficulty,
          disableNPCs: this.disableNPCs,
          bots: this.bots,
          infiniteGold: this.infiniteGold,
          infiniteTroops: this.infiniteTroops,
          instantBuild: this.instantBuild,
          instantResearchHumanOnly: this.instantResearchHumanOnly,
          researchAllTechs: this.researchAllTechs,
          gameMode: this.gameMode,
          disabledUnits: this.disabledUnits,
          playerTeams: this.teamCount,
          playerTeamAssignments: assignmentsPayload,
          peaceTimerDurationMinutes: this.selectedPeaceTimerDuration,
          startingGold: this.startingGold,
          goldMultiplier: this.goldMultiplier,
        } satisfies Partial<GameConfig>),
      },
    );
    return response;
  }

  private toggleUnit(unit: UnitType, checked: boolean): void {
    this.disabledUnits = checked
      ? [...this.disabledUnits, unit]
      : this.disabledUnits.filter((u) => u !== unit);

    this.putGameConfig();
  }

  private getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  private async startGame() {
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }

    await this.putGameConfig();
    this.close();
    const config = await getServerConfigFromClient();
    const response = await fetch(
      `${window.location.origin}/${config.workerPath(this.lobbyId)}/api/start_game/${this.lobbyId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
    return response;
  }

  private async copyToClipboard() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/#join=${this.lobbyId}`,
      );
      this.copySuccess = true;
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    } catch (err) {
      console.error(`Failed to copy text: ${err}`);
    }
  }

  private async pollPlayers() {
    const config = await getServerConfigFromClient();
    fetch(`/${config.workerPath(this.lobbyId)}/api/game/${this.lobbyId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
      .then((response) => response.json())
      .then((data: GameInfo) => {
        const clients = data.clients ?? [];
        const serverAssignments = data.gameConfig?.playerTeamAssignments ?? {};

        if (data.gameConfig?.gameMode !== GameMode.Team) {
          this.playerTeamAssignments = {};
        } else {
          if (this.updatingTeamForClients.size > 0) {
            for (const lockedClientID of [...this.updatingTeamForClients]) {
              const localValue = this.playerTeamAssignments[lockedClientID];
              const serverValue = serverAssignments[lockedClientID];
              if (localValue === serverValue) {
                this.updatingTeamForClients.delete(lockedClientID);
              }
            }
          }
          const mergedAssignments: Record<string, number | null> = {};
          for (const client of clients) {
            const clientID = client.clientID;
            if (this.updatingTeamForClients.has(clientID)) {
              mergedAssignments[clientID] =
                this.playerTeamAssignments[clientID];
              continue;
            }
            const hasServerValue = Object.prototype.hasOwnProperty.call(
              serverAssignments,
              clientID,
            );
            if (hasServerValue) {
              mergedAssignments[clientID] = serverAssignments[clientID];
            } else if (client.teamIndex !== undefined) {
              mergedAssignments[clientID] = client.teamIndex;
            } else {
              mergedAssignments[clientID] = null;
            }
          }
          this.playerTeamAssignments = mergedAssignments;
        }

        this.clients = clients;
        if (data.gameConfig?.gameMode !== undefined) {
          this.gameMode = data.gameConfig.gameMode;
        }
        if (data.gameConfig?.playerTeams !== undefined) {
          this.teamCount = data.gameConfig.playerTeams;
        }
        if (data.gameConfig?.startingGold !== undefined) {
          this.startingGold = data.gameConfig.startingGold;
        }
        if (data.gameConfig?.goldMultiplier !== undefined) {
          this.goldMultiplier = data.gameConfig.goldMultiplier;
        }
        if (data.gameConfig?.researchAllTechs !== undefined) {
          this.researchAllTechs = Boolean(data.gameConfig.researchAllTechs);
        }
      });
  }

  private kickPlayer(clientID: string) {
    this.dispatchEvent(
      new CustomEvent("kick-player", {
        detail: { target: clientID },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

async function createLobby(creatorClientID: string): Promise<GameInfo> {
  const config = await getServerConfigFromClient();
  try {
    const id = generateID();
    const response = await fetch(
      `/${config.workerPath(id)}/api/create_game/${id}?creatorClientID=${encodeURIComponent(creatorClientID)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as GameInfo;
  } catch (error) {
    console.error("Error creating lobby:", error);
    throw error;
  }
}
