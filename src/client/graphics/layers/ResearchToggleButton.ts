import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import "../../ResearchTreeModal";
import type { ResearchTreeModal } from "../../ResearchTreeModal";
import { Layer } from "./Layer";

@customElement("research-toggle-button")
export class ResearchToggleButton extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private _isVisible = false;

  @state()
  private _isModalOpen = false;

  private modalRef: ResearchTreeModal | null = null;

  createRenderRoot() {
    return this; // inherit global styles / Tailwind scale adjustments
  }

  init() {
    this.modalRef = this.lookupModal();
    this.updateModalState();
  }

  tick() {
    const player = this.game?.myPlayer?.();
    const shouldShow = Boolean(
      player && player.isAlive() && !this.game.inSpawnPhase(),
    );
    if (shouldShow !== this._isVisible) {
      this._isVisible = shouldShow;
      this.requestUpdate();
    }
    this.updateModalState();
  }

  shouldTransform(): boolean {
    return false;
  }

  private lookupModal(): ResearchTreeModal | null {
    return document.querySelector(
      "research-tree-modal",
    ) as ResearchTreeModal | null;
  }

  private updateModalState() {
    const modal = this.modalRef ?? this.lookupModal();
    if (!modal) {
      this._isModalOpen = false;
      return;
    }
    this.modalRef = modal;
    const modalShell = modal.shadowRoot?.querySelector("o-modal") as
      | (HTMLElement & { isModalOpen?: boolean })
      | null;
    const isOpen = Boolean(modalShell?.isModalOpen);
    if (isOpen !== this._isModalOpen) {
      this._isModalOpen = isOpen;
      this.requestUpdate();
    }
  }

  private toggleModal = () => {
    const modal = this.modalRef ?? this.lookupModal();
    if (!modal) return;
    modal.game = this.game;
    modal.eventBus = this.eventBus;
    if (this._isModalOpen) {
      modal.close();
    } else {
      modal.open();
    }
    this._isModalOpen = !this._isModalOpen;
  };

  render() {
    if (!this._isVisible) return html``;

    return html`
      <style>
        .research-vertical-button {
          position: fixed;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 10050;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 14px 10px;
          border: 2px solid #0e1a33;
          border-left: none;
          border-radius: 0 6px 6px 0;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-family: "Oswald", sans-serif;
          background: linear-gradient(
            180deg,
            rgba(11, 18, 32, 0.96),
            rgba(24, 39, 66, 0.96)
          );
          color: #e3edff;
          cursor: pointer;
          box-shadow:
            inset 0 0 8px rgba(255, 255, 255, 0.08),
            4px 0 12px rgba(0, 0, 0, 0.45);
          transition:
            transform 120ms ease,
            box-shadow 120ms ease,
            background 120ms ease;
        }
        .research-vertical-button span {
          display: block;
          font-size: 14px;
          line-height: 1.1;
        }
        .research-vertical-button:hover {
          transform: translateY(-50%) scale(1.05);
          box-shadow:
            inset 0 0 12px rgba(255, 255, 255, 0.12),
            8px 0 16px rgba(0, 0, 0, 0.6);
        }
        .research-vertical-button.open {
          background: linear-gradient(
            180deg,
            rgba(47, 74, 122, 0.96),
            rgba(25, 48, 88, 0.96)
          );
          border-color: #27476e;
        }
      </style>
      <button
        type="button"
        class="research-vertical-button ${this._isModalOpen ? "open" : ""}"
        aria-label="Toggle Research Tree"
        @click=${this.toggleModal}
      >
        ${["R", "E", "S", "E", "A", "R", "C", "H"].map(
          (letter) => html`<span>${letter}</span>`,
        )}
      </button>
    `;
  }
}
