import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("robot-icon")
export class RobotIcon extends LitElement {
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
        width="${this.size}"
        height="${this.size}"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M12 2C12.8284 2 13.5 2.67157 13.5 3.5V5H17C18.1046 5 19 5.89543 19 7V10H20C20.5523 10 21 10.4477 21 11V13C21 13.5523 20.5523 14 20 14H19V17C19 18.1046 18.1046 19 17 19H7C5.89543 19 5 18.1046 5 17V14H4C3.44772 14 3 13.5523 3 13V11C3 10.4477 3.44772 10 4 10H5V7C5 5.89543 5.89543 5 7 5H10.5V3.5C10.5 2.67157 11.1716 2 12 2ZM8 10H11V12H8V10ZM16 10H13V12H16V10ZM8 15H16V16H8V15Z"
          fill="${this.color}"
        />
      </svg>
    `;
  }
}
