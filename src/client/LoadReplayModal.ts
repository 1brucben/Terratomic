import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameEndInfo } from "../core/Schemas";
import { decodeReplay } from "./ReplayCodec";

@customElement("load-replay-modal")
export class LoadReplayModal extends LitElement {
  @state() private replayCode = "";
  @state() private preview: GameEndInfo | null = null;
  @state() private error = "";
  @state() private loading = false;

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal {
      background: #1a1a1a;
      border: 2px solid #444;
      border-radius: 8px;
      padding: 24px;
      max-width: 600px;
      width: 90%;
      color: #fff;
      max-height: 80vh;
      overflow-y: auto;
    }

    h2 {
      margin: 0 0 16px 0;
      color: #fff;
    }

    textarea {
      width: 100%;
      min-height: 120px;
      background: #2a2a2a;
      border: 1px solid #555;
      border-radius: 4px;
      color: #fff;
      padding: 12px;
      font-family: monospace;
      font-size: 12px;
      resize: vertical;
      box-sizing: border-box;
    }

    .error {
      color: #f44336;
      margin: 12px 0;
      padding: 12px;
      background: rgba(244, 67, 54, 0.1);
      border-left: 3px solid #f44336;
    }

    .preview {
      margin: 16px 0;
      padding: 16px;
      background: #2a2a2a;
      border-radius: 4px;
    }

    .preview h3 {
      margin: 0 0 12px 0;
      color: #4caf50;
    }

    .preview p {
      margin: 6px 0;
      color: #ccc;
    }

    .buttons {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }

    button {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    button.primary {
      background: #4caf50;
      color: white;
    }

    button.close {
      background: #666;
      color: white;
    }

    button:disabled {
      opacity: 0.5;
    }
  `;

  async validateReplay() {
    if (!this.replayCode.trim()) {
      this.preview = null;
      this.error = "";
      return;
    }

    this.loading = true;
    this.error = "";

    try {
      const record = await decodeReplay(this.replayCode);
      this.preview = record.info;
    } catch (err) {
      this.error = (err as Error).message;
      this.preview = null;
    }

    this.loading = false;
  }

  async loadReplay() {
    if (!this.preview) return;
    console.log("Replay loading not yet implemented");
    this.close();
  }

  close() {
    this.remove();
  }

  render() {
    return html`
      <div class="modal">
        <h2>Load Replay</h2>
        <textarea
          .value=${this.replayCode}
          @input=${(e: Event) => {
            this.replayCode = (e.target as HTMLTextAreaElement).value;
            this.validateReplay();
          }}
          placeholder="Paste replay code (TRv1:)..."
        ></textarea>

        ${this.loading ? html`<div>Validating...</div>` : ""}
        ${this.error ? html`<div class="error">${this.error}</div>` : ""}
        ${this.preview
          ? html`
              <div class="preview">
                <h3>Valid Replay</h3>
                <p>Map: ${this.preview.config.gameMap}</p>
                <p>Players: ${this.preview.players.length}</p>
                <p>Turns: ${this.preview.num_turns}</p>
              </div>
            `
          : ""}

        <div class="buttons">
          <button
            class="primary"
            @click=${this.loadReplay}
            ?disabled=${!this.preview}
          >
            Load Replay
          </button>
          <button class="close" @click=${this.close}>Close</button>
        </div>
      </div>
    `;
  }
}
