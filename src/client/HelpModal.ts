import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { getAltKey, getModifierKey, translateText } from "../client/Utils";
import { getTechNodes } from "../core/tech/ResearchTree";
import { TECHS } from "../core/tech/TechEffects";
import "./components/Difficulties";
import "./components/Maps";

type HelpTab =
  | "GettingStarted"
  | "UIGuide"
  | "Structures"
  | "Units"
  | "Investment"
  | "TechTree"
  | "Strategy";

@customElement("help-modal")
export class HelpModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state()
  private activeTab: HelpTab = "GettingStarted";

  createRenderRoot() {
    return this;
  }

  private t(key: string, params: Record<string, string | number> = {}) {
    return translateText(`help_modal_v2.${key}`, params);
  }

  private renderList(keys: string[]) {
    return keys.map((key) => html`<li>${unsafeHTML(this.t(key))}</li>`);
  }

  private renderOrderedList(keys: string[]) {
    return keys.map((key) => html`<li>${unsafeHTML(this.t(key))}</li>`);
  }

  private renderHotkey(hotkey: string) {
    const plain = [
      this.t("labels.none"),
      this.t("labels.auto"),
      this.t("labels.menu"),
    ];
    if (plain.includes(hotkey)) {
      return html`<span class="key-label">${hotkey}</span>`;
    }
    return html`<span class="key">${hotkey}</span>`;
  }

  private onTabClick(tab: HelpTab) {
    if (tab === this.activeTab) return;
    this.activeTab = tab;
  }

  private renderTabBar() {
    const tabs: HelpTab[] = [
      "GettingStarted",
      "UIGuide",
      "Structures",
      "Units",
      "Investment",
      "TechTree",
      "Strategy",
    ];
    const tabLabels: Record<HelpTab, string> = {
      GettingStarted: this.t("tabs.getting_started"),
      UIGuide: this.t("tabs.ui_guide"),
      Structures: this.t("tabs.structures"),
      Units: this.t("tabs.units"),
      Investment: this.t("tabs.investment"),
      TechTree: this.t("tabs.tech_tree"),
      Strategy: this.t("tabs.strategy"),
    };
    const tabIcons: Record<HelpTab, string> = {
      GettingStarted: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`, // Compass
      UIGuide: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`, // Layout
      Structures: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M13 21V11"/><path d="M17 21v-8"/><path d="M9 21v-8"/></svg>`, // Building
      Units: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/></svg>`, // Sword
      Investment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`, // Trending Up
      TechTree: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5z"/></svg>`, // Atom
      Strategy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`, // Map
    };

    return html`
      <div class="help-tab-bar">
        ${tabs.map(
          (tab) => html`
            <button
              class="help-tab ${this.activeTab === tab ? "active" : ""}"
              @click=${() => this.onTabClick(tab)}
            >
              <span class="tab-icon" aria-hidden="true"
                >${unsafeHTML(tabIcons[tab])}</span
              >
              <span>${tabLabels[tab]}</span>
            </button>
          `,
        )}
      </div>
    `;
  }

  private renderGettingStartedTab() {
    const hotkeyRows = [
      {
        key: html`<span class="key">Space</span>`,
        action: "getting_started.hotkeys.space",
      },
      {
        key: html`<span class="key">C</span>`,
        action: "getting_started.hotkeys.center_camera",
      },
      {
        key: html`<span class="key">Q</span> / <span class="key">E</span>`,
        action: "getting_started.hotkeys.zoom",
      },
      {
        key: html`<span class="key">W</span> <span class="key">A</span>
          <span class="key">S</span> <span class="key">D</span>`,
        action: "getting_started.hotkeys.move_camera",
      },
      {
        key: html`
          <div style="display: flex; justify-content: center;">
            <div class="mouse-shell alt-left-click">
              <div class="mouse-left-corner"></div>
              <div class="mouse-wheel"></div>
            </div>
          </div>
        `,
        action: "getting_started.hotkeys.attack",
      },
      {
        key: html`
          <div class="scroll-combo-horizontal">
            <span class="key">${getAltKey()}</span>
            <span class="plus">+</span>
            <div class="mouse-shell alt-left-click">
              <div class="mouse-left-corner"></div>
              <div class="mouse-wheel"></div>
            </div>
          </div>
        `,
        action: "getting_started.hotkeys.emote",
      },
      {
        key: html`<span class="key">1</span> / <span class="key">2</span>`,
        action: "getting_started.hotkeys.ratio_keys",
      },
      {
        key: html`
          <div class="scroll-combo-horizontal">
            <span class="key">${this.t("labels.shift")}</span>
            <span class="plus">+</span>
            <div class="mouse-with-arrows">
              <div class="mouse-shell">
                <div class="mouse-wheel" id="highlighted-wheel"></div>
              </div>
              <div class="mouse-arrows-side">
                <div class="arrow">&#8593;</div>
                <div class="arrow">&#8595;</div>
              </div>
            </div>
          </div>
        `,
        action: "getting_started.hotkeys.ratio_scroll",
      },
      {
        key: html`
          <div class="scroll-combo-horizontal">
            <span class="key">${getModifierKey()}</span>
            <span class="plus">+</span>
            <div class="mouse-with-arrows">
              <div class="mouse-shell">
                <div class="mouse-wheel" id="highlighted-wheel"></div>
              </div>
              <div class="mouse-arrows-side">
                <div class="arrow">&#8593;</div>
                <div class="arrow">&#8595;</div>
              </div>
            </div>
          </div>
        `,
        action: "getting_started.hotkeys.ui_scale",
      },
      {
        key: html`
          <span class="key">${getAltKey()}</span> + <span class="key">R</span>
        `,
        action: "getting_started.hotkeys.reset_graphics",
      },
    ];

    return html`
      <div class="help-tab-content">
        <div class="text-center text-2xl font-bold mb-4">
          ${this.t("getting_started.title")}
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("getting_started.objective_title")}
          </div>
          <p class="mb-2">
            ${unsafeHTML(this.t("getting_started.objective_description"))}
          </p>
          <ul class="help-list">
            ${this.renderList([
              "getting_started.objective_territory_control",
              "getting_started.objective_elimination",
            ])}
          </ul>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("getting_started.hotkeys_title")}
          </div>
          <p class="mb-2">${this.t("getting_started.hotkeys_description")}</p>

          <table class="help-table">
            <thead>
              <tr>
                <th>${this.t("labels.key")}</th>
                <th>${this.t("labels.action")}</th>
              </tr>
            </thead>
            <tbody class="text-left">
              ${hotkeyRows.map(
                (row) => html`
                  <tr>
                    <td>${row.key}</td>
                    <td>${this.t(row.action)}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("getting_started.first_steps_title")}
          </div>
          <p class="mb-2">${this.t("getting_started.first_steps_intro")}</p>
          <ol class="help-list">
            ${this.renderOrderedList([
              "getting_started.first_steps_spawn",
              "getting_started.first_steps_ratio",
              "getting_started.first_steps_expand",
              "getting_started.first_steps_city",
              "getting_started.first_steps_economy",
              "getting_started.first_steps_growth",
            ])}
          </ol>
          <p class="mt-2 text-sm opacity-80">
            ${unsafeHTML(this.t("getting_started.first_steps_tip"))}
          </p>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("getting_started.core_title")}
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2">
              ${this.t("getting_started.territory_title")}
            </div>
            <ul class="help-list">
              ${this.renderList([
                "getting_started.territory_neutral",
                "getting_started.territory_enemy",
                "getting_started.territory_capture",
                "getting_started.territory_loss",
              ])}
            </ul>
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2 mt-3">
              ${this.t("getting_started.combat_title")}
            </div>
            <ul class="help-list">
              ${this.renderList([
                "getting_started.combat_auto",
                "getting_started.combat_defense",
                "getting_started.combat_casualties",
                "getting_started.combat_ratio",
              ])}
            </ul>
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2 mt-3">
              ${this.t("getting_started.population_title")}
            </div>
            <ul class="help-list">
              ${this.renderList([
                "getting_started.population_cap",
                "getting_started.population_growth",
                "getting_started.population_split",
                "getting_started.population_workers",
                "getting_started.population_troops",
              ])}
            </ul>
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2 mt-3">
              ${this.t("getting_started.economy_title")}
            </div>
            <ul class="help-list">
              ${this.renderList([
                "getting_started.economy_generation",
                "getting_started.economy_productivity",
                "getting_started.economy_spending",
                "getting_started.economy_investment",
              ])}
            </ul>
            <p class="mt-2 text-sm opacity-80">
              ${unsafeHTML(this.t("getting_started.economy_example"))}
            </p>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("getting_started.map_title")}
          </div>
          <ul class="help-list">
            ${this.renderList([
              "getting_started.map_colors",
              "getting_started.map_borders",
              "getting_started.map_structures",
              "getting_started.map_roads",
            ])}
          </ul>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("getting_started.diplomacy_title")}
          </div>
          <p class="mb-2">${this.t("getting_started.diplomacy_intro")}</p>
          <ul class="help-list">
            ${this.renderList([
              "getting_started.diplomacy_neutral",
              "getting_started.diplomacy_allied",
              "getting_started.diplomacy_war",
              "getting_started.diplomacy_peace",
              "getting_started.diplomacy_betrayal",
            ])}
          </ul>
          <p class="mt-2 text-sm opacity-80">
            ${unsafeHTML(this.t("getting_started.diplomacy_warning"))}
          </p>
        </div>
      </div>
    `;
  }

  private renderUIGuideTab() {
    const commandCenterSections = [
      {
        titleKey: "ui_guide.command_center_build_title",
        descKey: "ui_guide.command_center_build_desc",
        img: "/images/HelpModalScreenshots/CC-Build.png",
        altKey: "ui_guide.command_center_build_alt",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M13 21V11"/><path d="M17 21v-8"/><path d="M9 21v-8"/></svg>`,
      },
      {
        titleKey: "ui_guide.command_center_attack_title",
        descKey: "ui_guide.command_center_attack_desc",
        img: "/images/HelpModalScreenshots/CC-Attack.png",
        altKey: "ui_guide.command_center_attack_alt",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/></svg>`,
      },
      {
        titleKey: "ui_guide.command_center_economy_title",
        descKey: "ui_guide.command_center_economy_desc",
        img: "/images/HelpModalScreenshots/CC-Economoy.png",
        altKey: "ui_guide.command_center_economy_alt",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      },
      {
        titleKey: "ui_guide.command_center_trade_title",
        descKey: "ui_guide.command_center_trade_desc",
        img: "/images/HelpModalScreenshots/CC-Trade.png",
        altKey: "ui_guide.command_center_trade_alt",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.9 5.8 2.5 8"/><path d="M12 10V4"/><path d="M8 8v2"/><path d="M16 8v2"/></svg>`,
      },
      {
        titleKey: "ui_guide.command_center_diplomacy_title",
        descKey: "ui_guide.command_center_diplomacy_desc",
        img: "/images/HelpModalScreenshots/CC-Diplomacy.png",
        altKey: "ui_guide.command_center_diplomacy_alt",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      },
      {
        titleKey: "ui_guide.command_center_bombers_title",
        descKey: "ui_guide.command_center_bombers_desc",
        img: "/images/HelpModalScreenshots/CC-Bombers.png",
        altKey: "ui_guide.command_center_bombers_alt",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"/><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="m19.07 4.93-14.14 14.14"/></svg>`,
      },
    ];

    const radialItems = [
      "ui_guide.radial_info",
      "ui_guide.radial_transport",
      "ui_guide.radial_alliance",
      "ui_guide.radial_betray",
      "ui_guide.radial_peace",
      "ui_guide.radial_war",
      "ui_guide.radial_air",
      "ui_guide.radial_attack",
    ];

    const eventsItems = [
      "ui_guide.events_alliance",
      "ui_guide.events_attacks",
      "ui_guide.events_chat",
      "ui_guide.events_game",
    ];

    const leaderboardItems = [
      "ui_guide.leaderboard_rankings",
      "ui_guide.leaderboard_info",
      "ui_guide.leaderboard_victory",
      "ui_guide.leaderboard_updates",
    ];

    const researchButtonItems = [
      "ui_guide.research_button_view",
      "ui_guide.research_button_progress",
      "ui_guide.research_button_priority",
      "ui_guide.research_button_prereq",
    ];

    const statusItems = [
      "ui_guide.status_peace",
      "ui_guide.status_alliance_request",
      "ui_guide.status_traitor",
      "ui_guide.status_embargo",
    ];

    return html`
      <div class="help-tab-content">
        <div class="text-center text-2xl font-bold mb-4">
          ${this.t("ui_guide.title")}
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.welcome_title")}
          </div>
          <img
            src="/images/HelpModalScreenshots/AllUiIngame.png"
            class="help-image"
            alt="${this.t("ui_guide.welcome_image_alt")}"
          />
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.control_panel_title")}
          </div>
          <div class="help-row">
            <div class="help-col">
              <p class="mb-2">${this.t("ui_guide.control_panel_intro")}</p>

              <ul class="help-list">
                ${this.renderList([
                  "ui_guide.control_panel_population",
                  "ui_guide.control_panel_gold",
                  "ui_guide.control_panel_workers",
                  "ui_guide.control_panel_attack_ratio",
                ])}
              </ul>
              <p class="mt-2 text-sm opacity-80">
                ${unsafeHTML(this.t("ui_guide.control_panel_tip"))}
              </p>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/ControlPanel.png"
                class="help-image help-image-small"
                alt="${this.t("ui_guide.control_panel_image_alt")}"
                style="margin-top: 0;"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.command_center_title")}
          </div>
          <p class="mb-4">${this.t("ui_guide.command_center_intro")}</p>

          ${commandCenterSections.map(
            (section) => html`
              <div class="help-subsection">
                <div class="text-lg font-bold mb-2">
                  <span class="tab-icon inline-icon" style="margin-right: 8px;">
                    ${unsafeHTML(section.icon)}
                  </span>
                  ${this.t(section.titleKey)}
                </div>
                <div class="help-row">
                  <div class="help-col">
                    <p class="mb-2">${this.t(section.descKey)}</p>
                  </div>
                  <div class="help-col">
                    <img
                      src="${section.img}"
                      class="help-image help-image-small"
                      alt="${this.t(section.altKey)}"
                      style="margin-top: 0;"
                    />
                  </div>
                </div>
              </div>
            `,
          )}
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.radial_title")}
          </div>
          <div class="help-row">
            <div class="help-col">
              <p class="mb-2">${this.t("ui_guide.radial_intro")}</p>
              <ul class="help-list">
                <li>
                  <div class="icon info-icon inline-icon"></div>
                  ${unsafeHTML(this.t("ui_guide.radial_info"))}
                </li>
                <li>
                  <div class="icon boat-icon inline-icon"></div>
                  ${unsafeHTML(this.t("ui_guide.radial_transport"))}
                </li>
                <li>
                  <div class="icon alliance-icon inline-icon"></div>
                  ${unsafeHTML(this.t("ui_guide.radial_alliance"))}
                </li>
                <li>
                  <div class="icon betray-icon inline-icon"></div>
                  ${unsafeHTML(this.t("ui_guide.radial_betray"))}
                </li>
                <li>
                  <div class="icon dove-icon inline-icon"></div>
                  ${unsafeHTML(this.t("ui_guide.radial_peace"))}
                </li>
                <li>
                  <div class="icon war-icon inline-icon"></div>
                  ${unsafeHTML(this.t("ui_guide.radial_war"))}
                </li>
                <li>
                  <div class="icon air-attack-icon inline-icon"></div>
                  ${unsafeHTML(this.t("ui_guide.radial_air"))}
                </li>
                <li>
                  <div class="icon sword-icon inline-icon"></div>
                  ${unsafeHTML(this.t("ui_guide.radial_attack"))}
                </li>
              </ul>
              <p class="mt-2 text-sm opacity-80">
                ${unsafeHTML(this.t("ui_guide.radial_note"))}
              </p>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/RadialMenu.png"
                class="help-image help-image-medium"
                alt="${this.t("ui_guide.radial_image_alt")}"
                style="margin-top: 0;"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.events_title")}
          </div>
          <div class="help-row">
            <div class="help-col">
              <p class="mb-2">${this.t("ui_guide.events_intro")}</p>

              <ul class="help-list">
                ${this.renderList(eventsItems)}
              </ul>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/EventPanel.png"
                class="help-image help-image-medium"
                alt="${this.t("ui_guide.events_image_alt")}"
                style="margin-top: 0;"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.leaderboard_title")}
          </div>
          <div class="help-row">
            <div class="help-col">
              <p class="mb-2">${this.t("ui_guide.leaderboard_intro")}</p>
              <ul class="help-list">
                ${this.renderList(leaderboardItems)}
              </ul>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/Leaderboard.png"
                class="help-image help-image-small"
                alt="${this.t("ui_guide.leaderboard_image_alt")}"
                style="margin-top: 0;"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.research_button_title")}
          </div>
          <div class="help-row">
            <div class="help-col">
              <p class="mb-2">${this.t("ui_guide.research_button_intro")}</p>
              <ul class="help-list">
                ${this.renderList(researchButtonItems)}
              </ul>
              <p class="mt-2 text-sm opacity-80">
                ${unsafeHTML(this.t("ui_guide.research_button_tip"))}
              </p>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/OpenResearch.png"
                class="help-image"
                style="max-width: 100px; max-height: 200px; margin-top: 0; object-fit: contain; border: none; box-shadow: none; border-radius: 0;"
                alt="${this.t("ui_guide.research_button_image_alt")}"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.options_title")}
          </div>
          <div class="help-row">
            <div class="help-col">
              <p class="mb-2">${this.t("ui_guide.options_intro")}</p>

              <ul class="help-list">
                ${this.renderList(["ui_guide.options_gameplay"])}
              </ul>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/Options.png"
                class="help-image help-image-medium"
                alt="${this.t("ui_guide.options_image_alt")}"
                style="margin-top: 0;"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("ui_guide.status_title")}
          </div>
          <p class="mb-2">${this.t("ui_guide.status_intro")}</p>
          <div class="help-row">
            <div class="help-col">
              <ul class="help-list">
                ${this.renderList(statusItems)}
              </ul>
            </div>
            <div class="help-col">
              <div
                style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: center;"
              >
                <img
                  src="/images/HelpModalScreenshots/Peace.png"
                  class="help-image"
                  style="max-width: 120px; margin: 5px;"
                  alt="${this.t("ui_guide.status_peace_alt")}"
                />
                <img
                  src="/images/HelpModalScreenshots/AllianceRequest.png"
                  class="help-image"
                  style="max-width: 120px; margin: 5px;"
                  alt="${this.t("ui_guide.status_alliance_alt")}"
                />
                <img
                  src="/images/HelpModalScreenshots/Traitor.png"
                  class="help-image"
                  style="max-width: 120px; margin: 5px;"
                  alt="${this.t("ui_guide.status_traitor_alt")}"
                />
                <img
                  src="/images/HelpModalScreenshots/Embargo.png"
                  class="help-image"
                  style="max-width: 120px; margin: 5px;"
                  alt="${this.t("ui_guide.status_embargo_alt")}"
                />
              </div>
            </div>
          </div>
          <p class="mt-2 text-sm opacity-80">
            ${unsafeHTML(this.t("ui_guide.status_tip"))}
          </p>
        </div>
      </div>
    `;
  }

  private renderStructuresTab() {
    const structures = [
      {
        nameKey: "structures.city.name",
        iconClass: "city-icon",
        hotkey: "Y",
        descKey: "structures.city.desc",
      },
      {
        nameKey: "structures.defense_post.name",
        iconClass: "defense-post-icon",
        hotkey: "K",
        descKey: "structures.defense_post.desc",
      },
      {
        nameKey: "structures.port.name",
        iconClass: "port-icon",
        hotkey: "U",
        descKey: "structures.port.desc",
      },
      {
        nameKey: "structures.airfield.name",
        iconClass: "airfield-icon",
        hotkey: "I",
        descKey: "structures.airfield.desc",
      },
      {
        nameKey: "structures.hospital.name",
        iconClass: "hospital-icon",
        hotkey: "O",
        descKey: "structures.hospital.desc",
      },
      {
        nameKey: "structures.research_lab.name",
        iconClass: "research-lab-icon",
        hotkey: "L",
        descKey: "structures.research_lab.desc",
      },
      {
        nameKey: "structures.military_academy.name",
        iconClass: "academy-icon",
        hotkey: "P",
        descKey: "structures.military_academy.desc",
      },
      {
        nameKey: "structures.factory.name",
        iconClass: "factory-icon",
        hotkey: "F",
        descKey: "structures.factory.desc",
      },
      {
        nameKey: "structures.missile_silo.name",
        iconClass: "missile-silo-icon",
        hotkey: "H",
        descKey: "structures.missile_silo.desc",
      },
      {
        nameKey: "structures.sam_launcher.name",
        iconClass: "sam-launcher-icon",
        hotkey: "J",
        descKey: "structures.sam_launcher.desc",
      },
      {
        nameKey: "structures.doomsday.name",
        iconClass: "doomsday-icon",
        hotkey: this.t("labels.none"),
        descKey: "structures.doomsday.desc",
      },
    ];

    const buildingHotkeys = [
      "structures.hotkeys_view",
      "structures.hotkeys_reference",
    ];

    return html`
      <div class="help-tab-content">
        <div class="text-2xl font-bold mb-4 text-center">
          ${this.t("structures.title")}
        </div>

        <div class="help-text">
          <p>${unsafeHTML(this.t("structures.intro"))}</p>
        </div>

        <table class="help-table">
          <thead>
            <tr>
              <th>${this.t("labels.name")}</th>
              <th class="icon-col">${this.t("labels.icon")}</th>
              <th>${this.t("labels.hotkey")}</th>
              <th>${this.t("labels.description")}</th>
            </tr>
          </thead>
          <tbody class="text-left">
            ${structures.map(
              (structure) => html`
                <tr>
                  <td><strong>${this.t(structure.nameKey)}</strong></td>
                  <td><div class="icon ${structure.iconClass}"></div></td>
                  <td>${this.renderHotkey(structure.hotkey)}</td>
                  <td>${unsafeHTML(this.t(structure.descKey))}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("structures.hotkeys_title")}
          </div>
          <p class="mb-2">${unsafeHTML(this.t("structures.hotkeys_intro"))}</p>
          <ul class="help-list">
            ${this.renderList(buildingHotkeys)}
          </ul>
        </div>
      </div>
    `;
  }

  private renderUnitsTab() {
    const deploymentKeys = [
      "units.deployment_recruitment",
      "units.deployment_ai",
      "units.deployment_manual",
      "units.deployment_prereq",
      "units.deployment_upgrades",
    ];

    const navalUnits = [
      {
        nameKey: "units.naval.transport.name",
        iconClass: "transport-ship-icon",
        hotkey: this.t("labels.menu"),
        descKey: "units.naval.transport.desc",
      },
      {
        nameKey: "units.naval.warship.name",
        iconClass: "warship-icon",
        hotkey: "9",
        descKey: "units.naval.warship.desc",
      },
      {
        nameKey: "units.naval.submarine.name",
        iconClass: "submarine-icon",
        hotkey: "0",
        descKey: "units.naval.submarine.desc",
      },
      {
        nameKey: "units.naval.trade_ship.name",
        iconClass: "boat-icon",
        hotkey: this.t("labels.auto"),
        descKey: "units.naval.trade_ship.desc",
      },
    ];

    const airUnits = [
      {
        nameKey: "units.air.bomber.name",
        iconClass: "airfield-icon",
        hotkey: this.t("labels.auto"),
        descKey: "units.air.bomber.desc",
      },
      {
        nameKey: "units.air.fighter.name",
        iconClass: "fighter-jet-icon",
        hotkey: "8",
        descKey: "units.air.fighter.desc",
      },
      {
        nameKey: "units.air.paratrooper.name",
        iconClass: "air-attack-icon",
        hotkey: this.t("labels.menu"),
        descKey: "units.air.paratrooper.desc",
      },
    ];

    const nuclearUnits = [
      {
        nameKey: "units.nuclear.atom.name",
        iconClass: "atom-bomb-icon",
        hotkey: "5",
        descKey: "units.nuclear.atom.desc",
      },
      {
        nameKey: "units.nuclear.hydrogen.name",
        iconClass: "hydrogen-bomb-icon",
        hotkey: "6",
        descKey: "units.nuclear.hydrogen.desc",
      },
      {
        nameKey: "units.nuclear.mirv.name",
        iconClass: "mirv-icon",
        hotkey: "7",
        descKey: "units.nuclear.mirv.desc",
      },
    ];

    const renderUnitRows = (rows: any[]) =>
      rows.map(
        (unit) => html`
          <tr>
            <td><strong>${this.t(unit.nameKey)}</strong></td>
            <td><div class="icon ${unit.iconClass}"></div></td>
            <td>${this.renderHotkey(unit.hotkey)}</td>
            <td>${unsafeHTML(this.t(unit.descKey))}</td>
          </tr>
        `,
      );

    return html`
      <div class="help-tab-content">
        <div class="text-2xl font-bold mb-4 text-center">
          ${this.t("units.title")}
        </div>
        <p class="mb-4 text-center">${this.t("units.intro")}</p>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("units.deployment_title")}
          </div>
          <ul class="help-list">
            ${this.renderList(deploymentKeys)}
          </ul>
        </div>

        <div class="help-subsection">
          <div class="text-xl font-bold mb-3">
            ${this.t("units.naval.title")}
          </div>
          <table class="help-table">
            <thead>
              <tr>
                <th>${this.t("labels.name")}</th>
                <th class="icon-col">${this.t("labels.icon")}</th>
                <th>${this.t("labels.hotkey")}</th>
                <th>${this.t("labels.description")}</th>
              </tr>
            </thead>
            <tbody class="text-left">
              ${renderUnitRows(navalUnits)}
            </tbody>
          </table>
        </div>

        <div class="help-subsection">
          <div class="text-xl font-bold mb-3 mt-6">
            ${this.t("units.air.title")}
          </div>
          <table class="help-table">
            <thead>
              <tr>
                <th>${this.t("labels.name")}</th>
                <th class="icon-col">${this.t("labels.icon")}</th>
                <th>${this.t("labels.hotkey")}</th>
                <th>${this.t("labels.description")}</th>
              </tr>
            </thead>
            <tbody class="text-left">
              ${renderUnitRows(airUnits)}
            </tbody>
          </table>
        </div>

        <div class="help-subsection">
          <div class="text-xl font-bold mb-3 mt-6">
            ${this.t("units.nuclear.title")}
          </div>
          <table class="help-table">
            <thead>
              <tr>
                <th>${this.t("labels.name")}</th>
                <th class="icon-col">${this.t("labels.icon")}</th>
                <th>${this.t("labels.hotkey")}</th>
                <th>${this.t("labels.description")}</th>
              </tr>
            </thead>
            <tbody class="text-left">
              ${renderUnitRows(nuclearUnits)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private renderInvestmentTab() {
    const researchItems = [
      "investment.research_rate",
      "investment.research_speed",
      "investment.research_labs",
    ];

    const productivityItems = [
      "investment.productivity_growth",
      "investment.productivity_compound",
      "investment.productivity_loss",
      "investment.productivity_importance",
    ];

    const roadItems = [
      "investment.roads_rate",
      "investment.roads_effects",
      "investment.roads_maintenance",
      "investment.roads_break_even",
      "investment.roads_quality",
      "investment.roads_completion",
    ];

    const strategyItems = [
      "investment.strategy_early",
      "investment.strategy_mid",
      "investment.strategy_late",
      "investment.strategy_under_attack",
    ];

    const researchStrategyItems = [
      "investment.research_strategy_early",
      "investment.research_strategy_mid",
      "investment.research_strategy_late",
      "investment.research_strategy_defensive",
      "investment.research_strategy_offensive",
      "investment.research_strategy_naval",
    ];

    return html`
      <div class="help-tab-content">
        <div class="text-2xl font-bold mb-4 text-center">
          ${this.t("investment.title")}
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("investment.overview_title")}
          </div>
          <div class="help-row">
            <div class="help-col">
              <p class="mb-3">${this.t("investment.overview_desc")}</p>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/CC-Economoy.png"
                class="help-image help-image-small"
                alt="${this.t("investment.overview_image_alt")}"
                style="margin-top: 0;"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("investment.research_title")}
          </div>
          <p class="mb-2">${this.t("investment.research_intro")}</p>
          <ul class="help-list">
            ${this.renderList(researchItems)}
          </ul>
          <p class="mt-2 text-sm opacity-80">
            ${unsafeHTML(this.t("investment.research_tip"))}
          </p>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("investment.productivity_title")}
          </div>
          <p class="mb-2">${this.t("investment.productivity_intro")}</p>
          <ul class="help-list">
            ${this.renderList(productivityItems)}
          </ul>
          <p class="mt-2 text-sm opacity-80">
            ${unsafeHTML(this.t("investment.productivity_tip"))}
          </p>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("investment.roads_title")}
          </div>
          <p class="mb-2">${this.t("investment.roads_intro")}</p>
          <ul class="help-list">
            ${this.renderList(roadItems)}
          </ul>
          <p class="mt-2 text-sm opacity-80">
            ${unsafeHTML(this.t("investment.roads_tip"))}
          </p>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("investment.strategy_title")}
          </div>
          <p class="mb-2">${this.t("investment.strategy_intro")}</p>
          <ul class="help-list">
            ${this.renderList(strategyItems)}
          </ul>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("investment.research_strategy_title")}
          </div>
          <ul class="help-list">
            ${this.renderList(researchStrategyItems)}
          </ul>
        </div>
      </div>
    `;
  }

  private renderTechTreeTab() {
    const nodes = getTechNodes();

    // Group techs by category
    const categories: Record<string, any[]> = {
      Land: [],
      Sea: [],
      Air: [],
      Nuclear: [],
      Economy: [],
    };

    for (const node of nodes) {
      const techDef = TECHS[node.id];
      if (techDef && categories[node.category]) {
        categories[node.category].push({
          ...node,
          name: techDef.meta.name,
          description:
            techDef.meta.description ?? this.t("tech_tree.no_description"),
        });
      }
    }

    // Sort each category by level
    for (const cat in categories) {
      categories[cat].sort((a, b) => a.level - b.level);
    }

    const researchWorkItems = [
      "tech_tree.research_prereq",
      "tech_tree.research_all_of",
      "tech_tree.research_one_of",
      "tech_tree.research_priority",
      "tech_tree.research_progress",
      "tech_tree.research_completion",
      "tech_tree.research_beakers",
    ];

    const categoryLabels: Record<string, string> = {
      Land: this.t("tech_tree.categories.land"),
      Sea: this.t("tech_tree.categories.sea"),
      Air: this.t("tech_tree.categories.air"),
      Nuclear: this.t("tech_tree.categories.nuclear"),
      Economy: this.t("tech_tree.categories.economy"),
    };

    const categoryDescriptions: Record<string, string> = {
      Land: this.t("tech_tree.categories.land_desc"),
      Sea: this.t("tech_tree.categories.sea_desc"),
      Air: this.t("tech_tree.categories.air_desc"),
      Nuclear: this.t("tech_tree.categories.nuclear_desc"),
      Economy: this.t("tech_tree.categories.economy_desc"),
    };

    return html`
      <div class="help-tab-content">
        <div class="text-2xl font-bold mb-4 text-center">
          ${this.t("tech_tree.title")}
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("tech_tree.overview_title")}
          </div>
          <div class="help-row">
            <div class="help-col">
              <p class="mb-3">${this.t("tech_tree.overview_desc")}</p>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/ReseacrhTree-Land.png"
                class="help-image help-image-small"
                alt="${this.t("tech_tree.overview_image_alt")}"
                style="margin-top: 0;"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">${this.t("tech_tree.how_title")}</div>
          <div class="help-row">
            <div class="help-col">
              <ul class="help-list">
                ${this.renderList(researchWorkItems)}
              </ul>
            </div>
            <div class="help-col">
              <img
                src="/images/HelpModalScreenshots/OpenResearch.png"
                class="help-image"
                style="max-width: 100px; max-height: 200px; margin-top: 0; object-fit: contain; border: none; box-shadow: none; border-radius: 0;"
                alt="${this.t("tech_tree.how_image_alt")}"
              />
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("tech_tree.categories_title")}
          </div>

          ${Object.entries(categories).map(
            ([category, techs]) => html`
              <div class="help-subsection">
                <div class="text-lg font-bold mb-2 mt-3">
                  ${categoryLabels[category]}
                </div>
                <p class="mb-2 text-sm opacity-80">
                  ${categoryDescriptions[category]}
                </p>
                <ul class="help-list text-sm">
                  ${techs.map(
                    (tech) => html`
                      <li>
                        <strong>${tech.name}:</strong> ${tech.description}
                        ${tech.cost
                          ? html`<span class="opacity-60"
                              >(${this.t("tech_tree.cost", {
                                cost: tech.cost,
                              })})</span
                            >`
                          : ""}
                      </li>
                    `,
                  )}
                </ul>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderStrategyTab() {
    const earlyGameItems = [
      "strategy.early_starting_position",
      "strategy.early_expand",
      "strategy.early_balance",
      "strategy.early_city",
      "strategy.early_research",
      "strategy.early_keep_expanding",
      "strategy.early_watch_borders",
    ];

    const midGameItems = [
      "strategy.mid_diversify",
      "strategy.mid_research_priority",
      "strategy.mid_alliances",
      "strategy.mid_naval_air",
      "strategy.mid_productivity",
      "strategy.mid_roads",
    ];

    const lateGameItems = [
      "strategy.late_weapons",
      "strategy.late_air",
      "strategy.late_defense",
      "strategy.late_economy",
      "strategy.late_coordination",
      "strategy.late_doomsday",
    ];

    const mistakesItems = [
      "strategy.mistake_research",
      "strategy.mistake_balance",
      "strategy.mistake_overextend",
      "strategy.mistake_defense",
      "strategy.mistake_diplomacy",
      "strategy.mistake_trade",
    ];

    const productivitySteps = [
      "strategy.advanced_productivity_step1",
      "strategy.advanced_productivity_step2",
      "strategy.advanced_productivity_step3",
      "strategy.advanced_productivity_step4",
    ];

    const bomberSteps = [
      "strategy.advanced_bombers_step1",
      "strategy.advanced_bombers_step2",
      "strategy.advanced_bombers_step3",
      "strategy.advanced_bombers_step4",
    ];

    const navalSteps = [
      "strategy.advanced_naval_step1",
      "strategy.advanced_naval_step2",
      "strategy.advanced_naval_step3",
      "strategy.advanced_naval_step4",
    ];

    const nuclearSteps = [
      "strategy.advanced_nuclear_step1",
      "strategy.advanced_nuclear_step2",
      "strategy.advanced_nuclear_step3",
      "strategy.advanced_nuclear_step4",
      "strategy.advanced_nuclear_step5",
    ];

    const allianceSteps = [
      "strategy.advanced_alliance_step1",
      "strategy.advanced_alliance_step2",
      "strategy.advanced_alliance_step3",
      "strategy.advanced_alliance_step4",
    ];

    const mapTips = [
      "strategy.map_island",
      "strategy.map_continental",
      "strategy.map_large",
      "strategy.map_small",
    ];

    return html`
      <div class="help-tab-content">
        <div class="text-2xl font-bold mb-4 text-center">
          ${this.t("strategy.title")}
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("strategy.early_title")}
          </div>
          <p class="mb-2">${this.t("strategy.early_intro")}</p>
          <ol class="help-list">
            ${this.renderOrderedList(earlyGameItems)}
          </ol>
        </div>

        <div class="help-section">
          <div class="help-section-title">${this.t("strategy.mid_title")}</div>
          <p class="mb-2">${this.t("strategy.mid_intro")}</p>
          <ul class="help-list">
            ${this.renderList(midGameItems)}
          </ul>
        </div>

        <div class="help-section">
          <div class="help-section-title">${this.t("strategy.late_title")}</div>
          <p class="mb-2">${this.t("strategy.late_intro")}</p>
          <ul class="help-list">
            ${this.renderList(lateGameItems)}
          </ul>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("strategy.mistakes_title")}
          </div>
          <ul class="help-list no-bullets">
            ${mistakesItems.map(
              (key) => html`
                <li style="display: flex; align-items: flex-start; gap: 8px;">
                  <span
                    class="tab-icon inline-icon"
                    style="flex-shrink: 0; color: #ef4444;"
                  >
                    ${unsafeHTML(
                      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
                    )}
                  </span>
                  <span>${unsafeHTML(this.t(key))}</span>
                </li>
              `,
            )}
          </ul>
        </div>

        <div class="help-section">
          <div class="help-section-title">
            ${this.t("strategy.advanced_title")}
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2">
              ${this.t("strategy.advanced_productivity_title")}
            </div>
            <p class="mb-2">
              ${this.t("strategy.advanced_productivity_intro")}
            </p>
            <ul class="help-list text-sm">
              ${this.renderList(productivitySteps)}
            </ul>
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2 mt-3">
              ${this.t("strategy.advanced_bombers_title")}
            </div>
            <p class="mb-2">${this.t("strategy.advanced_bombers_intro")}</p>
            <ul class="help-list text-sm">
              ${this.renderList(bomberSteps)}
            </ul>
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2 mt-3">
              ${this.t("strategy.advanced_naval_title")}
            </div>
            <p class="mb-2">${this.t("strategy.advanced_naval_intro")}</p>
            <ul class="help-list text-sm">
              ${this.renderList(navalSteps)}
            </ul>
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2 mt-3">
              ${this.t("strategy.advanced_nuclear_title")}
            </div>
            <p class="mb-2">${this.t("strategy.advanced_nuclear_intro")}</p>
            <ul class="help-list text-sm">
              ${this.renderList(nuclearSteps)}
            </ul>
          </div>

          <div class="help-subsection">
            <div class="text-lg font-bold mb-2 mt-3">
              ${this.t("strategy.advanced_alliance_title")}
            </div>
            <p class="mb-2">${this.t("strategy.advanced_alliance_intro")}</p>
            <ul class="help-list text-sm">
              ${this.renderList(allianceSteps)}
            </ul>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">${this.t("strategy.map_title")}</div>
          <ul class="help-list">
            ${this.renderList(mapTips)}
          </ul>
        </div>
      </div>
    `;
  }
  render() {
    let tabContent;
    switch (this.activeTab) {
      case "GettingStarted":
        tabContent = this.renderGettingStartedTab();
        break;
      case "UIGuide":
        tabContent = this.renderUIGuideTab();
        break;
      case "Structures":
        tabContent = this.renderStructuresTab();
        break;
      case "Units":
        tabContent = this.renderUnitsTab();
        break;
      case "Investment":
        tabContent = this.renderInvestmentTab();
        break;
      case "TechTree":
        tabContent = this.renderTechTreeTab();
        break;
      case "Strategy":
        tabContent = this.renderStrategyTab();
        break;
    }

    return html`
      <o-modal
        id="helpModal"
        title="Instructions"
        translationKey="main.instructions"
        max-width="min(90vw, 1200px)"
        max-height="85dvh"
      >
        <style>
          .help-tab-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 20px;
            border-bottom: 2px solid rgba(255, 255, 255, 0.1);
            padding-bottom: 0;
          }
          .help-tab {
            flex: 1 1 auto;
            min-width: 80px;
            padding: 10px 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px 6px 0 0;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
            text-align: center;
            font-size: 14px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
          }
          .help-tab:hover {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.9);
          }
          .help-tab.active {
            background: rgba(59, 130, 246, 0.3);
            border-color: rgba(59, 130, 246, 0.5);
            color: white;
            border-bottom: none;
            position: relative;
            z-index: 1;
            /* No margin-bottom so it sits flush with the line */
          }
          .help-tab-content {
            width: 80vw;
            max-width: 1100px;
            max-height: 60vh;
            overflow-y: auto;
            padding-right: 8px;
          }
          .help-tab-content::-webkit-scrollbar {
            width: 8px;
          }
          .help-tab-content::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
          }
          .help-tab-content::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 4px;
          }
          .help-tab-content::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
          }
          .help-table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
          }
          .help-table th,
          .help-table td {
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            text-align: left;
          }
          .tab-icon {
            width: 22px;
            height: 22px;
            display: inline-block;
          }
          .tab-icon svg {
            width: 100%;
            height: 100%;
            stroke: currentColor;
            stroke-linecap: round;
            stroke-linejoin: round;
            fill: none;
          }
          .help-table th {
            background: rgba(255, 255, 255, 0.1);
            font-weight: 600;
          }
          .help-table .icon-col {
            width: 60px;
            text-align: center;
          }
          .help-table td:nth-child(2) {
            text-align: center;
          }
          .help-section {
            margin: 20px 0;
            padding: 16px;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 8px;
            border-left: 3px solid rgba(59, 130, 246, 0.5);
          }
          .help-section-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
            color: rgba(59, 130, 246, 0.9);
          }
          .help-subsection {
            margin: 16px 0;
          }
          .help-list {
            list-style: disc;
            margin-left: 24px;
            margin-top: 8px;
          }
          .help-list li {
            margin: 6px 0;
            line-height: 1.5;
          }
          .help-list.no-bullets {
            list-style: none;
            margin-left: 0;
            padding-left: 0;
          }
          .inline-icon {
            display: inline-block;
            vertical-align: middle;
            width: 20px;
            height: 20px;
            margin-right: 4px;
          }
          .key-label {
            font-size: 12px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.7);
            padding: 2px 4px;
            display: inline-block;
          }

          @media screen and (max-width: 768px) {
            .help-tab {
              font-size: 12px;
              padding: 8px 8px;
              min-width: 60px;
            }
            .help-tab-content {
              max-height: 65vh;
            }
            .help-table {
              font-size: 13px;
            }
            .help-table th,
            .help-table td {
              padding: 8px;
            }
          }

          @media screen and (max-width: 480px) {
            .help-tab {
              font-size: 11px;
              padding: 6px 4px;
              min-width: 50px;
            }
            .help-table {
              font-size: 12px;
            }
            .help-table th,
            .help-table td {
              padding: 6px;
            }
          }

          .help-image {
            width: 100%;
            max-width: 900px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
            margin: 10px auto;
            display: block;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }

          .help-image-small {
            max-width: 360px;
          }

          .help-image-medium {
            max-width: 360px;
          }

          .help-row {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            align-items: flex-start;
          }

          .help-col {
            flex: 1 1 250px;
            min-width: 0;
          }
        </style>

        ${this.renderTabBar()} ${tabContent}
      </o-modal>
    `;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
