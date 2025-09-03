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
                <h1>Release v0.1.9</h1>
                <p>
                  This release focuses on improving the user interface and user
                  experience, with a particular focus on the military theme and
                  hotkeys. We've also made some improvements to the build menu
                  and radial menu to make them more intuitive and easier to use.
                </p>
                <h2>What's New</h2>
                <ul>
                  <li>
                    <strong>UI Improvements to Radial and Build Menus:</strong>
                    The radial menu now closes automatically when you select an
                    item from the build menu, and the layout of the radial menu
                    has been corrected to be symmetrical when there are only
                    three items.
                  </li>
                  <li>
                    <strong>Build Hotkeys:</strong> You can now use hotkeys to
                    build units and structures, which should make it faster and
                    easier to build up your forces.
                  </li>
                  <li>
                    <strong>Military Theme Overhaul:</strong> The military theme
                    has been updated to be less bulky, with less padding, lower
                    heights, and a more opaque background. It also now fits
                    better on smaller screens.
                  </li>
                  <li>
                    <strong>Player Info Overlay:</strong> The Player Info
                    Overlay has been revamped and moved to better fit the new
                    military theme.
                  </li>
                </ul>
              </div>
              <div class="news-content">
                <p>
                  This version (v0.1.8) introduces a complete visual overhaul of
                  the game and a more intuitive building process, all inspired
                  by a Cold War / WWII military command aesthetic. The new
                  interface is designed to be more immersive and thematic, with
                  a focus on providing a clear and concise overview of the game
                  state.
                </p>
                <p>
                  <strong>Key Features:</strong>
                </p>
                <ul>
                  <li>
                    <strong>New, Intuitive Build Flow:</strong> The building
                    process has been reversed to be more user-friendly. You now
                    <strong
                      >first select the unit or structure you want to
                      build</strong
                    >
                    from the new build menu, and then you click on the map to
                    place it.
                  </li>
                  <li>
                    <strong>Redesigned Control Panel:</strong> The main control
                    panel has been redesigned and now includes tabs for "Build",
                    "Attack", "Economy", and "Research", making it easier to
                    access all the game's features.
                  </li>
                  <li>
                    <strong>Integrated Build Menu:</strong> The build menu is
                    now part of the control panel, allowing for a more
                    streamlined building experience. It also includes a "Mass
                    Production" option for building multiple units.
                  </li>
                  <li>
                    <strong>Updated Unit Names:</strong> Several units have been
                    renamed to better fit the new theme (e.g., "City" is now
                    "Industrial Complex", "Warship" is now "Destroyer").
                  </li>
                  <li>
                    <strong>Improved Visuals:</strong> The game now features new
                    background images.
                  </li>
                </ul>
                <p>
                  This update aims to provide a more engaging, intuitive, and
                  visually appealing experience for all players.
                </p>
              </div>
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
