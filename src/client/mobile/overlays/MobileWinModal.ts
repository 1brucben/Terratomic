import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type { GameView } from "../../../core/game/GameView";
import type { GameRecord } from "../../../core/Schemas";
import { encodeReplay, isCompressionSupported } from "../../ReplayCodec";
import { SendWinnerEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { HapticFeedback } from "../utils/HapticFeedback";

@customElement("mobile-win-modal")
export class MobileWinModal extends LitElement {
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) eventBus: EventBus | null = null;

  @state() private isVisible = false;
  @state() private modalTitle = "";
  @state() private gameRecord: GameRecord | null = null;
  @state() private replayCode = "";
  @state() private encoding = false;
  @state() private copied = false;
  @state() private showReplayOptions = false;
  @state() private encodeError = "";

  private hasShownDeathModal = false;

  static styles = css`
    :host {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 3600;
      pointer-events: none;
      display: none;
    }

    :host([visible]) {
      display: block;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 8, 13, 0.62);
      backdrop-filter: blur(2px);
      pointer-events: auto;
    }

    .sheet {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
      border-radius: 12px;
      background:
        linear-gradient(
          180deg,
          rgba(66, 78, 92, 0.14) 0%,
          rgba(33, 40, 50, 0.1) 36%,
          rgba(16, 20, 28, 0.04) 100%
        ),
        linear-gradient(
          180deg,
          rgba(31, 38, 48, 0.97) 0%,
          rgba(20, 26, 34, 0.98) 60%,
          rgba(12, 17, 23, 0.98) 100%
        );
      border: 1px solid rgba(140, 152, 167, 0.3);
      box-shadow:
        inset 0 1px 0 rgba(225, 233, 242, 0.09),
        0 18px 34px rgba(0, 0, 0, 0.48);
      color: rgba(236, 243, 250, 0.96);
      padding: 16px;
      pointer-events: auto;
      animation: sheetIn 0.2s ease-out;
    }

    @keyframes sheetIn {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    h2 {
      margin: 0 0 10px 0;
      font-size: 20px;
      line-height: 1.2;
      text-align: center;
      color: rgba(248, 202, 127, 0.96);
    }

    .button-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }

    button {
      min-height: 44px;
      border: 1px solid rgba(136, 148, 164, 0.3);
      border-radius: 8px;
      background: linear-gradient(
        180deg,
        rgba(57, 88, 140, 0.86) 0%,
        rgba(36, 60, 97, 0.92) 100%
      );
      color: rgba(240, 245, 252, 0.97);
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    button:active {
      transform: translateY(1px) scale(0.99);
      filter: brightness(1.06);
    }

    button.secondary {
      background: linear-gradient(
        180deg,
        rgba(72, 82, 96, 0.86) 0%,
        rgba(44, 53, 65, 0.92) 100%
      );
    }

    button.discord {
      background: linear-gradient(
        180deg,
        rgba(96, 110, 241, 0.9) 0%,
        rgba(74, 86, 219, 0.95) 100%
      );
    }

    .replay-options {
      margin-top: 10px;
      border-top: 1px solid rgba(120, 132, 147, 0.3);
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .error {
      margin: 0;
      color: rgba(248, 145, 145, 0.95);
      text-align: center;
      font-size: 13px;
    }

    .status {
      margin: 0;
      text-align: center;
      color: rgba(214, 225, 239, 0.9);
      font-size: 13px;
    }
  `;

  private setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      this.setAttribute("visible", "");
    } else {
      this.removeAttribute("visible");
    }
  }

  show(): void {
    this.setVisible(true);
  }

  hide = (): void => {
    this.setVisible(false);
  };

  setGameRecord(record: GameRecord): void {
    this.gameRecord = record;
    this.replayCode = "";
    this.encodeError = "";
    this.showReplayOptions = false;
  }

  showSaveReplay(record: GameRecord): void {
    this.setGameRecord(record);
    this.modalTitle = translateText("win_modal.save_replay");
    this.show();
    void this.prepareReplay();
  }

  async prepareReplay(): Promise<void> {
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
    } catch (error) {
      console.error("Failed to encode replay:", error);
      this.encodeError = "Failed to encode replay. Please try again.";
    }
    this.encoding = false;
  }

  async copyToClipboard(): Promise<void> {
    if (!this.replayCode) return;
    try {
      await navigator.clipboard.writeText(this.replayCode);
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }

  downloadAsFile(): void {
    if (!this.replayCode) return;
    const blob = new Blob([this.replayCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `terratomic-replay-${Date.now()}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private handleExit = (): void => {
    HapticFeedback.success();
    this.hide();
    window.location.href = "/";
  };

  private handleKeep = (): void => {
    HapticFeedback.tap();
    this.hide();
  };

  private handleSaveReplay = (): void => {
    HapticFeedback.tap();
    void this.prepareReplay();
  };

  private handleCopyReplay = (): void => {
    HapticFeedback.success();
    void this.copyToClipboard();
  };

  private handleDownloadReplay = (): void => {
    HapticFeedback.tap();
    this.downloadAsFile();
  };

  private handleOpenDiscord = (): void => {
    HapticFeedback.tap();
    window.open("https://discord.gg/w8HXjhaBkU", "_blank");
  };

  tick(): void {
    if (!this.game || !this.eventBus) {
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this.modalTitle = translateText("win_modal.died");
      this.show();
    }

    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];

    winUpdates.forEach((update) => {
      if (update.winner === undefined) {
        return;
      }

      if (update.winner[0] === "team") {
        this.eventBus!.emit(
          new SendWinnerEvent(update.winner, update.allPlayersStats),
        );
        if (update.winner[1] === this.game!.myPlayer()?.team()) {
          this.modalTitle = translateText("win_modal.your_team");
        } else {
          this.modalTitle = translateText("win_modal.other_team", {
            team: update.winner[1],
          });
        }
        this.show();
        return;
      }

      const winner = this.game!.playerByClientID(update.winner[1]);
      if (!winner?.isPlayer()) {
        return;
      }

      const winnerClient = winner.clientID();
      if (winnerClient !== null) {
        this.eventBus!.emit(
          new SendWinnerEvent(["player", winnerClient], update.allPlayersStats),
        );
      }

      if (
        winnerClient !== null &&
        winnerClient === this.game!.myPlayer()?.clientID()
      ) {
        this.modalTitle = translateText("win_modal.you_won");
      } else {
        this.modalTitle = translateText("win_modal.other_won", {
          player: winner.name(),
        });
      }
      this.show();
    });
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div class="backdrop" @click=${this.handleKeep}></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <h2>${this.modalTitle}</h2>

        <div class="button-container">
          <button @click=${this.handleExit}>
            ${translateText("win_modal.exit")}
          </button>
          <button class="secondary" @click=${this.handleKeep}>
            ${translateText("win_modal.keep")}
          </button>
        </div>

        ${this.gameRecord
          ? html`
              <div class="button-container">
                <button class="secondary" @click=${this.handleSaveReplay}>
                  ${translateText("win_modal.save_replay")}
                </button>
              </div>
            `
          : ""}
        ${this.showReplayOptions
          ? html`
              <div class="replay-options">
                ${this.encodeError
                  ? html`<p class="error">${this.encodeError}</p>`
                  : this.encoding
                    ? html`
                        <p class="status">
                          ${translateText("win_modal.encoding_replay")}
                        </p>
                      `
                    : html`
                        <div class="button-container">
                          <button @click=${this.handleCopyReplay}>
                            ${this.copied
                              ? translateText("win_modal.copied")
                              : translateText("win_modal.copy_to_clipboard")}
                          </button>
                          <button @click=${this.handleDownloadReplay}>
                            ${translateText("win_modal.download_file")}
                          </button>
                        </div>
                      `}
              </div>
            `
          : ""}

        <div class="button-container">
          <button class="discord" @click=${this.handleOpenDiscord}>
            ${translateText("main.join_discord")}
          </button>
        </div>
      </div>
    `;
  }
}
