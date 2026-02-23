import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMapType } from "../../core/game/Game";
import { getMapsImage } from "../utilities/Maps";

// Add map descriptions
import mapData from "../../../resources/maps/maps.json" with { type: "json" };

// Add map descriptions
export const MapDescription: Record<keyof typeof GameMapType, string> =
  {} as any;
mapData.forEach((map) => {
  if (map.fileName in GameMapType) {
    MapDescription[map.fileName as keyof typeof GameMapType] = map.displayName;
  } else {
    console.warn(`Map ${map.fileName} not found in GameMapType keys`);
  }
});
console.log("MapDescription populated:", MapDescription);

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) translation: string = "";

  static styles = css`
    .option-card {
      width: 100%;
      min-width: 100px;
      max-width: 78px;
      padding: 4px 4px 0 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      background:
        linear-gradient(
          124deg,
          rgba(182, 193, 208, 0.08) 0 14%,
          rgba(0, 0, 0, 0) 42%
        ),
        linear-gradient(
          180deg,
          var(--map-card-bg, var(--ui-panel-shell-top, rgba(55, 63, 75, 0.99))),
          var(
            --map-card-bg-bottom,
            var(--ui-panel-shell-bottom, rgba(36, 42, 52, 0.995))
          )
        );
      border: 2px solid
        var(
          --map-card-border,
          var(--ui-panel-border, rgba(133, 147, 169, 0.62))
        );
      border-radius: 7px 10px 8px 6px;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
      box-shadow:
        inset 0 1px 0 rgba(214, 224, 238, 0.12),
        inset 0 -10px 14px rgba(0, 0, 0, 0.22),
        0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .option-card:hover {
      transform: translateY(-2px);
      border-color: var(
        --map-card-hover-border,
        var(--ui-secondary, rgba(215, 155, 118, 0.72))
      );
      background:
        linear-gradient(
          124deg,
          rgba(209, 218, 231, 0.16) 0 16%,
          rgba(0, 0, 0, 0) 41%
        ),
        linear-gradient(
          180deg,
          var(
            --map-card-hover-top,
            var(--ui-panel-shell-top, rgba(80, 92, 108, 0.988))
          ),
          var(
            --map-card-hover-bottom,
            var(--ui-panel-shell-bottom, rgba(43, 51, 62, 0.996))
          )
        );
    }

    .option-card.selected {
      border-color: var(--ui-primary);
      background:
        linear-gradient(
          124deg,
          rgba(214, 223, 236, 0.18) 0 16%,
          rgba(0, 0, 0, 0) 41%
        ),
        linear-gradient(
          180deg,
          var(
            --map-card-selected-top,
            var(--ui-panel-shell-top, rgba(85, 97, 114, 0.99))
          ),
          var(
            --map-card-selected-bottom,
            var(--ui-panel-shell-bottom, rgba(48, 56, 68, 0.997))
          )
        );
      box-shadow:
        0 0 0 2px
          var(
            --map-card-selected-ring,
            var(--ui-primary, rgba(224, 166, 129, 0.86))
          ),
        0 0 12px
          var(
            --map-card-selected-glow,
            var(--ui-primary, rgba(224, 166, 129, 0.52))
          ),
        inset 0 1px 0 rgba(232, 239, 248, 0.2);
    }

    .option-card-title {
      font-size: 14px;
      color: var(--map-card-title, var(--ui-text-muted));
      text-align: center;
      margin: 0 0 4px 0;
    }

    .option-image {
      width: 100%;
      aspect-ratio: 4/2;
      color: var(--ui-text-muted);
      transition: transform 0.2s ease-in-out;
      border-radius: 8px;
      background-color: var(
        --map-card-image-bg,
        var(--ui-panel-shell-bottom, rgba(17, 21, 28, 0.82))
      );
      border: 1px solid
        var(
          --map-card-image-border,
          var(--ui-border-muted, rgba(168, 181, 198, 0.38))
        );
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.26);
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    img.option-image {
      object-fit: cover;
      filter: saturate(1.12) contrast(1.18) brightness(1.04);
      background-color: transparent;
    }
  `;

  render() {
    const mapValue = GameMapType[this.mapKey as keyof typeof GameMapType];

    return html`
      <div class="option-card ${this.selected ? "selected" : ""}">
        ${getMapsImage(mapValue)
          ? html`<img
              src="${getMapsImage(mapValue)}"
              alt="${this.mapKey}"
              class="option-image"
            />`
          : html`<div class="option-image">
              <p>${this.mapKey}</p>
            </div>`}
        <div class="option-card-title">
          <!-- ${MapDescription[this.mapKey as keyof typeof GameMapType]}-->
          ${this.translation ||
          MapDescription[this.mapKey as keyof typeof GameMapType]}
        </div>
      </div>
    `;
  }
}
