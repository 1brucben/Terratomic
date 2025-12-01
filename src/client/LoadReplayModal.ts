import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameEndInfo, GameRecord } from "../core/Schemas";
import { decodeReplay } from "./ReplayCodec";

@customElement("load-replay-modal")
export class LoadReplayModal extends LitElement {
  @state() private replayCode = "";
  @state() private preview: GameEndInfo | null = null;
  @state() private fullRecord: GameRecord | null = null;
  @state() private error = "";
  @state() private loading = false;

  // Disable Shadow DOM so we inherit parent styles and sizing
  createRenderRoot() {
    return this;
  }

  async validateReplay() {
    if (!this.replayCode.trim()) {
      this.preview = null;
      this.fullRecord = null;
      this.error = "";
      return;
    }

    this.loading = true;
    this.error = "";

    try {
      const record = await decodeReplay(this.replayCode);
      this.preview = record.info;
      this.fullRecord = record;
    } catch (err) {
      this.error = (err as Error).message;
      this.preview = null;
      this.fullRecord = null;
    }

    this.loading = false;
  }

  async loadReplay() {
    if (!this.preview || !this.fullRecord) return;

    // Use the first player's clientID from the replay so usernames are preserved
    const clientID =
      this.preview.players[0]?.clientID ??
      "replay-viewer-" + Math.floor(Math.random() * 10000);

    // Dispatch join-lobby event with the game record
    const event = new CustomEvent("join-lobby", {
      detail: {
        clientID: clientID,
        gameID: this.preview.gameID,
        gameRecord: this.fullRecord,
      },
      bubbles: true,
      composed: true,
    });
    document.dispatchEvent(event);

    // Close the modal (which is now embedded, so we might need to close the parent settings modal)
    // Since this component is inside UserSettingModal, calling close() here just removes this component from DOM if it was standalone.
    // But in UserSettingModal it's rendered.
    // We should probably dispatch an event to close the settings modal too.
    this.dispatchEvent(
      new CustomEvent("close-modal", { bubbles: true, composed: true }),
    );
  }

  close() {
    this.remove();
  }

  render() {
    return html`
      <div class="w-[360px] flex flex-col text-white">
        <h2 class="mb-4 text-lg font-semibold text-center">Load Replay</h2>
        <textarea
          class="w-full min-h-[240px] bg-zinc-800 border border-zinc-600 rounded p-3 text-white font-mono text-xs resize-y box-border"
          .value=${this.replayCode}
          @input=${(e: Event) => {
            this.replayCode = (e.target as HTMLTextAreaElement).value;
            this.validateReplay();
          }}
          placeholder="Paste replay code (TRv1:)..."
        ></textarea>

        ${this.loading
          ? html`<div class="mt-3 text-gray-400">Validating...</div>`
          : ""}
        ${this.error
          ? html`<div
              class="mt-3 p-3 text-red-400 bg-red-500/10 border-l-4 border-red-500 rounded"
            >
              ${this.error}
            </div>`
          : ""}
        ${this.preview
          ? html`
              <div class="mt-4 p-4 bg-zinc-800 rounded">
                <h3 class="mb-3 text-green-400 font-semibold">Valid Replay</h3>
                <p class="my-1 text-gray-300">
                  Map: ${this.preview.config.gameMap}
                </p>
                <p class="my-1 text-gray-300">
                  Players:
                  ${this.preview.players.map((p) => p.username).join(", ")}
                </p>
                <p class="my-1 text-gray-300">
                  Turns: ${this.preview.num_turns}
                </p>
              </div>
            `
          : ""}

        <div class="flex gap-3 mt-4">
          <button
            class="px-5 py-2.5 rounded cursor-pointer text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            @click=${this.loadReplay}
            ?disabled=${!this.preview}
          >
            Load Replay
          </button>
        </div>
      </div>
    `;
  }
}
