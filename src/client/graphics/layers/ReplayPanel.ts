import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { ReplaySpeedChangeEvent } from "../../InputHandler";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../utilities/ReplaySpeedMultiplier";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("replay-panel")
export class ReplayPanel extends LitElement implements Layer {
  layerName = "ReplayPanel";
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;

  @state()
  private _replaySpeedMultiplier: number = defaultReplaySpeedMultiplier;
  private _isSinglePlayer: boolean = false;

  @state()
  private _isVisible = false;

  init() {
    this._isSinglePlayer =
      this.game?.config().gameConfig().gameType === GameType.Singleplayer;
    if (this._isSinglePlayer) {
      this.setVisible(true);
    }
  }

  tick() {
    if (!this._isVisible && this.game?.config().isReplay()) {
      this.setVisible(true);
    }

    this.requestUpdate();
  }

  onReplaySpeedChange(value: ReplaySpeedMultiplier) {
    this._replaySpeedMultiplier = value;
    this.eventBus?.emit(new ReplaySpeedChangeEvent(value));
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render any necessary canvas elements
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisible(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  render() {
    if (!this._isVisible) {
      return html``;
    }

    const options: Array<{ label: string; value: ReplaySpeedMultiplier }> = [
      { label: "×0.5", value: ReplaySpeedMultiplier.slow },
      { label: "×1", value: ReplaySpeedMultiplier.normal },
      { label: "×2", value: ReplaySpeedMultiplier.fast },
      { label: "max", value: ReplaySpeedMultiplier.fastest },
    ];

    return html`
      <div
        class="submarine-panel p-1 lg:p-2"
        style="box-shadow: var(--ui-panel-shadow);"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <label
          class="block mb-1"
          style="color: var(--ui-text-accent)"
          translate="no"
        >
          ${this._isSinglePlayer
            ? translateText("replay_panel.game_speed")
            : translateText("replay_panel.replay_speed")}
        </label>
        <div class="grid grid-cols-2 gap-1">
          ${options.map(
            ({ label, value }) => html`
              <button
                class="text-white font-bold py-0 rounded border transition"
                style=${this.replayButtonStyle(value)}
                @click=${() => this.onReplaySpeedChange(value)}
              >
                ${label}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  private replayButtonStyle(value: ReplaySpeedMultiplier): string {
    const isActive = this._replaySpeedMultiplier === value;
    const background = isActive ? "var(--ui-replay-tab-active)" : "transparent";
    return `color: var(--ui-button-text); border-color: var(--ui-secondary); background-color: ${background};`;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
