import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("heads-up-message")
export class HeadsUpMessage extends LitElement implements Layer {
  layerName = "HeadsUpMessage";
  public game: GameView;

  @state()
  private isVisible = false;

  private settings = new UserSettings();

  static styles = css`
    .heads-up-container {
      position: fixed;
      left: 0;
      right: 0;
      z-index: 1600;
      display: flex;
      justify-content: center;
      padding: 0 16px;
    }

    /* Desktop positioning */
    body:not(.mobile-ui-enabled) .heads-up-container {
      top: 20px;
    }

    /* Mobile positioning - below spawn timer */
    body.mobile-ui-enabled .heads-up-container {
      top: calc(env(safe-area-inset-top, 0px) + 54px);
      pointer-events: none;
    }

    body.mobile-ui-enabled .heads-up-message {
      pointer-events: none;
    }

    .heads-up-message {
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: white;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      user-select: none;
    }

    /* Desktop larger styling */
    body:not(.mobile-ui-enabled) .heads-up-message {
      font-size: 20px;
      padding: 12px 24px;
      border-radius: 12px;
    }
  `;

  createRenderRoot() {
    return this;
  }

  init() {
    // Hide if tutorials are enabled (spawn_welcome tip covers this)
    this.isVisible = !this.settings.tutorialEnabled();
    this.requestUpdate();
  }

  tick() {
    if (!this.game.inSpawnPhase()) {
      this.isVisible = false;
      this.requestUpdate();
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    // Inject styles into document head if not already present
    if (!document.querySelector("style[data-heads-up-message]")) {
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-heads-up-message", "");
      styleEl.textContent = HeadsUpMessage.styles.cssText;
      document.head.appendChild(styleEl);
    }

    return html`
      <div class="heads-up-container">
        <div
          class="heads-up-message"
          @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        >
          ${translateText("heads_up_message.choose_spawn")}
        </div>
      </div>
    `;
  }
}
