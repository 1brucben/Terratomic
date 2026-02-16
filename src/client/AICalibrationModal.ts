import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { AIProfile, getAllAIProfiles } from "../core/ai/AIBehaviorParams";
import { Difficulty, GameMapType, GameMode, GameType } from "../core/game/Game";
import { generateID } from "../core/Util";
import { CalibrationConfig, CalibrationResult } from "./CalibrationRunner";
import type {
  CalibrationWorkerMessage,
  CalibrationWorkerRequest,
} from "./CalibrationWorker";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import type { JoinLobbyEvent } from "./Main";

interface BatchResult {
  matchIndex: number;
  result: CalibrationResult;
}

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
  @state() private numMatches = 10;
  @state() private isRunning = false;
  @state() private completedMatches = 0;
  @state() private totalMatches = 0;
  @state() private batchResults: BatchResult[] = [];
  @state() private renderMatch = false;

  private profiles: AIProfile[] = [];
  private activeWorkers: Worker[] = [];

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

    .calib-batch-summary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 12px;
    }

    .calib-vs {
      color: var(--ui-text-secondary, #aaa);
      font-size: 14px;
      font-weight: normal;
    }

    .calib-match-list {
      max-height: 200px;
      overflow-y: auto;
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .calib-match-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      padding: 4px 8px;
      border-radius: 4px;
      background: var(--ui-panel-bg, #1e1e1e);
    }

    .calib-match-num {
      min-width: 30px;
      color: var(--ui-text-secondary, #aaa);
      font-family: monospace;
    }

    .calib-match-ticks {
      margin-left: auto;
      color: var(--ui-text-secondary, #aaa);
      font-family: monospace;
      font-size: 12px;
    }
  `;

  open() {
    this.batchResults = [];
    this.isRunning = false;
    this.completedMatches = 0;
    this.totalMatches = 0;
    this.cleanupWorkers();
    this.modalEl.open();
  }

  close() {
    this.cleanupWorkers();
    this.modalEl.close();
  }

  private cleanupWorkers() {
    for (const w of this.activeWorkers) {
      w.terminate();
    }
    this.activeWorkers = [];
  }

  render() {
    const maps = Object.values(GameMapType);
    const playerSliderPercent = ((this.numPlayers - 2) / 38) * 100;
    const botSliderPercent = (this.bots / 400) * 100;
    const matchSliderPercent = ((this.numMatches - 1) / 49) * 100;

    // Aggregate batch results
    const profileAWins = this.batchResults.filter(
      (r) => r.result.winnerProfile === this.selectedProfileA,
    ).length;
    const profileBWins = this.batchResults.filter(
      (r) => r.result.winnerProfile === this.selectedProfileB,
    ).length;
    const draws = this.batchResults.filter(
      (r) => r.result.winnerProfile === null,
    ).length;

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
                  ? "Will render 1 match (slower)"
                  : "Headless (fast)"}</span
              >
            </div>
          </div>

          <!-- Number of Matches (hidden when rendering) -->
          ${!this.renderMatch
            ? html`
                <div class="calib-row">
                  <label>Matches</label>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    .value=${String(this.numMatches)}
                    style="--progress: ${matchSliderPercent}%"
                    @input=${(e: Event) =>
                      (this.numMatches = Number(
                        (e.target as HTMLInputElement).value,
                      ))}
                  />
                  <span class="range-value">${this.numMatches}</span>
                </div>
              `
            : html``}

          <!-- Progress -->
          ${this.isRunning
            ? html`
                <div class="calib-section">
                  <div class="calib-progress-bar">
                    <div
                      class="calib-progress-bar-fill"
                      style="width: ${(this.completedMatches /
                        this.totalMatches) *
                      100}%"
                    ></div>
                  </div>
                  <div class="calib-progress">
                    <div>
                      Match ${this.completedMatches} / ${this.totalMatches}
                      completed (${this.totalMatches - this.completedMatches}
                      running on worker threads)
                    </div>
                  </div>
                </div>
              `
            : html``}

          <!-- Batch Results -->
          ${this.batchResults.length > 0
            ? html`
                <div class="calib-section">
                  <div class="calib-result">
                    <h3>
                      Results (${this.batchResults.length}/${this.totalMatches}
                      matches)
                    </h3>
                    <div class="calib-batch-summary">
                      <span class="calib-player-a"
                        >${this.getProfileName(this.selectedProfileA)}:
                        ${profileAWins} wins</span
                      >
                      <span class="calib-vs">vs</span>
                      <span class="calib-player-b"
                        >${this.getProfileName(this.selectedProfileB)}:
                        ${profileBWins} wins</span
                      >
                      ${draws > 0
                        ? html`<span class="draw-result"
                            >(${draws} draws)</span
                          >`
                        : html``}
                    </div>

                    <!-- Per-match details -->
                    <div class="calib-match-list">
                      ${this.batchResults
                        .sort((a, b) => a.matchIndex - b.matchIndex)
                        .map(
                          (r) => html`
                            <div class="calib-match-row">
                              <span class="calib-match-num"
                                >#${r.matchIndex + 1}</span
                              >
                              ${r.result.winnerProfile
                                ? html`
                                    <span
                                      class=${r.result.winnerProfile ===
                                      this.selectedProfileA
                                        ? "calib-player-a"
                                        : "calib-player-b"}
                                    >
                                      ${r.result.winnerPlayerName}
                                      (${this.getProfileName(
                                        r.result.winnerProfile,
                                      )})
                                    </span>
                                  `
                                : html`<span class="draw-result">Draw</span>`}
                              <span class="calib-match-ticks"
                                >${r.result.ticksElapsed} ticks</span
                              >
                            </div>
                          `,
                        )}
                    </div>
                  </div>
                </div>
              `
            : html``}

          <!-- Actions -->
          <div class="calib-actions">
            ${this.isRunning
              ? html`<span style="color: var(--ui-text-secondary)"
                  >Running ${this.totalMatches} matches...</span
                >`
              : html`
                  <o-button
                    title=${this.renderMatch
                      ? "Watch Match"
                      : `Run ${this.numMatches} Match${this.numMatches > 1 ? "es" : ""}`}
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
      this.launchRenderedCalibration(calibConfig);
      return;
    }

    // Headless batch mode — spawn workers
    this.isRunning = true;
    this.batchResults = [];
    this.completedMatches = 0;
    this.totalMatches = this.numMatches;
    this.cleanupWorkers();

    const promises: Promise<void>[] = [];

    for (let i = 0; i < this.numMatches; i++) {
      promises.push(this.runMatchInWorker(i, calibConfig));
    }

    await Promise.all(promises);
    this.isRunning = false;
  }

  private runMatchInWorker(
    matchIndex: number,
    config: CalibrationConfig,
  ): Promise<void> {
    return new Promise((resolve) => {
      const worker = new Worker(
        new URL("./CalibrationWorker.ts", import.meta.url),
      );
      this.activeWorkers.push(worker);

      worker.addEventListener(
        "message",
        (e: MessageEvent<CalibrationWorkerMessage>) => {
          const msg = e.data;
          if (msg.type === "result") {
            this.batchResults = [
              ...this.batchResults,
              { matchIndex: msg.matchIndex, result: msg.result },
            ];
            this.completedMatches++;
          } else if (msg.type === "error") {
            console.error(`Match #${msg.matchIndex + 1} failed: ${msg.error}`);
            this.batchResults = [
              ...this.batchResults,
              {
                matchIndex: msg.matchIndex,
                result: {
                  winnerProfile: null,
                  winnerPlayerName: null,
                  winnerPlayerID: null,
                  ticksElapsed: 0,
                  profileAPlayers: [],
                  profileBPlayers: [],
                },
              },
            ];
            this.completedMatches++;
          }

          // Clean up this worker
          worker.terminate();
          this.activeWorkers = this.activeWorkers.filter((w) => w !== worker);
          resolve();
        },
      );

      const request: CalibrationWorkerRequest = {
        type: "run",
        matchIndex,
        config,
      };
      worker.postMessage(request);
    });
  }

  private launchRenderedCalibration(calibConfig: CalibrationConfig) {
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
              disableNPCs: false,
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
