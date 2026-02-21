import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

export const GAME_LOADING_VISIBILITY_CHANGE_EVENT =
  "game-loading-visibility-change";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  static styles = css`
    .modal {
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
      width: 300px;
      text-align: center;
      overflow: hidden;
      position: fixed;
      transition:
        opacity 0.3s ease-in-out,
        visibility 0.3s ease-in-out;
    }

    .modal.visible {
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

    .modal h2 {
      margin-bottom: 15px;
      font-size: 22px;
      color: var(--ui-text-accent);
    }

    .modal p {
      margin-bottom: 20px;
      background-color: var(--ui-table-row-bg);
      padding: 10px;
      border-radius: 5px;
    }

    @media (max-width: 1024px) and (pointer: coarse) {
      .modal {
        width: min(88vw, 420px);
        padding: 16px 14px 14px;
        border-radius: 8px 12px 9px 7px;
        border: 1px solid rgba(122, 134, 151, 0.68);
        background:
          linear-gradient(
            124deg,
            rgba(207, 216, 229, 0.12) 0 16%,
            rgba(0, 0, 0, 0) 41%
          ),
          linear-gradient(
            305deg,
            rgba(88, 98, 112, 0.14) 0 20%,
            rgba(0, 0, 0, 0) 44%
          ),
          linear-gradient(
            180deg,
            rgba(84, 95, 111, 0.988),
            rgba(61, 71, 85, 0.994) 48%,
            rgba(45, 53, 64, 0.996)
          );
        box-shadow:
          0 0 0 1px rgba(210, 149, 109, 0.45),
          0 12px 28px rgba(0, 0, 0, 0.42),
          inset 0 1px 0 rgba(226, 235, 246, 0.18),
          inset 0 -12px 18px rgba(0, 0, 0, 0.2);
      }

      .modal::before {
        content: "";
        position: absolute;
        inset: 8px;
        border-radius: 6px 9px 7px 5px;
        border: 1px solid rgba(97, 109, 124, 0.56);
        box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.24);
        pointer-events: none;
      }

      .modal::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background:
          radial-gradient(
            circle at 10px 10px,
            rgba(184, 194, 206, 0.72) 0 1px,
            rgba(30, 36, 44, 0.9) 1.2px 3.5px,
            rgba(0, 0, 0, 0) 3.8px
          ),
          radial-gradient(
            circle at calc(100% - 11px) calc(100% - 10px),
            rgba(152, 163, 178, 0.44) 0 0.8px,
            rgba(22, 27, 34, 0.82) 1px 3px,
            rgba(0, 0, 0, 0) 3.4px
          );
      }

      .modal h2 {
        position: relative;
        z-index: 1;
        margin-bottom: 12px;
        font-size: 20px;
        color: rgba(236, 242, 252, 0.98);
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
      }

      .modal p {
        position: relative;
        z-index: 1;
        margin-bottom: 0;
        padding: 10px 12px;
        border-radius: 6px 8px 7px 5px;
        border: 1px solid rgba(116, 129, 147, 0.54);
        background: linear-gradient(
          180deg,
          rgba(68, 79, 94, 0.96),
          rgba(48, 57, 69, 0.98)
        );
        color: rgba(220, 229, 242, 0.95);
      }
    }

    .button-container {
      display: flex;
      justify-content: center;
      gap: 10px;
    }

    .modal button {
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

    .modal button:hover {
      background: var(--ui-primary-hover);
      transform: translateY(-1px);
    }

    .modal button:active {
      transform: translateY(1px);
    }
  `;

  render() {
    return html`
      <div class="modal ${this.isVisible ? "visible" : ""}">
        <h2>${translateText("game_starting_modal.title")}</h2>
        <p>${translateText("game_starting_modal.desc")}</p>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    window.dispatchEvent(
      new CustomEvent<{ visible: boolean }>(
        GAME_LOADING_VISIBILITY_CHANGE_EVENT,
        {
          detail: { visible: true },
        },
      ),
    );
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    window.dispatchEvent(
      new CustomEvent<{ visible: boolean }>(
        GAME_LOADING_VISIBILITY_CHANGE_EVENT,
        {
          detail: { visible: false },
        },
      ),
    );
    this.requestUpdate();
  }
}
