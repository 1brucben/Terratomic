import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMapType } from "../../core/game/Game";
import { getMapsImage } from "../utilities/Maps";

// Add map descriptions
export const MapDescription: Record<keyof typeof GameMapType, string> = {
  World: "World",
  GiantWorldMap: "Giant World Map",
  Europe: "Europe",
  EuropeClassic: "Europe Classic",
  Mena: "MENA",
  NorthAmerica: "North America",
  Oceania: "Oceania",
  BlackSea: "Black Sea",
  Africa: "Africa",
  Pangaea: "Pangaea",
  Asia: "Asia",
  Mars: "Mars",
  SouthAmerica: "South America",
  Britannia: "Britannia",
  GatewayToTheAtlantic: "Gateway to the Atlantic",
  Australia: "Australia",
  Iceland: "Iceland",
  EastAsia: "East Asia",
  BetweenTwoSeas: "Between Two Seas",
  FaroeIslands: "Faroe Islands",
  DeglaciatedAntarctica: "Deglaciated Antarctica",
  FalklandIslands: "Falkland Islands",
  Baikal: "Baikal",
  Halkidiki: "Halkidiki",
  StraitOfGibraltar: "Strait of Gibraltar",
  Italia: "Italia",
  Nukewars1024: "Nukewars 1024",
  NukeWars2: "NukeWars 2",
  NukeWars2000: "NukeWars 2000",
  NukeWarsQuad: "NukeWars Quad",
};

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
      background: var(--ui-panel-shell-top);
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
    }

    .option-card:hover {
      transform: translateY(-2px);
      border-color: var(--ui-secondary);
      background: var(--ui-panel-shell-bottom);
    }

    .option-card.selected {
      border-color: var(--ui-primary);
      background: var(--ui-slider-track);
      box-shadow:
        0 0 0 2px rgba(39, 71, 110, 0.5),
        0 0 12px rgba(39, 71, 110, 0.35);
    }

    .option-card-title {
      font-size: 14px;
      color: var(--ui-text-muted);
      text-align: center;
      margin: 0 0 4px 0;
    }

    .option-image {
      width: 100%;
      aspect-ratio: 4/2;
      color: var(--ui-text-muted);
      transition: transform 0.2s ease-in-out;
      border-radius: 8px;
      background-color: rgba(255, 255, 255, 0.1);
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
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
