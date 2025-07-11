import { LitElement, css, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";

@customElement("news-modal")
export class NewsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  static styles = css`
    :host {
      display: block;
    }

    .news-container {
      max-height: 60vh;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .news-content {
      color: #ddd;
      line-height: 1.5;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      padding: 1rem;
    }

    .news-content a {
      color: #4a9eff !important;
      text-decoration: underline !important;
      transition: color 0.2s ease;
    }

    .news-content a:hover {
      color: #6fb3ff !important;
    }
  `;

  render() {
    return html`
      <o-modal>
        <div class="options-layout">
          <div class="options-section">
            <div class="news-container">
              <div class="news-content">
                <p>
                  This test version introduces a new mechanic:
                  <strong>Investment</strong>.
                </p>
                <p>
                  A new <strong>Investment Slider</strong> lets you dedicate a
                  portion of your nation's gold to productivity growth. Gold
                  spent on investment is subtracted before any other expenses.
                </p>
                <p>
                  The more you invest, the faster your
                  <strong>worker productivity</strong> increases—boosting your
                  long-term gold income. Productivity grows gradually and
                  compounds over time, meaning consistent investment can lead to
                  a powerful economic advantage.
                </p>
                <p>
                  Nuclear strikes now <strong>reduce productivity</strong>
                  proportionally to the number of tiles you lose. This creates
                  longer-term economic damage beyond just troop and worker
                  losses.
                </p>
              </div>
            </div>
          </div>
        </div>

        <o-button title="Close" @click=${this.close} blockDesktop></o-button>
      </o-modal>
    `;
  }

  public open() {
    this.requestUpdate();
    this.modalEl?.open();
  }

  private close() {
    this.modalEl?.close();
  }
}
