import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { PlayerType, UnitType } from "../core/game/Game";
import { GameView, PlayerView } from "../core/game/GameView";
import { getTechNodes, type Category } from "../core/tech/ResearchTree";
import "./components/baseComponents/Modal";

@customElement("statistics-modal")
export class StatisticsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    isModalOpen: boolean;
  };

  @state() private _tick = 0; // drives periodic re-render
  private _intervalId: any = null;

  public open() {
    this.updateComplete.then(() => {
      this.modalEl?.open();
      this._startAutoRefresh();
    });
  }

  private _startAutoRefresh() {
    if (this._intervalId) return;
    this._intervalId = setInterval(() => {
      if (!this.modalEl?.isModalOpen) {
        this._stopAutoRefresh();
        return;
      }
      this._tick++;
    }, 1000);
  }

  private _stopAutoRefresh() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  @state() private activeTab: "Overview" | "List" | "Graph" = "Overview";
  @property({ type: Object }) game: GameView | null = null;
  @state() private selectedPlayerId: string | null = null;

  private _playersForDropdown(): PlayerView[] {
    if (!this.game) return [];
    return this.game
      .players()
      .filter((p) =>
        [PlayerType.Human, PlayerType.FakeHuman].includes(
          p.type() as PlayerType,
        ),
      )
      .sort((a, b) => a.displayName().localeCompare(b.displayName()));
  }

  private _ensureSelection(): void {
    if (this.selectedPlayerId) return;
    const me = this.game?.myPlayer();
    if (
      me &&
      [PlayerType.Human, PlayerType.FakeHuman].includes(me.type() as PlayerType)
    ) {
      this.selectedPlayerId = me.id();
      return;
    }
    const first = this._playersForDropdown()[0];
    if (first) this.selectedPlayerId = first.id();
  }

  private _selectedPlayer(): PlayerView | null {
    if (!this.game || !this.selectedPlayerId) return null;
    return (
      this.game.players().find((p) => p.id() === this.selectedPlayerId) || null
    );
  }

  private _changeTab(tab: "Overview" | "List" | "Graph") {
    this.activeTab = tab;
  }

  private _renderTabs() {
    const tabs: Array<{ key: typeof this.activeTab; label: string }> = [
      { key: "Overview", label: "Overview" },
      { key: "List", label: "List" },
      { key: "Graph", label: "Graph" },
    ];
    return html`<div class="stats-tabs" role="tablist">
      ${tabs.map(
        (t) =>
          html`<button
            role="tab"
            aria-selected=${this.activeTab === t.key}
            class="stats-tab ${this.activeTab === t.key ? "active" : ""}"
            @click=${() => this._changeTab(t.key)}
          >
            ${t.label}
          </button>`,
      )}
    </div>`;
  }

  private _renderContent() {
    switch (this.activeTab) {
      case "Overview": {
        this._ensureSelection();
        const players = this._playersForDropdown();
        const sel = this._selectedPlayer();
        const economy = sel
          ? [
              ["Gold", sel.gold().toString()],
              [
                "Industrial Production",
                (sel as any).industrialProduction?.() ??
                  (sel as any).industrialProduction ??
                  "—",
              ],
              ["Population", sel.population().toString()],
              ["Workers", sel.workers().toString()],
              ["Troops", sel.troops().toString()],
              ["Productivity", (sel.productivity() * 100).toFixed(1) + "%"],
              [
                "Productivity Growth / min",
                (sel.productivityGrowthPerMinute() * 100).toFixed(1) + "%",
              ],
            ]
          : [];
        // Structures list and counting logic identical to PlayerInfoOverlay ordering & semantics
        const structureTypes: UnitType[] = [
          UnitType.City,
          UnitType.Hospital,
          UnitType.Academy,
          UnitType.ResearchLab,
          UnitType.Factory,
          UnitType.Port,
          UnitType.Warship,
          UnitType.MissileSilo,
          UnitType.SAMLauncher,
          UnitType.Airfield,
          UnitType.FighterJet,
          UnitType.DefensePost,
        ];
        const upgradeOwned: UnitType[] = [
          UnitType.City,
          UnitType.Hospital,
          UnitType.Academy,
          UnitType.ResearchLab,
          UnitType.Factory,
          UnitType.Port,
        ];
        const structures = sel
          ? structureTypes.map((t) => {
              const count = upgradeOwned.includes(t)
                ? sel.unitsOwned(t)
                : sel.units(t).length;
              return [String(t), count.toString()];
            })
          : [];
        const techsHighLevel: Array<[string, string]> = sel
          ? [
              [
                "Researched Techs",
                ((sel as any).data?.researchTreeTechs?.length ?? 0).toString(),
              ],
              ["Research Level", (sel as any).researchTechLevel?.() ?? "—"],
              ["Priority Tech", sel.researchPriorityTech() ?? "None"],
            ]
          : [];

        const categories: Category[] = [
          "Land",
          "Sea",
          "Air",
          "Nuclear",
          "Economy",
        ];
        const nodes = getTechNodes();
        const techsByCategory: Array<[string, string]> = sel
          ? categories.map((cat) => {
              const total = nodes.filter((n) => n.category === cat).length;
              let researched = 0;
              for (const n of nodes) {
                if (n.category === cat && sel.hasResearchedTech(n.id)) {
                  researched++;
                }
              }
              return [`${cat} Techs`, `${researched}/${total}`] as [
                string,
                string,
              ];
            })
          : [];
        return html`<div class="stats-section">
          <div class="player-select-row">
            <label class="player-select-label" for="stats-player-select"
              >Player:</label
            >
            <select
              id="stats-player-select"
              class="player-select"
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                this.selectedPlayerId = v || null;
              }}
            >
              ${players.map(
                (p) =>
                  html`<option
                    value=${p.id()}
                    ?selected=${p.id() === this.selectedPlayerId}
                  >
                    ${p.displayName()}
                  </option>`,
              )}
            </select>
          </div>
          <div class="stats-grid">
            <div class="stats-card">
              <h4 class="card-heading">Economy</h4>
              <ul class="kv-list">
                ${economy.map(
                  ([k, v]) =>
                    html`<li>
                      <span class="k">${k}</span><span class="v">${v}</span>
                    </li>`,
                )}
              </ul>
            </div>
            <div class="stats-card">
              <h4 class="card-heading">Structures</h4>
              <ul class="kv-list">
                ${structures.map(
                  ([k, v]) =>
                    html`<li>
                      <span class="k">${k}</span><span class="v">${v}</span>
                    </li>`,
                )}
              </ul>
            </div>
            <div class="stats-card">
              <h4 class="card-heading">Tech</h4>
              <ul class="kv-list">
                ${techsHighLevel.map(
                  ([k, v]) =>
                    html`<li>
                      <span class="k">${k}</span><span class="v">${v}</span>
                    </li>`,
                )}
              </ul>
              <ul class="kv-list kv-grid">
                ${techsByCategory.map(
                  ([k, v]) =>
                    html`<li>
                      <span class="k">${k}</span><span class="v">${v}</span>
                    </li>`,
                )}
              </ul>
            </div>
          </div>
        </div>`;
      }
      case "List":
        return html`<div class="stats-section">
          <h3 class="stats-heading">List</h3>
          <p class="stats-text">
            Per-player rows / sortable table placeholder.
          </p>
          <div class="stats-table-placeholder">
            <div class="placeholder-row header">
              <span>Player</span><span>Industrial Prod.</span
              ><span>Population</span>
            </div>
            ${[1, 2, 3].map(
              (i) =>
                html`<div class="placeholder-row">
                  <span>Player ${i}</span><span>—</span><span>—</span>
                </div>`,
            )}
          </div>
        </div>`;
      case "Graph":
        return html`<div class="stats-section">
          <h3 class="stats-heading">Graph</h3>
          <p class="stats-text">
            Time-series / trend visualization placeholder.
          </p>
          <div class="stats-graph-placeholder" aria-label="Graph placeholder">
            <div class="grid-lines">
              ${Array.from({ length: 6 }).map(
                () => html`<div class="h-line"></div>`,
              )}
            </div>
            <div class="graph-filler">(Graph Area)</div>
          </div>
        </div>`;
    }
  }

  render() {
    return html`
      <o-modal title="Statistics" max-width="1100px" max-height="70dvh">
        <style>
          statistics-modal .stats-tabs {
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
            flex-wrap: wrap;
          }
          statistics-modal .stats-tab {
            background: var(--ui-primary);
            border: 1px solid var(--ui-panel-border);
            color: var(--ui-text-accent);
            padding: 6px 14px;
            font-size: 12px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            letter-spacing: 0.5px;
            transition:
              background 0.15s,
              border-color 0.15s,
              box-shadow 0.15s;
          }
          statistics-modal .stats-tab:hover:not(.active) {
            background: var(--ui-secondary);
            border-color: var(--ui-secondary);
          }
          statistics-modal .stats-tab.active {
            background: var(--ui-secondary);
            border-color: var(--ui-secondary-hover);
            box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
          }
          statistics-modal .stats-section {
            display: flex;
            flex-direction: column;
            gap: 10px;
            font-size: 13px;
            color: var(--ui-text-default);
            /* Fix modal content height so tab switches don't resize the modal */
            height: 520px;
            /* Fix exact width to keep wrapper constant; account for modal max-width separately */
            width: 1024px;
            box-sizing: border-box;
          }
          statistics-modal .stats-heading {
            margin: 0;
            font-size: 15px;
            font-weight: 700;
            color: var(--ui-text-accent);
          }
          statistics-modal .player-select-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
          }
          statistics-modal .player-select-label {
            font-size: 12px;
            color: var(--ui-text-muted);
          }
          statistics-modal .player-select {
            background: var(--ui-primary);
            border: 1px solid var(--ui-panel-border);
            color: var(--ui-text-accent);
            padding: 4px 8px;
            font-size: 12px;
            border-radius: 4px;
          }
          statistics-modal .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(260px, 1fr));
            gap: 12px;
            margin-top: 8px;
          }
          statistics-modal .stats-card {
            background: var(--ui-primary);
            border: 1px solid var(--ui-panel-border);
            border-radius: 8px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.4);
          }
          statistics-modal .card-heading {
            margin: 0;
            font-size: 13px;
            font-weight: 600;
            color: var(--ui-text-accent);
            letter-spacing: 0.5px;
          }
          statistics-modal .kv-list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          statistics-modal .kv-list li {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
          }
          statistics-modal .kv-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            column-gap: 12px;
            row-gap: 4px;
          }
          statistics-modal .kv-grid li {
            display: flex;
            justify-content: space-between;
          }
          statistics-modal .kv-list .k {
            color: var(--ui-text-muted);
          }
          statistics-modal .kv-list .v {
            color: var(--ui-text-default);
            font-weight: 500;
          }
          statistics-modal .stats-text {
            margin: 0;
            font-size: 12px;
            color: var(--ui-text-muted);
          }
          statistics-modal .stats-list {
            list-style: disc;
            padding-left: 20px;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          statistics-modal .stats-table-placeholder {
            display: flex;
            flex-direction: column;
            border: 1px solid var(--ui-panel-border);
            border-radius: 6px;
            overflow: hidden;
            background: color-mix(in srgb, var(--ui-primary) 85%, transparent);
          }
          statistics-modal .placeholder-row {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            gap: 12px;
            padding: 6px 10px;
            font-size: 12px;
            align-items: center;
            border-bottom: 1px solid var(--ui-panel-border);
          }
          statistics-modal .placeholder-row:last-child {
            border-bottom: none;
          }
          statistics-modal .placeholder-row.header {
            background: var(--ui-secondary);
            font-weight: 600;
            color: var(--ui-text-accent);
          }
          statistics-modal .stats-graph-placeholder {
            position: relative;
            height: 240px;
            border: 1px solid var(--ui-panel-border);
            border-radius: 8px;
            background: linear-gradient(
              135deg,
              var(--ui-primary),
              var(--ui-secondary)
            );
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--ui-text-muted);
            font-size: 14px;
          }
          statistics-modal .stats-graph-placeholder .grid-lines {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            pointer-events: none;
          }
          statistics-modal .stats-graph-placeholder .h-line {
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            width: 100%;
          }
          statistics-modal .graph-filler {
            position: relative;
            z-index: 2;
          }
        </style>
        ${this._renderTabs()} ${this._renderContent()}<span style="display:none"
          >${this._tick}</span
        >
      </o-modal>
    `;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("modal-close", () => this._stopAutoRefresh());
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "statistics-modal": StatisticsModal;
  }
}
