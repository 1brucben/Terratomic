import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserSettings } from "../core/game/UserSettings";
import "./components/baseComponents/setting/SettingKeybind";
import { SettingKeybind } from "./components/baseComponents/setting/SettingKeybind";
import "./components/baseComponents/setting/SettingNumber";
import "./components/baseComponents/setting/SettingSlider";
import "./components/baseComponents/setting/SettingToggle";
import "./LoadReplayModal";
import {
  adjustUiScalePercent,
  applyUiScalePercent,
  getStoredUiScalePercent,
  saveUiScalePercent,
  UI_SCALE_CHANGED_EVENT,
  UI_SCALE_DEFAULT_PERCENT,
  UI_SCALE_MAX_PERCENT,
  UI_SCALE_MIN_PERCENT,
  UI_SCALE_STEP_PERCENT,
} from "./uiScale";

@customElement("user-setting")
export class UserSettingModal extends LitElement {
  private userSettings: UserSettings = new UserSettings();

  @state() private settingsMode: "basic" | "keybinds" | "replays" = "basic";
  @state() private keybinds: Record<string, string> = {};
  @state() private uiScalePercent = UI_SCALE_DEFAULT_PERCENT;

  private handleUiScaleChanged = (event: Event) => {
    const detail = (event as CustomEvent<{ percent: number }>).detail;
    if (!detail) return;
    const { percent } = detail;
    if (typeof percent !== "number" || percent === this.uiScalePercent) return;
    this.uiScalePercent = percent;
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(UI_SCALE_CHANGED_EVENT, this.handleUiScaleChanged);

    const savedKeybinds = localStorage.getItem("settings.keybinds");
    if (savedKeybinds) {
      try {
        this.keybinds = JSON.parse(savedKeybinds);
      } catch (e) {
        console.warn("Invalid keybinds JSON:", e);
      }
    }

    this.uiScalePercent = getStoredUiScalePercent();
  }

  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    isModalOpen: boolean;
  };

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    window.removeEventListener(
      UI_SCALE_CHANGED_EVENT,
      this.handleUiScaleChanged,
    );
    super.disconnectedCallback();
    document.body.style.overflow = "auto";
  }

  toggleDarkMode(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;

    if (typeof enabled !== "boolean") {
      console.warn("Unexpected toggle event payload", e);
      return;
    }

    this.userSettings.set("settings.darkMode", enabled);

    if (enabled) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    this.dispatchEvent(
      new CustomEvent("dark-mode-changed", {
        detail: { darkMode: enabled },
        bubbles: true,
        composed: true,
      }),
    );

    console.log("🌙 Dark Mode:", enabled ? "ON" : "OFF");
  }

  private toggleEmojis(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.emojis", enabled);

    console.log("🤡 Emojis:", enabled ? "ON" : "OFF");
  }

  private toggleAlertFrame(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.alertFrame", enabled);

    console.log("🚨 Alert frame:", enabled ? "ON" : "OFF");
  }

  private toggleFxLayer(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.specialEffects", enabled);

    console.log("💥 Special effects:", enabled ? "ON" : "OFF");
  }

  private toggleAnonymousNames(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.anonymousNames", enabled);

    console.log("🙈 Anonymous Names:", enabled ? "ON" : "OFF");
  }

  private toggleLobbyIdVisibility(e: CustomEvent<{ checked: boolean }>) {
    const hideIds = e.detail?.checked;

    if (typeof hideIds !== "boolean") return;

    this.userSettings.set("settings.lobbyIdVisibility", !hideIds); // Invert because checked=hide
    console.log("👁️ Hidden Lobby IDs:", hideIds ? "ON" : "OFF");
  }

  private toggleLeftClickOpensMenu(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.leftClickOpensMenu", enabled);
    console.log("🖱️ Left Click Opens Menu:", enabled ? "ON" : "OFF");

    this.requestUpdate();
  }

  private sliderAttackRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      localStorage.setItem("settings.attackRatio", ratio.toString());
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  private sliderTroopRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      localStorage.setItem("settings.troopRatio", ratio.toString());
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  private nudgeUiScale(delta: number) {
    const next = adjustUiScalePercent(this.uiScalePercent, delta);
    if (next === this.uiScalePercent) return;
    this.uiScalePercent = next;
    saveUiScalePercent(next);
    applyUiScalePercent(next);
  }

  private resetUiScale() {
    if (this.uiScalePercent === UI_SCALE_DEFAULT_PERCENT) return;
    this.uiScalePercent = UI_SCALE_DEFAULT_PERCENT;
    saveUiScalePercent(UI_SCALE_DEFAULT_PERCENT);
    applyUiScalePercent(UI_SCALE_DEFAULT_PERCENT);
  }

  private handleKeybindChange(
    e: CustomEvent<{ action: string; value: string }>,
  ) {
    const { action, value } = e.detail;
    const prevValue = this.keybinds[action] ?? "";

    const values = Object.entries(this.keybinds)
      .filter(([k]) => k !== action)
      .map(([, v]) => v);
    if (values.includes(value) && value !== "Null") {
      const popup = document.createElement("div");
      popup.className = "setting-popup";
      popup.textContent = `The key "${value}" is already assigned to another action.`;
      document.body.appendChild(popup);
      const element = this.renderRoot.querySelector(
        `setting-keybind[action="${action}"]`,
      ) as SettingKeybind;
      if (element) {
        element.value = prevValue;
        element.requestUpdate();
      }
      return;
    }
    this.keybinds = { ...this.keybinds, [action]: value };
    localStorage.setItem("settings.keybinds", JSON.stringify(this.keybinds));
  }

  render() {
    return html`
      <o-modal title="${translateText("user_setting.title")}">
        <div class="modal-overlay">
          <div class="modal-content user-setting-modal min-w-[400px]">
            <div class="flex mb-4 w-full justify-center">
              <button
                class="w-1/3 text-center px-3 py-1 rounded-l 
      ${this.settingsMode === "basic"
                  ? "bg-white/10 text-white"
                  : "bg-transparent text-gray-400"}"
                @click=${() => (this.settingsMode = "basic")}
              >
                ${translateText("user_setting.tab_basic")}
              </button>
              <button
                class="w-1/3 text-center px-3 py-1 
      ${this.settingsMode === "keybinds"
                  ? "bg-white/10 text-white"
                  : "bg-transparent text-gray-400"}"
                @click=${() => (this.settingsMode = "keybinds")}
              >
                ${translateText("user_setting.tab_keybinds")}
              </button>
              <button
                class="w-1/3 text-center px-3 py-1 rounded-r 
      ${this.settingsMode === "replays"
                  ? "bg-white/10 text-white"
                  : "bg-transparent text-gray-400"}"
                @click=${() => (this.settingsMode = "replays")}
              >
                Replays
              </button>
            </div>

            <div class="settings-list">
              ${this.settingsMode === "basic"
                ? this.renderBasicSettings()
                : this.settingsMode === "keybinds"
                  ? this.renderKeybindSettings()
                  : this.renderReplaySettings()}
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }

  private renderReplaySettings() {
    return html`
      <div>
        <load-replay-modal
          @close-modal=${() => this.close()}
        ></load-replay-modal>
      </div>
    `;
  }

  private renderBasicSettings() {
    return html`
      <!-- 🌙 Dark Mode -->
      <setting-toggle
        label="${translateText("user_setting.dark_mode_label")}"
        description="${translateText("user_setting.dark_mode_desc")}"
        id="dark-mode-toggle"
        .checked=${this.userSettings.darkMode()}
        @change=${(e: CustomEvent<{ checked: boolean }>) =>
          this.toggleDarkMode(e)}
      ></setting-toggle>

      <!-- 😊 Emojis -->
      <setting-toggle
        label="${translateText("user_setting.emojis_label")}"
        description="${translateText("user_setting.emojis_desc")}"
        id="emoji-toggle"
        .checked=${this.userSettings.emojis()}
        @change=${this.toggleEmojis}
      ></setting-toggle>

      <!-- 🚨 Alert frame -->
      <setting-toggle
        label="${translateText("user_setting.alert_frame_label")}"
        description="${translateText("user_setting.alert_frame_desc")}"
        id="alert-frame-toggle"
        .checked=${this.userSettings.alertFrame()}
        @change=${this.toggleAlertFrame}
      ></setting-toggle>

      <!-- 💥 Special effects -->
      <setting-toggle
        label="${translateText("user_setting.special_effects_label")}"
        description="${translateText("user_setting.special_effects_desc")}"
        id="special-effect-toggle"
        .checked=${this.userSettings.fxLayer()}
        @change=${this.toggleFxLayer}
      ></setting-toggle>

      <!-- 🖱️ Left Click Menu -->
      <setting-toggle
        label="${translateText("user_setting.left_click_label")}"
        description="${translateText("user_setting.left_click_desc")}"
        id="left-click-toggle"
        .checked=${this.userSettings.leftClickOpensMenu()}
        @change=${this.toggleLeftClickOpensMenu}
      ></setting-toggle>

      <!-- 🙈 Anonymous Names -->
      <setting-toggle
        label="${translateText("user_setting.anonymous_names_label")}"
        description="${translateText("user_setting.anonymous_names_desc")}"
        id="anonymous-names-toggle"
        .checked=${this.userSettings.anonymousNames()}
        @change=${this.toggleAnonymousNames}
      ></setting-toggle>

      <!-- 👁️ Hidden Lobby IDs -->
      <setting-toggle
        label="${translateText("user_setting.lobby_id_visibility_label")}"
        description="${translateText("user_setting.lobby_id_visibility_desc")}"
        id="lobby-id-visibility-toggle"
        .checked=${!this.userSettings.get("settings.lobbyIdVisibility", true)}
        @change=${this.toggleLobbyIdVisibility}
      ></setting-toggle>

      <div class="setting-item vertical">
        <div class="setting-label-group">
          <label class="setting-label"
            >${translateText("user_setting.ui_scale_label")}</label
          >
          <div class="setting-description">
            ${translateText("user_setting.ui_scale_desc")}
          </div>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          <button
            class="w-10 h-10 rounded bg-white/10 text-white text-xl font-bold hover:bg-white/20 transition"
            @click=${() => this.nudgeUiScale(-UI_SCALE_STEP_PERCENT)}
            type="button"
          >
            -
          </button>
          <div class="text-lg font-semibold min-w-[60px] text-center">
            ${this.uiScalePercent}%
          </div>
          <button
            class="w-10 h-10 rounded bg-white/10 text-white text-xl font-bold hover:bg-white/20 transition"
            @click=${() => this.nudgeUiScale(UI_SCALE_STEP_PERCENT)}
            type="button"
          >
            +
          </button>
          <button
            class="px-3 py-1 rounded bg-white/5 text-sm uppercase tracking-wide hover:bg-white/15 transition"
            @click=${this.resetUiScale}
            type="button"
          >
            ${translateText("user_setting.ui_scale_reset")}
          </button>
        </div>
        <div class="text-xs text-gray-400 mt-1">
          ${UI_SCALE_MIN_PERCENT}% - ${UI_SCALE_MAX_PERCENT}%
          (${UI_SCALE_STEP_PERCENT}% steps)
        </div>
      </div>

      <!-- ⚔️ Attack Ratio -->
      <setting-slider
        label="${translateText("user_setting.attack_ratio_label")}"
        description="${translateText("user_setting.attack_ratio_desc")}"
        min="1"
        max="100"
        .value=${
          Number(localStorage.getItem("settings.attackRatio") ?? "0.2") * 100
        }
        @change=${this.sliderAttackRatio}
      ></setting-slider>

      <!-- 🪖🛠️ Troop Ratio -->
      <setting-slider
        label="${translateText("user_setting.troop_ratio_label")}"
        description="${translateText("user_setting.troop_ratio_desc")}"
        min="1"
        max="100"
        .value=${
          Number(localStorage.getItem("settings.troopRatio") ?? "0.95") * 100
        }
        @change=${this.sliderTroopRatio}
      </setting-slider>
    `;
  }

  private renderKeybindSettings() {
    return html`
      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.view_options")}
      </div>

      <setting-keybind
        action="toggleView"
        label=${translateText("user_setting.toggle_view")}
        description=${translateText("user_setting.toggle_view_desc")}
        defaultKey="Space"
        .value=${this.keybinds["toggleView"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.attack_ratio_controls")}
      </div>

      <setting-keybind
        action="attackRatioDown"
        label=${translateText("user_setting.attack_ratio_down")}
        description=${translateText("user_setting.attack_ratio_down_desc")}
        defaultKey="Digit1"
        .value=${this.keybinds["attackRatioDown"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="attackRatioUp"
        label=${translateText("user_setting.attack_ratio_up")}
        description=${translateText("user_setting.attack_ratio_up_desc")}
        defaultKey="Digit2"
        .value=${this.keybinds["attackRatioUp"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.attack_keybinds")}
      </div>

      <setting-keybind
        action="boatAttack"
        label=${translateText("user_setting.boat_attack")}
        description=${translateText("user_setting.boat_attack_desc")}
        defaultKey="KeyB"
        .value=${this.keybinds["boatAttack"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="groundAttack"
        label=${translateText("user_setting.ground_attack")}
        description=${translateText("user_setting.ground_attack_desc")}
        defaultKey="KeyG"
        .value=${this.keybinds["groundAttack"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.zoom_controls")}
      </div>

      <setting-keybind
        action="zoomOut"
        label=${translateText("user_setting.zoom_out")}
        description=${translateText("user_setting.zoom_out_desc")}
        defaultKey="KeyQ"
        .value=${this.keybinds["zoomOut"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomIn"
        label=${translateText("user_setting.zoom_in")}
        description=${translateText("user_setting.zoom_in_desc")}
        defaultKey="KeyE"
        .value=${this.keybinds["zoomIn"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.camera_movement")}
      </div>

      <setting-keybind
        action="centerCamera"
        label=${translateText("user_setting.center_camera")}
        description=${translateText("user_setting.center_camera_desc")}
        defaultKey="KeyC"
        .value=${this.keybinds["centerCamera"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveUp"
        label=${translateText("user_setting.move_up")}
        description=${translateText("user_setting.move_up_desc")}
        defaultKey="KeyW"
        .value=${this.keybinds["moveUp"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveLeft"
        label=${translateText("user_setting.move_left")}
        description=${translateText("user_setting.move_left_desc")}
        defaultKey="KeyA"
        .value=${this.keybinds["moveLeft"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveDown"
        label=${translateText("user_setting.move_down")}
        description=${translateText("user_setting.move_down_desc")}
        defaultKey="KeyS"
        .value=${this.keybinds["moveDown"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveRight"
        label=${translateText("user_setting.move_right")}
        description=${translateText("user_setting.move_right_desc")}
        defaultKey="KeyD"
        .value=${this.keybinds["moveRight"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.structures")}
      </div>

      <setting-keybind
        action="buildCity"
        label=${translateText("user_setting.build_city")}
        description=${translateText("user_setting.build_city_desc")}
        defaultKey="KeyY"
        .value=${this.keybinds["buildCity"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildPort"
        label=${translateText("user_setting.build_port")}
        description=${translateText("user_setting.build_port_desc")}
        defaultKey="KeyU"
        .value=${this.keybinds["buildPort"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildAirfield"
        label=${translateText("user_setting.build_airfield")}
        description=${translateText("user_setting.build_airfield_desc")}
        defaultKey="KeyI"
        .value=${this.keybinds["buildAirfield"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildHospital"
        label=${translateText("user_setting.build_hospital")}
        description=${translateText("user_setting.build_hospital_desc")}
        defaultKey="KeyO"
        .value=${this.keybinds["buildHospital"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildAcademy"
        label=${translateText("user_setting.build_academy")}
        description=${translateText("user_setting.build_academy_desc")}
        defaultKey="KeyP"
        .value=${this.keybinds["buildAcademy"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildResearchLab"
        label=${translateText("user_setting.build_research_lab")}
        description=${translateText("user_setting.build_research_lab_desc")}
        defaultKey="KeyL"
        .value=${this.keybinds["buildResearchLab"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildFactory"
        label=${translateText("user_setting.build_factory")}
        description=${translateText("user_setting.build_factory_desc")}
        defaultKey="KeyF"
        .value=${this.keybinds["buildFactory"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMissileSilo"
        label=${translateText("user_setting.build_missile_silo")}
        description=${translateText("user_setting.build_missile_silo_desc")}
        defaultKey="KeyH"
        .value=${this.keybinds["buildMissileSilo"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildSAMLauncher"
        label=${translateText("user_setting.build_sam_launcher")}
        description=${translateText("user_setting.build_sam_launcher_desc")}
        defaultKey="KeyJ"
        .value=${this.keybinds["buildSAMLauncher"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildDefensePost"
        label=${translateText("user_setting.build_defense_post")}
        description=${translateText("user_setting.build_defense_post_desc")}
        defaultKey="KeyK"
        .value=${this.keybinds["buildDefensePost"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.units")}
      </div>

      <setting-keybind
        action="buildFighterJet"
        label=${translateText("user_setting.build_fighter_jet")}
        description=${translateText("user_setting.build_fighter_jet_desc")}
        defaultKey="Digit8"
        .value=${this.keybinds["buildFighterJet"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildWarship"
        label=${translateText("user_setting.build_warship")}
        description=${translateText("user_setting.build_warship_desc")}
        defaultKey="Digit9"
        .value=${this.keybinds["buildWarship"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.nukes")}
      </div>

      <setting-keybind
        action="buildAtomBomb"
        label=${translateText("user_setting.build_atom_bomb")}
        description=${translateText("user_setting.build_atom_bomb_desc")}
        defaultKey="Digit5"
        .value=${this.keybinds["buildAtomBomb"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildHydrogenBomb"
        label=${translateText("user_setting.build_hydrogen_bomb")}
        description=${translateText("user_setting.build_hydrogen_bomb_desc")}
        defaultKey="Digit6"
        .value=${this.keybinds["buildHydrogenBomb"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMIRV"
        label=${translateText("user_setting.build_mirv")}
        description=${translateText("user_setting.build_mirv_desc")}
        defaultKey="Digit7"
        .value=${this.keybinds["buildMIRV"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>
    `;
  }

  public open() {
    this.requestUpdate();
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
