import { LitElement, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { translateText } from "../../Utils";

@customElement("mobile-help-modal")
export class MobileHelpModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  createRenderRoot() {
    return this;
  }

  private t(key: string, params: Record<string, string | number> = {}) {
    return translateText(`help_modal_v2.${key}`, params);
  }

  private economyPanelIcon() {
    return html`
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
        <polyline points="16 7 22 7 22 13"></polyline>
      </svg>
    `;
  }

  private researchPanelIcon() {
    return html`
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"
        ></path>
        <path d="M8.5 2h7"></path>
        <path d="M7 16h10"></path>
      </svg>
    `;
  }

  private intelPanelIcon() {
    return html`
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="2"></circle>
        <path
          d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"
        ></path>
      </svg>
    `;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  render() {
    return html`
      <o-modal
        id="mobileHelpModal"
        title="Instructions"
        translationKey="main.instructions"
        max-width="min(96vw, 560px)"
        max-height="88dvh"
      >
        <style>
          #mobileHelpModal .mobile-help-root {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 4px 4px calc(14px + env(safe-area-inset-bottom, 0px)) 4px;
            background:
              radial-gradient(
                circle at 12% 0%,
                rgba(108, 139, 204, 0.16),
                transparent 32%
              ),
              radial-gradient(
                circle at 88% 100%,
                rgba(153, 181, 238, 0.1),
                transparent 28%
              );
            border-radius: 12px;
          }

          #mobileHelpModal .c-modal__content {
            -webkit-overflow-scrolling: touch;
            overscroll-behavior: contain;
            touch-action: pan-y;
          }

          #mobileHelpModal .mobile-help-intro {
            margin: 0;
            padding: 11px 12px;
            border-radius: 10px;
            border: 1px solid rgba(159, 194, 255, 0.34);
            background: linear-gradient(
              180deg,
              rgba(56, 67, 88, 0.96),
              rgba(23, 30, 44, 0.95)
            );
            color: rgba(233, 239, 255, 0.95);
            font-size: 13px;
            line-height: 1.45;
            letter-spacing: 0.1px;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.08),
              0 10px 22px rgba(0, 0, 0, 0.34);
          }

          #mobileHelpModal details {
            --section-accent: rgba(146, 179, 240, 0.68);
            border-radius: 10px;
            border: 1px solid rgba(142, 169, 221, 0.26);
            background: linear-gradient(
              180deg,
              rgba(39, 48, 64, 0.95),
              rgba(19, 24, 34, 0.95)
            );
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.08),
              inset 0 -1px 0 rgba(0, 0, 0, 0.35),
              0 10px 22px rgba(0, 0, 0, 0.3);
            overflow: hidden;
            position: relative;
          }

          #mobileHelpModal details::before {
            content: "";
            position: absolute;
            inset: 0 auto 0 0;
            width: 3px;
            background: linear-gradient(
              180deg,
              var(--section-accent),
              rgba(102, 128, 177, 0.25)
            );
            opacity: 0.95;
          }

          #mobileHelpModal details:nth-of-type(1) {
            --section-accent: rgba(112, 195, 255, 0.8);
          }

          #mobileHelpModal details:nth-of-type(2) {
            --section-accent: rgba(124, 231, 197, 0.78);
          }

          #mobileHelpModal details:nth-of-type(3) {
            --section-accent: rgba(225, 184, 109, 0.8);
          }

          #mobileHelpModal details:nth-of-type(4) {
            --section-accent: rgba(214, 142, 186, 0.78);
          }

          #mobileHelpModal details + details {
            margin-top: 2px;
          }

          #mobileHelpModal summary {
            list-style: none;
            cursor: pointer;
            min-height: 44px;
            padding: 12px 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            color: #ecf2ff;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.2px;
            text-shadow: 0 1px 0 rgba(0, 0, 0, 0.3);
            user-select: none;
            transition: background-color 0.2s ease;
            background: linear-gradient(
              180deg,
              rgba(79, 95, 122, 0.28),
              rgba(34, 42, 58, 0.16)
            );
          }

          #mobileHelpModal summary::-webkit-details-marker {
            display: none;
          }

          #mobileHelpModal summary::after {
            content: "▾";
            font-size: 14px;
            color: rgba(194, 214, 255, 0.92);
            transform: rotate(-90deg);
            transition: transform 0.18s ease;
          }

          #mobileHelpModal details[open] summary::after {
            transform: rotate(0deg);
          }

          #mobileHelpModal summary:active {
            background-color: rgba(120, 152, 218, 0.18);
          }

          #mobileHelpModal .mobile-help-body {
            padding: 0 14px 12px 14px;
          }

          #mobileHelpModal .mobile-help-body p {
            margin: 8px 0 10px;
            color: rgba(231, 237, 255, 0.9);
            font-size: 13px;
            line-height: 1.5;
          }

          #mobileHelpModal .mobile-help-list {
            margin: 8px 0 0 0;
            padding: 0;
            list-style: none;
            color: rgba(232, 238, 255, 0.92);
            font-size: 13px;
            line-height: 1.45;
            display: grid;
            gap: 7px;
          }

          #mobileHelpModal .mobile-help-list li {
            margin: 0;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid rgba(144, 173, 230, 0.18);
            border-left: 2px solid
              var(--section-accent, rgba(142, 169, 221, 0.6));
            background: linear-gradient(
              180deg,
              rgba(36, 45, 62, 0.8),
              rgba(23, 30, 43, 0.78)
            );
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
            display: flex;
            align-items: flex-start;
            gap: 8px;
          }

          #mobileHelpModal .mobile-help-line {
            display: block;
            flex: 1;
            min-width: 0;
          }

          #mobileHelpModal .mobile-help-visual {
            width: 20px;
            height: 20px;
            border-radius: 6px;
            border: 1px solid rgba(159, 187, 241, 0.34);
            background: rgba(17, 25, 39, 0.78);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 20px;
            margin-top: 1px;
          }

          #mobileHelpModal .mobile-help-visual img,
          #mobileHelpModal .mobile-help-visual svg {
            width: 13px;
            height: 13px;
            object-fit: contain;
            color: rgba(224, 237, 255, 0.96);
            stroke: currentColor;
          }

          #mobileHelpModal .mobile-help-tip {
            margin-top: 10px;
            padding: 9px 10px;
            border-radius: 8px;
            border: 1px solid rgba(120, 178, 255, 0.38);
            background: linear-gradient(
              180deg,
              rgba(35, 52, 78, 0.68),
              rgba(25, 39, 58, 0.62)
            );
            color: rgba(218, 231, 255, 0.95);
            font-size: 12px;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
          }

          #mobileHelpModal .mobile-help-shortcuts {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 8px;
          }

          #mobileHelpModal .mobile-help-shortcut {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            border-radius: 999px;
            border: 1px solid rgba(145, 177, 235, 0.34);
            background: rgba(22, 31, 46, 0.86);
            color: rgba(220, 232, 255, 0.95);
            font-size: 11px;
            line-height: 1;
            font-weight: 600;
          }

          #mobileHelpModal .mobile-help-shortcut svg {
            width: 14px;
            height: 14px;
            stroke: currentColor;
            opacity: 0.95;
            flex: 0 0 auto;
          }
        </style>

        <div class="mobile-help-root">
          <p class="mobile-help-intro">
            Mobile Instructions are optimized for touch gameplay and mobile UI.
            Some desktop-only controls and panels are intentionally excluded.
          </p>

          <details open>
            <summary>Basics</summary>
            <div class="mobile-help-body">
              <p>
                ${unsafeHTML(this.t("getting_started.objective_description"))}
              </p>
              <ul class="mobile-help-list">
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/TargetIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line">
                    <strong>Select Spawn Point:</strong> Tap the map to choose
                    your starting location with room to expand.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/TroopIconWhite.png" alt=""
                  /></span>
                  <span class="mobile-help-line">
                    <strong>Expand Territory:</strong> Tap adjacent unconquered
                    tiles to send troops and capture land.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/CityIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line">
                    <strong>Build Your First City:</strong> Open the Action Grid
                    on your land, choose City, and place it to grow your
                    population cap.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    >${this.economyPanelIcon()}</span
                  >
                  <span class="mobile-help-line">
                    <strong>Manage Economy:</strong> Open the Economy panel and
                    tune investments to balance growth, roads, and research.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    >${this.researchPanelIcon()}</span
                  >
                  <span class="mobile-help-line">
                    <strong>Prioritize Research:</strong> Research is a key
                    feature— early tech choices create big long-term advantages.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/SwordIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line">
                    <strong>Keep Expanding:</strong> Continue capturing neutral
                    tiles and nearby bots to snowball your economy and map
                    control.
                  </span>
                </li>
              </ul>
            </div>
          </details>

          <details>
            <summary>Mobile Controls</summary>
            <div class="mobile-help-body">
              <ul class="mobile-help-list">
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/SwordIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line"
                    >Tap map tiles to open context actions and attack/build
                    flows.</span
                  >
                </li>
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/AllianceIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line"
                    >Long-press player tiles for quick diplomacy/chat/emoji
                    actions.</span
                  >
                </li>
                <li>
                  <span class="mobile-help-visual">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </span>
                  <span class="mobile-help-line"
                    >Pinch to zoom and drag to pan, or use the left-side zoom
                    buttons.</span
                  >
                </li>
                <li>
                  <span class="mobile-help-visual"
                    >${this.intelPanelIcon()}</span
                  >
                  <span class="mobile-help-line">
                    Use the same in-game side-panel shortcuts to manage your
                    empire:
                    <div class="mobile-help-shortcuts">
                      <span class="mobile-help-shortcut">
                        ${this.economyPanelIcon()} Economy
                      </span>
                      <span class="mobile-help-shortcut">
                        ${this.researchPanelIcon()} Research
                      </span>
                      <span class="mobile-help-shortcut">
                        ${this.intelPanelIcon()} Intel
                      </span>
                    </div>
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/TargetIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line">
                    Open Instructions from the main lobby button for this
                    mobile-focused guide anytime.
                  </span>
                </li>
              </ul>
              <div class="mobile-help-tip">
                Tip: Keep enough troops at home before aggressive attacks to
                avoid fast counter-captures.
              </div>
            </div>
          </details>

          <details>
            <summary>Mobile UI Panels</summary>
            <div class="mobile-help-body">
              <ul class="mobile-help-list">
                <li>
                  <span class="mobile-help-visual"
                    >${this.economyPanelIcon()}</span
                  >
                  <span class="mobile-help-line">
                    <strong>Economy:</strong> Adjust investments and combat
                    ratios with touch sliders.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    >${this.researchPanelIcon()}</span
                  >
                  <span class="mobile-help-line">
                    <strong>Research:</strong> Track categories and prioritize
                    technologies.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    >${this.intelPanelIcon()}</span
                  >
                  <span class="mobile-help-line">
                    <strong>Intel:</strong> Review leaderboard/events in a
                    compact sidebar.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/SwordIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line">
                    <strong>Action Grid:</strong> Context-sensitive
                    build/attack/diplomacy actions tuned for touch.
                  </span>
                </li>
              </ul>
            </div>
          </details>

          <details>
            <summary>Mobile Differences</summary>
            <div class="mobile-help-body">
              <ul class="mobile-help-list">
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/TargetIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line"
                    >Desktop hotkeys-heavy flows are replaced by touch-first
                    interactions.</span
                  >
                </li>
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/DefensePostIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line">
                    Some desktop instruction sections are omitted here when they
                    don’t map directly to mobile behavior.
                  </span>
                </li>
                <li>
                  <span class="mobile-help-visual"
                    ><img src="/images/AllianceIconWhite.svg" alt=""
                  /></span>
                  <span class="mobile-help-line">
                    Mobile overlays prioritize readability, quick actions, and
                    minimal screen obstruction.
                  </span>
                </li>
              </ul>
            </div>
          </details>
        </div>
      </o-modal>
    `;
  }
}
