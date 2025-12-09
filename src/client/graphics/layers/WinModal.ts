import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { GameRecord } from "../../../core/Schemas";
import { encodeReplay, isCompressionSupported } from "../../ReplayCodec";
import { SendWinnerEvent } from "../../Transport";
import { Layer } from "./Layer";

@customElement("win-modal")
export class WinModal extends LitElement implements Layer {
  layerName = "WinModal";
  public game: GameView;
  public eventBus: EventBus;
  private static stylesApplied = false;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  @state()
  private gameRecord: GameRecord | null = null;

  @state()
  private replayCode: string = "";

  @state()
  private encoding: boolean = false;

  @state()
  private copied: boolean = false;

  @state()
  private showReplayOptions: boolean = false;

  @state()
  private encodeError: string = "";

  private _title: string;

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  static styles = css`
    .win-modal {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: var(--ui-modal-content);
      padding: 25px;
      border-radius: 10px;
      z-index: 9999;
      box-shadow: var(--ui-panel-shadow);
      backdrop-filter: blur(5px);
      color: var(--ui-text-default);
      width: 350px;
      transition:
        opacity 0.3s ease-in-out,
        visibility 0.3s ease-in-out;
    }

    .win-modal.visible {
      display: block;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translate(-50%, -48%);
      }
      to {
        opacity: 1;
        transform: translate(-50%, -50%);
      }
    }

    .win-modal h2 {
      margin: 0 0 15px 0;
      font-size: 26px;
      text-align: center;
      color: var(--ui-text-accent);
    }

    .win-modal p {
      margin: 0 0 20px 0;
      text-align: center;
      background-color: var(--ui-table-row-bg);
      padding: 10px;
      border-radius: 5px;
    }

    .button-container {
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }

    .win-modal button {
      flex: 1;
      padding: 12px;
      font-size: 16px;
      cursor: pointer;
      background: var(--ui-primary);
      color: var(--ui-button-text);
      border: none;
      border-radius: 5px;
      transition:
        background-color 0.2s ease,
        transform 0.1s ease;
    }

    .win-modal button:hover {
      background: var(--ui-primary-hover);
      transform: translateY(-1px);
    }

    .win-modal button:active {
      transform: translateY(1px);
    }

    .win-modal button.secondary {
      background: var(--ui-secondary);
    }

    .win-modal button.secondary:hover {
      background: var(--ui-secondary-hover);
    }

    .replay-options {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid var(--ui-border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    @media (max-width: 768px) {
      .win-modal {
        width: 90%;
        max-width: 300px;
        padding: 20px;
      }

      .win-modal h2 {
        font-size: 26px;
      }

      .win-modal button {
        padding: 10px;
        font-size: 14px;
      }
    }

    .win-modal__link {
      color: var(--ui-text-accent);
      text-decoration: underline;
      font-weight: 500;
      transition: color 0.2s ease;
      font-size: 24px;
    }

    .win-modal__link:hover {
      color: var(--ui-secondary-hover);
    }
  `;

  constructor() {
    super();
    if (!WinModal.stylesApplied) {
      const styleEl = document.createElement("style");
      styleEl.id = "win-modal-styles";
      styleEl.textContent = (WinModal.styles as any).toString();
      document.head.appendChild(styleEl);
      WinModal.stylesApplied = true;
    }
  }

  setGameRecord(record: GameRecord) {
    this.gameRecord = record;
    this.replayCode = "";
    this.encodeError = "";
    this.showReplayOptions = false;
    this.requestUpdate();
  }

  async prepareReplay() {
    if (!this.gameRecord) return;

    this.showReplayOptions = true;
    this.encodeError = "";
    if (this.replayCode) return;

    if (!isCompressionSupported()) {
      this.encodeError =
        "Your browser does not support replay encoding. Please use a modern browser.";
      return;
    }

    this.encoding = true;
    try {
      this.replayCode = await encodeReplay(this.gameRecord);
    } catch (err) {
      console.error("Failed to encode replay:", err);
      this.encodeError = "Failed to encode replay. Please try again.";
    }
    this.encoding = false;
  }

  async copyToClipboard() {
    if (!this.replayCode) return;
    try {
      await navigator.clipboard.writeText(this.replayCode);
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }

  downloadAsFile() {
    if (!this.replayCode) return;
    const blob = new Blob([this.replayCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terratomic-replay-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  render() {
    return html`
      <div class="win-modal ${this.isVisible ? "visible" : ""}">
        <h2>${this._title || ""}</h2>
        <div class="button-container">
          <button @click=${this._handleExit}>
            ${translateText("win_modal.exit")}
          </button>
          <button @click=${this.hide}>
            ${translateText("win_modal.keep")}
          </button>
        </div>

        ${this.gameRecord
          ? html`
              <div class="button-container" style="margin-top: 10px;">
                <button class="secondary" @click=${this.prepareReplay}>
                  ${translateText("win_modal.save_replay")}
                </button>
              </div>
            `
          : ""}
        ${this.showReplayOptions
          ? html`
              <div class="replay-options">
                ${this.encodeError
                  ? html`<p style="color: #f87171;">${this.encodeError}</p>`
                  : this.encoding
                    ? html`<p>${translateText("win_modal.encoding_replay")}</p>`
                    : html`
                        <div class="button-container">
                          <button @click=${this.copyToClipboard}>
                            ${this.copied
                              ? translateText("win_modal.copied")
                              : translateText("win_modal.copy_to_clipboard")}
                          </button>
                          <button @click=${this.downloadAsFile}>
                            ${translateText("win_modal.download_file")}
                          </button>
                        </div>
                      `}
              </div>
            `
          : ""}

        <div class="button-container" style="margin-top: 10px;">
          <button
            @click=${() =>
              window.open("https://discord.gg/w8HXjhaBkU", "_blank")}
            style="background-color: #5865F2;"
          >
            ${translateText("main.join_discord")}
          </button>
        </div>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  showSaveReplay(record: GameRecord) {
    this.gameRecord = record;
    this.replayCode = "";
    this.showReplayOptions = false;
    this._title = translateText("win_modal.save_replay");
    this.show();
    this.prepareReplay();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }

  private _handleExit() {
    this.hide();
    window.location.href = "/";
  }

  init() {}

  tick() {
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = translateText("win_modal.died");
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
        }
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.name(),
          });
        }
        this.show();
      }
    });
  }

  renderLayer(/* context: CanvasRenderingContext2D */) {}

  shouldTransform(): boolean {
    return false;
  }
}
