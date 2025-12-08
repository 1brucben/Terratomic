import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";
import { translateText } from "./Utils";

@customElement("sound-button")
export class SoundButton extends LitElement {
  private userSettings: UserSettings = new UserSettings();
  @state() private muted: boolean = this.userSettings.soundMuted();

  createRenderRoot() {
    // Use light DOM to inherit global styles (like Tailwind)
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("sound-muted-changed", this.handleMutedChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("sound-muted-changed", this.handleMutedChanged);
  }

  private handleMutedChanged = (e: Event) => {
    const event = e as CustomEvent<{ muted: boolean }>;
    this.muted = event.detail.muted;
  };

  toggleMuted() {
    this.userSettings.toggleSoundMuted();
    this.muted = this.userSettings.soundMuted();
  }

  render() {
    return html`
      <button
        title=${translateText("sound_button.toggle_sound")}
        class="flex items-center justify-center w-10 h-10 rounded-full border-none bg-black/40 text-white cursor-pointer text-2xl transition hover:bg-black/60"
        @click=${() => this.toggleMuted()}
        aria-label=${this.muted ? "Unmute Sound" : "Mute Sound"}
      >
        ${this.muted ? "🔇" : "🔊"}
      </button>
    `;
  }
}
