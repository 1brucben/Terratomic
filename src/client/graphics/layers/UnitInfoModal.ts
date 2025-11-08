import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import { Layer } from "./Layer";
import { StructureLayer } from "./StructureLayer";

@customElement("unit-info-modal")
export class UnitInfoModal extends LitElement implements Layer {
  @property({ type: Boolean }) open = false;
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @property({ type: Object }) unit: UnitView | null = null;

  public game: GameView;
  public structureLayer: StructureLayer | null = null;

  constructor() {
    super();
  }

  init() {}

  tick() {
    if (this.unit) {
      this.requestUpdate();
    }
  }

  public onOpenStructureModal = ({
    unit,
    x,
    y,
    tileX,
    tileY,
  }: {
    unit: UnitView;
    x: number;
    y: number;
    tileX: number;
    tileY: number;
  }) => {
    if (!this.game) return;
    this.x = x;
    this.y = y;
    const targetRef = this.game.ref(tileX, tileY);

    const allUnitTypes = Object.values(UnitType);
    const matchingUnits = this.game.nearbyUnits(
      targetRef,
      10,
      allUnitTypes,
      ({ unit }) => unit.isActive(),
    );

    if (matchingUnits.length > 0) {
      matchingUnits.sort((a, b) => a.distSquared - b.distSquared);
      this.unit = matchingUnits[0].unit;
    } else {
      this.unit = null;
    }
    this.open = this.unit !== null;
  };

  public onCloseStructureModal = () => {
    this.open = false;
    this.unit = null;
  };

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private buildUnitTypeTranslationString(): string {
    if (!this.unit) return "unit_type.unknown"; // fallback stays the same
    const unitType = this.unit.type().toLowerCase().replace(/ /g, ""); // Remove spaces, don't replace with underscore
    return `unit_type.${unitType}`;
  }

  static styles = css`
    :host {
      position: fixed;
      pointer-events: none;
      z-index: 1000;
    }

    .modal {
      pointer-events: auto;
      background: var(--ui-modal-content);
      color: var(--ui-text-default);
      border: 1px solid var(--ui-panel-border);
      padding: 12px 18px;
      border-radius: 8px;
      min-width: 220px;
      max-width: 300px;
      box-shadow: var(--ui-panel-shadow);
      font-family: "Segoe UI", sans-serif;
      font-size: 15px;
      line-height: 1.6;
      backdrop-filter: blur(6px);
      position: relative;
    }

    .modal strong {
      color: var(--ui-text-accent);
    }

    .close-button {
      background: var(--ui-primary);
      color: var(--ui-button-text);
      border: 1px solid transparent;
      border-radius: 4px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      padding: 6px 12px;
    }

    .close-button:hover {
      background: var(--ui-primary-hover);
    }

    .modal__title {
      margin-bottom: 8px;
      font-size: 16px;
      font-weight: bold;
      color: var(--ui-text-accent);
    }

    .modal__section {
      margin-bottom: 4px;
    }

    .modal__actions {
      margin-top: 14px;
      display: flex;
      justify-content: center;
    }
  `;

  render() {
    if (!this.unit) return null;

    const cooldown = this.unit.ticksLeftInCooldown() ?? 0;
    const secondsLeft = Math.ceil(cooldown / 10);

    return html`
      <div
        class="modal"
        style="display: ${this.open ? "block" : "none"}; left: ${this
          .x}px; top: ${this.y}px; position: absolute;"
      >
        <div class="modal__title">
          ${translateText("unit_info_modal.structure_info")}
        </div>
        <div class="modal__section">
          <strong>${translateText("unit_info_modal.type")}:</strong>
          ${translateText(this.buildUnitTypeTranslationString()) ??
          translateText("unit_info_modal.unit_type_unknown")}
        </div>
        ${secondsLeft > 0
          ? html`<div class="modal__section">
              <strong>${translateText("unit_info_modal.cooldown")}</strong>
              ${secondsLeft}s
            </div>`
          : ""}
        <div class="modal__actions">
          <button
            @click=${() => {
              this.onCloseStructureModal();
              if (this.structureLayer) {
                this.structureLayer.unSelectStructureUnit();
              }
            }}
            class="close-button"
            title="${translateText("unit_info_modal.close")}"
          >
            ${translateText("unit_info_modal.close")}
          </button>
        </div>
      </div>
    `;
  }
}
