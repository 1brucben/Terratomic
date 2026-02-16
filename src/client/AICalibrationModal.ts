import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { AIProfile, getAllAIProfiles } from "../core/ai/AIBehaviorParams";
import { Difficulty, GameMapType, GameMode, GameType } from "../core/game/Game";
import { generateID } from "../core/Util";
import {
  CalibrationConfig,
  CalibrationProgressCallback,
  CalibrationResult,
  runCalibrationMatch,
} from "./CalibrationRunner";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import type { JoinLobbyEvent } from "./Main";

@customElement("ai-calibration-modal")
export class AICalibrationModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private numPlayers = 10;
  @state() private selectedProfileA = "";
  @state() private selectedProfileB = "";
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private bots = 0;
  @state() private maxTicks = 30000;
  @state() private isRunning = false;
  @state() private progress = 0;
  @state() private progressPlayers: {
    name: string;
    profile: string;
    tiles: number;
  }[] = [];
  @state() private result: CalibrationResult | null = null;
  @state() private renderMatch = false;

  private profiles: AIProfile[] = [];

  connectedCallback() {
    super.connectedCallback();
    this.profiles = getAllAIProfiles();
    if (this.profiles.length > 0) {
      this.selectedProfileA = this.profiles[0].id;
      this.selectedProfileB =
        this.profiles.length > 1 ? this.profiles[1].id : this.profiles[0].id;
    }
  }

  static styles = css`
    .calib-layout {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 500px;
    }

    .calib-row {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .calib-row label {
      min-width: 140px;
      font-weight: 600;
      color: var(--ui-text-default);
    }

    .calib-row select,
    .calib-row input {
      flex: 1;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--ui-panel-border, #555);
      background: var(--ui-input-bg, #2a2a2a);
      color: var(--ui-text-default, #fff);
      font-size: 14px;
    }

    .calib-row input[type="range"] {
      cursor: pointer;
    }

    .calib-row .range-value {
      min-width: 50px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .calib-section {
      border-top: 1px solid var(--ui-panel-border, #555);
      padding-top: 12px;
    }

    .calib-progress {
      background: var(--ui-input-bg, #2a2a2a);
      border-radius: 8px;
      padding: 12px;
      font-family: monospace;
      font-size: 13px;
      max-height: 200px;
      overflow-y: auto;
    }

    .calib-progress-bar {
      height: 8px;
      background: var(--ui-panel-border, #555);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .calib-progress-bar-fill {
      height: 100%;
      background: var(--ui-primary, #4a9eff);
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .calib-result {
      background: var(--ui-input-bg, #2a2a2a);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }

    .calib-result h3 {
      margin: 0 0 8px 0;
      font-size: 18px;
    }

    .calib-result .winner-name {
      font-size: 22px;
      font-weight: bold;
      color: var(--ui-primary, #4a9eff);
    }

    .calib-result .profile-name {
      font-size: 16px;
      color: var(--ui-text-secondary, #aaa);
    }

    .calib-result .tick-count {
      font-size: 13px;
      color: var(--ui-text-secondary, #aaa);
      margin-top: 8px;
    }

    .calib-checkbox {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .calib-checkbox input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }

    .calib-player-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 16px;
      font-size: 13px;
    }

    .calib-player-a {
      color: #4a9eff;
    }

    .calib-player-b {
      color: #ff6b6b;
    }

    .calib-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }

    .draw-result {
      color: var(--ui-text-secondary, #aaa);
    }
  `;

  open() {
    this.result = null;
    this.isRunning = false;
    this.progress = 0;
    this.progressPlayers = [];
    this.modalEl.open();
  }

  close() {
    this.modalEl.close();
  }

  render() {
    const maps = Object.values(GameMapType);
    const playerSliderPercent = ((this.numPlayers - 2) / 38) * 100;
    const botSliderPercent = (this.bots / 400) * 100;

    return html`
      <o-modal title="AI Calibration" max-width="700px" max-height="80dvh">
        <div class="calib-layout">
          <!-- Profile Selection -->
          <div class="calib-row">
            <label>Profile A</label>
            <select
              @change=${(e: Event) =>
                (this.selectedProfileA = (e.target as HTMLSelectElement).value)}
            >
              ${this.profiles.map(
                (p) => html`
                  <option
                    value=${p.id}
                    ?selected=${p.id === this.selectedProfileA}
                  >
                    ${p.name}
                  </option>
                `,
              )}
            </select>
          </div>

          <div class="calib-row">
            <label>Profile B</label>
            <select
              @change=${(e: Event) =>
                (this.selectedProfileB = (e.target as HTMLSelectElement).value)}
            >
              ${this.profiles.map(
                (p) => html`
                  <option
                    value=${p.id}
                    ?selected=${p.id === this.selectedProfileB}
                  >
                    ${p.name}
                  </option>
                `,
              )}
            </select>
          </div>

          <!-- Player Count -->
          <div class="calib-row">
            <label>AI Players</label>
            <input
              type="range"
              min="2"
              max="40"
              step="2"
              .value=${String(this.numPlayers)}
              style="--progress: ${playerSliderPercent}%"
              @input=${(e: Event) =>
                (this.numPlayers = Number(
                  (e.target as HTMLInputElement).value,
                ))}
            />
            <span class="range-value">${this.numPlayers}</span>
          </div>

          <!-- Map Selection -->
          <div class="calib-row">
            <label>Map</label>
            <select
              @change=${(e: Event) =>
                (this.selectedMap = (e.target as HTMLSelectElement)
                  .value as GameMapType)}
            >
              ${maps.map(
                (m) => html`
                  <option value=${m} ?selected=${m === this.selectedMap}>
                    ${m}
                  </option>
                `,
              )}
            </select>
          </div>

          <!-- Bots -->
          <div class="calib-row">
            <label>Bots (NPCs)</label>
            <input
              type="range"
              min="0"
              max="400"
              step="10"
              .value=${String(this.bots)}
              style="--progress: ${botSliderPercent}%"
              @input=${(e: Event) =>
                (this.bots = Number((e.target as HTMLInputElement).value))}
            />
            <span class="range-value">${this.bots}</span>
          </div>

          <!-- Max Ticks -->
          <div class="calib-row">
            <label>Max Ticks</label>
            <input
              type="number"
              min="1000"
              max="100000"
              step="1000"
              .value=${String(this.maxTicks)}
              @input=${(e: Event) =>
                (this.maxTicks = Number((e.target as HTMLInputElement).value))}
            />
          </div>

          <!-- Render checkbox -->
          <div class="calib-row">
            <label>Watch Match</label>
            <div class="calib-checkbox">
              <input
                type="checkbox"
                .checked=${this.renderMatch}
                @change=${(e: Event) =>
                  (this.renderMatch = (e.target as HTMLInputElement).checked)}
              />
              <span
                >${this.renderMatch
                  ? "Will render the match (slower)"
                  : "Headless (fast)"}</span
              >
            </div>
          </div>

          <!-- Progress -->
          ${this.isRunning
            ? html`
                <div class="calib-section">
                  <div class="calib-progress-bar">
                    <div
                      class="calib-progress-bar-fill"
                      style="width: ${this.progress}%"
                    ></div>
                  </div>
                  <div class="calib-progress">
                    <div>
                      Tick ${Math.round((this.progress / 100) * this.maxTicks)}
                      / ${this.maxTicks}
                    </div>
                    ${this.progressPlayers.length > 0
                      ? html`
                          <div
                            class="calib-player-list"
                            style="margin-top: 8px"
                          >
                            ${this.progressPlayers
                              .sort((a, b) => b.tiles - a.tiles)
                              .map(
                                (p) => html`
                                  <span
                                    class=${p.profile === this.selectedProfileA
                                      ? "calib-player-a"
                                      : "calib-player-b"}
                                    >${p.name}</span
                                  >
                                  <span>${p.tiles} tiles</span>
                                `,
                              )}
                          </div>
                        `
                      : html``}
                  </div>
                </div>
              `
            : html``}

          <!-- Result -->
          ${this.result
            ? html`
                <div class="calib-section">
                  <div class="calib-result">
                    ${this.result.winnerProfile
                      ? html`
                          <h3>Winner</h3>
                          <div class="winner-name">
                            ${this.result.winnerPlayerName}
                          </div>
                          <div class="profile-name">
                            Profile:
                            ${this.getProfileName(this.result.winnerProfile)}
                          </div>
                        `
                      : html`
                          <h3 class="draw-result">Draw (max ticks reached)</h3>
                        `}
                    <div class="tick-count">
                      Completed in ${this.result.ticksElapsed} ticks
                    </div>
                    <div style="margin-top: 12px; font-size: 13px;">
                      <div>
                        <span class="calib-player-a"
                          >Profile A
                          (${this.getProfileName(this.selectedProfileA)}):</span
                        >
                        ${this.result.profileAPlayers.join(", ")}
                      </div>
                      <div style="margin-top: 4px;">
                        <span class="calib-player-b"
                          >Profile B
                          (${this.getProfileName(this.selectedProfileB)}):</span
                        >
                        ${this.result.profileBPlayers.join(", ")}
                      </div>
                    </div>
                  </div>
                </div>
              `
            : html``}

          <!-- Actions -->
          <div class="calib-actions">
            ${this.isRunning
              ? html`<span style="color: var(--ui-text-secondary)"
                  >Running...</span
                >`
              : html`
                  <o-button
                    title="Run Match"
                    @click=${this.startCalibration}
                  ></o-button>
                `}
          </div>
        </div>
      </o-modal>
    `;
  }

  private getProfileName(id: string): string {
    return this.profiles.find((p) => p.id === id)?.name ?? id;
  }

  private async startCalibration() {
    const profileA = this.profiles.find((p) => p.id === this.selectedProfileA);
    const profileB = this.profiles.find((p) => p.id === this.selectedProfileB);

    if (!profileA || !profileB) {
      console.error("Profile not found");
      return;
    }

    const calibConfig: CalibrationConfig = {
      numPlayers: this.numPlayers,
      profileA,
      profileB,
      gameMap: this.selectedMap,
      bots: this.bots,
      render: this.renderMatch,
      maxTicks: this.maxTicks,
    };

    if (this.renderMatch) {
      // Launch as a rendered game via the normal game pipeline
      this.launchRenderedCalibration(calibConfig);
      return;
    }

    // Headless mode
    this.isRunning = true;
    this.result = null;
    this.progress = 0;
    this.progressPlayers = [];

    const progressCallback: CalibrationProgressCallback = (info) => {
      this.progress = (info.tick / info.maxTicks) * 100;
      this.progressPlayers = info.players;
    };

    try {
      this.result = await runCalibrationMatch(calibConfig, progressCallback);
    } catch (error) {
      console.error("Calibration match failed:", error);
      this.result = {
        winnerProfile: null,
        winnerPlayerName: null,
        winnerPlayerID: null,
        ticksElapsed: 0,
        profileAPlayers: [],
        profileBPlayers: [],
      };
    } finally {
      this.isRunning = false;
    }
  }

  private launchRenderedCalibration(calibConfig: CalibrationConfig) {
    // For rendered mode, we dispatch a join-lobby event with calibration data.
    // The game will run normally with AI-only players visible to a spectator.
    const clientID = generateID();
    const gameID = generateID();

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
                username: "Spectator",
                flag: "",
              },
            ],
            config: {
              gameMap: calibConfig.gameMap,
              gameType: GameType.Singleplayer,
              gameMode: GameMode.FFA,
              difficulty: Difficulty.Medium,
              disableNPCs: false, // We'll use nations from the map
              bots: calibConfig.bots,
              infiniteGold: false,
              infiniteTroops: false,
              instantBuild: false,
              peaceTimerDurationMinutes: 0,
              startingGold: 0,
              goldMultiplier: 1,
              chatEnabled: false,
            },
          },
          // Pass calibration config as extra data for the game setup
          calibration: {
            numPlayers: calibConfig.numPlayers,
            profileA: calibConfig.profileA,
            profileB: calibConfig.profileB,
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
