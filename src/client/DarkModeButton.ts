import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";

@customElement("dark-mode-button")
export class DarkModeButton extends LitElement {
  private userSettings: UserSettings = new UserSettings();
  @state() private darkMode: boolean = this.userSettings.darkMode();

  createRenderRoot() {
    // Use light DOM so Tailwind/global styles apply.
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("dark-mode-changed", this.handleDarkModeChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("dark-mode-changed", this.handleDarkModeChanged);
  }

  private handleDarkModeChanged = (e: Event) => {
    const event = e as CustomEvent<{ darkMode: boolean }>;
    this.darkMode = event.detail.darkMode;
  };

  toggleDarkMode() {
    this.userSettings.toggleDarkMode();
    this.darkMode = this.userSettings.darkMode();
  }

  render() {
    return html`
      <button
        title="Toggle Dark Mode"
        class="flex items-center justify-center w-10 h-10 rounded-full border-none bg-black/40 text-white cursor-pointer text-2xl transition hover:bg-black/60"
        @click=${() => this.toggleDarkMode()}
        aria-label=${this.darkMode ? "Disable dark mode" : "Enable dark mode"}
        aria-pressed=${this.darkMode}
      >
        ${this.darkMode ? "🌙" : "☀️"}
      </button>
    `;
  }
}
