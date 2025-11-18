import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("player-icon")
export class PlayerIcon extends LitElement {
  @property({ type: String }) size = "16";
  @property({ type: String }) color = "currentColor";

  static styles = css`
    :host {
      display: inline-block;
      vertical-align: middle;
      margin-bottom: 2px;
    }
    svg {
      display: block;
    }
  `;

  render() {
    return html`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="${this.size}"
        height="${this.size}"
      >
        <!-- Head -->
        <circle cx="12" cy="8" r="4" fill="${this.color}" />
        <!-- Body/Shoulders -->
        <path
          d="M12 14c-5.33 0-8 2.67-8 6v1h16v-1c0-3.33-2.67-6-8-6z"
          fill="${this.color}"
        />
      </svg>
    `;
  }
}
