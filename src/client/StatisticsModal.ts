import { LitElement, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import "./components/baseComponents/Modal";

@customElement("statistics-modal")
export class StatisticsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    isModalOpen: boolean;
  };

  public open() {
    this.updateComplete.then(() => this.modalEl?.open());
  }

  render() {
    return html`
      <o-modal title="Statistics" max-width="600px" max-height="70dvh">
        <div
          style="text-align:center; padding:1rem; color: var(--ui-text-default); font-size:14px;"
        >
          Statistics coming soon...
        </div>
      </o-modal>
    `;
  }

  createRenderRoot() {
    return this;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "statistics-modal": StatisticsModal;
  }
}
