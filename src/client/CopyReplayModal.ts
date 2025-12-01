import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameRecord } from "../core/Schemas";
import { encodeReplay } from "./ReplayCodec";

@customElement("copy-replay-modal")
export class CopyReplayModal extends LitElement {
  @property() record!: GameRecord;
  @state() private copied = false;
  @state() private encoding = false;
  @state() private replayCode = "";
  @state() private sizeKB = 0;
  @state() private error = "";

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
    }

    h2 {
      margin: 0 0 16px 0;
      color: #fff;
    }

    .info {
      margin: 12px 0;
      color: #aaa;
    }

    .warning {
      color: #ff9800;
      margin: 12px 0;
      padding: 12px;
      background: rgba(255, 152, 0, 0.1);
      border-left: 3px solid #ff9800;
    }

    .error {
      color: #f44336;
      margin: 12px 0;
      padding: 12px;
      background: rgba(244, 67, 54, 0.1);
      border-left: 3px solid #f44336;
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
      transition: background 0.2s;
    }

    button.primary {
      background: #4caf50;
      color: white;
    }

    button.primary:hover {
      background: #45a049;
    }

    button.secondary {
      background: #2196f3;
      color: white;
    }

    button.secondary:hover {
      background: #0b7dda;
    }

    button.close {
      background: #666;
      color: white;
    }

    button.close:hover {
      background: #555;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .loading {
      text-align: center;
      padding: 20px;
    }
  `;

  async firstUpdated() {
    this.encoding = true;
    try {
      this.replayCode = await encodeReplay(this.record);
      this.sizeKB = Math.round(this.replayCode.length / 1024);
    } catch (err) {
      console.error("Failed to encode replay:", err);
      this.error = "Failed to encode replay: " + (err as Error).message;
    }
    this.encoding = false;
  }

  async copyToClipboard() {
    try {
      await navigator.clipboard.writeText(this.replayCode);
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
      this.error = "Failed to copy to clipboard";
    }
  }

  downloadAsFile() {
    const blob = new Blob([this.replayCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terratomic-replay-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  close() {
    this.remove();
  }

  render() {
    if (this.encoding) {
      return html`
        <div class="modal">
          <div class="loading">
            <h2>Encoding Replay...</h2>
            <p>Compressing game data...</p>
          </div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="modal">
          <h2>Error</h2>
          <div class="error">${this.error}</div>
          <div class="buttons">
            <button class="close" @click=${this.close}>Close</button>
          </div>
        </div>
      `;
    }

    return html`
      <div class="modal">
        <h2>Copy Replay</h2>
        <div class="info">
          <p>Replay size: <strong>${this.sizeKB}KB</strong></p>
          <p>
            Turns:
            <strong>${this.record.info.num_turns.toLocaleString()}</strong>
          </p>
          <p>
            Duration:
            <strong
              >${Math.floor(this.record.info.duration / 60)}m
              ${this.record.info.duration % 60}s</strong
            >
          </p>
        </div>

        ${this.sizeKB > 150
          ? html`
              <div class="warning">
                ⚠️ Large replay (${this.sizeKB}KB). File download is recommended
                for easier sharing.
              </div>
            `
          : ""}

        <div class="buttons">
          <button
            class="primary"
            @click=${this.copyToClipboard}
            ?disabled=${this.copied}
          >
            ${this.copied ? "✓ Copied!" : "Copy to Clipboard"}
          </button>
          <button class="secondary" @click=${this.downloadAsFile}>
            Download as File
          </button>
          <button class="close" @click=${this.close}>Close</button>
        </div>
      </div>
    `;
  }
}
