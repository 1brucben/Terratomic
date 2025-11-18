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
  // List tab state
  @state() private _listRefreshTick = 0;
  @state() private _listSelectedStats: [
    string,
    string,
    string,
    string,
    string,
  ] = [
    "Industrial Production",
    "Population",
    "Productivity %",
    "Road Quality %",
    "Researched Techs",
  ];
  @state() private _listSortIndex: number | null = null; // 0..3
  @state() private _listSortDir: "asc" | "desc" = "desc";

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
    // Stop auto-refresh on List tab; resume elsewhere
    if (tab === "List") {
      this._stopAutoRefresh();
    } else if (!this._intervalId) {
      this._startAutoRefresh();
    }
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
          ? (() => {
              const gross = this.game?.config().grossGoldAdditionRate(sel) ?? 0;
              const prodRate = sel.investmentRate();
              const roadRate =
                (sel as any).roadInvestmentRate?.() ??
                sel.roadInvestmentRate?.() ??
                (sel as any).data?.roadInvestmentRate ??
                0;
              const researchRate =
                (sel as any).researchInvestmentRate?.() ??
                sel.researchInvestmentRate?.() ??
                (sel as any).data?.researchInvestmentRate ??
                0;
              const perSecond = 10; // engine ~10 ticks per second
              const prodAmt = gross * prodRate * perSecond;
              const roadAmt = gross * roadRate * perSecond;
              const researchAmt = gross * researchRate * perSecond;
              const roadQuality =
                sel.roadNetworkQuality?.() ??
                sel.roadNetworkQuality?.() ??
                (sel as any).roadNetworkQuality ??
                100;
              const roadCompletion =
                sel.roadNetworkCompletion?.() ??
                sel.roadNetworkCompletion?.() ??
                (sel as any).roadNetworkCompletion ??
                100;
              return [
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
                [
                  "Investment – Production",
                  `${(prodRate * 100).toFixed(0)}% (${prodAmt.toFixed(2)})`,
                ],
                [
                  "Investment – Roads",
                  `${(roadRate * 100).toFixed(0)}% (${roadAmt.toFixed(2)})`,
                ],
                [
                  "Investment – Research",
                  `${(researchRate * 100).toFixed(0)}% (${researchAmt.toFixed(2)})`,
                ],
                ["Road Quality", `${Math.round(roadQuality)}%`],
                ["Road Completion", `${Math.round(roadCompletion)}%`],
              ] as Array<[string, string]>;
            })()
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
      case "List": {
        const allPlayers = (this.game?.players?.() ?? []).filter((p) =>
          [PlayerType.Human, PlayerType.FakeHuman].includes(
            p.type() as PlayerType,
          ),
        );
        const opts = this._availableListStats();
        const rows = allPlayers.map((p) => {
          const values = this._listSelectedStats.map((key) =>
            this._computeStatValue(key, p),
          );
          return { player: p, values };
        });
        // Sorting
        const sorted = rows.slice();
        if (this._listSortIndex !== null) {
          const idx = this._listSortIndex;
          const dir = this._listSortDir;
          sorted.sort((a, b) => {
            // Special case: sort by player name when idx === -1
            if (idx === -1) {
              const an = a.player.displayName?.() ?? a.player.name?.() ?? "";
              const bn = b.player.displayName?.() ?? b.player.name?.() ?? "";
              const cmp = an.localeCompare(bn);
              return dir === "asc" ? cmp : -cmp;
            }
            const at = a.values[idx]?.sortText;
            const bt = b.values[idx]?.sortText;
            if (typeof at === "string" || typeof bt === "string") {
              const as = (at ?? "").toString().toLowerCase();
              const bs = (bt ?? "").toString().toLowerCase();
              const cmp = as.localeCompare(bs);
              return dir === "asc" ? cmp : -cmp;
            }
            const av = a.values[idx]?.sortValue ?? 0;
            const bv = b.values[idx]?.sortValue ?? 0;
            return dir === "asc" ? av - bv : bv - av;
          });
        }

        const headerCell = (label: string, i: number) => {
          const isActive = this._listSortIndex === i;
          const dir = isActive ? this._listSortDir : null;
          return html`<button
            class="list-th ${isActive ? "active" : ""}"
            @click=${() => this._toggleSort(i)}
            title="Sort by ${label}"
          >
            <span>${label}</span>
            <span class="sort-icons"
              ><span class="tri ${dir === "asc" ? "on" : ""}">▲</span
              ><span class="tri ${dir === "desc" ? "on" : ""}">▼</span></span
            >
          </button>`;
        };

        return html`<div class="stats-section">
          <div class="list-controls">
            ${[0, 1, 2, 3, 4].map((i) => {
              const current = this._listSelectedStats[i];
              return html`<label class="sel-group"
                >Col ${i + 1}
                <select
                  @change=${(e: Event) =>
                    this._updateListStat(
                      i,
                      (e.target as HTMLSelectElement).value,
                    )}
                >
                  ${opts.map(
                    (o) =>
                      html`<option value=${o} ?selected=${o === current}>
                        ${o}
                      </option>`,
                  )}
                </select>
              </label>`;
            })}
            <button class="btn" @click=${() => this._refreshList()}>
              Refresh
            </button>
          </div>
          <div class="list-table">
            <div class="list-header">
              <button
                class="list-th sticky ${this._listSortIndex === -1
                  ? "active"
                  : ""}"
                @click=${() => this._toggleSort(-1)}
                title="Sort by Player"
              >
                <span>Player</span>
                <span class="sort-icons"
                  ><span
                    class="tri ${this._listSortIndex === -1 &&
                    this._listSortDir === "asc"
                      ? "on"
                      : ""}"
                    >▲</span
                  ><span
                    class="tri ${this._listSortIndex === -1 &&
                    this._listSortDir === "desc"
                      ? "on"
                      : ""}"
                    >▼</span
                  ></span
                >
              </button>
              ${this._listSelectedStats.map((l, i) => headerCell(l, i))}
            </div>
            <div class="list-body">
              ${sorted.map(
                (r) =>
                  html`<div class="list-row">
                    <div class="list-td sticky">
                      ${r.player.displayName?.() ??
                      r.player.name?.() ??
                      "Player"}
                    </div>
                    ${r.values.map(
                      (v) =>
                        html`<div class="list-td">
                          <div class="primary">${v.displayPrimary}</div>
                          ${v.displaySecondary
                            ? html`<div class="secondary">
                                ${v.displaySecondary}
                              </div>`
                            : html``}
                        </div>`,
                    )}
                  </div>`,
              )}
            </div>
          </div>
        </div>`;
      }
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
          statistics-modal .list-controls {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
          }
          statistics-modal .list-controls .sel-group {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--ui-text-muted);
          }
          statistics-modal .list-controls select {
            background: var(--ui-primary);
            border: 1px solid var(--ui-panel-border);
            color: var(--ui-text-accent);
            padding: 4px 8px;
            font-size: 12px;
            border-radius: 4px;
          }
          statistics-modal .list-controls .btn {
            background: var(--ui-secondary);
            border: 1px solid var(--ui-panel-border);
            color: var(--ui-text-accent);
            padding: 6px 12px;
            font-size: 12px;
            border-radius: 6px;
            cursor: pointer;
          }
          statistics-modal .list-table {
            margin-top: 8px;
            border: 1px solid var(--ui-panel-border);
            border-radius: 6px;
            overflow: hidden;
          }
          statistics-modal .list-header,
          statistics-modal .list-row {
            display: grid;
            grid-template-columns: 1.1fr repeat(5, 1fr);
            gap: 6px;
            align-items: center;
          }
          statistics-modal .list-header {
            background: var(--ui-secondary);
            padding: 4px 6px;
            color: var(--ui-text-accent);
            border-bottom: 1px solid var(--ui-panel-border);
            font-weight: 600;
          }
          statistics-modal .list-th {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: transparent;
            border: none;
            color: inherit;
            cursor: pointer;
            font-weight: inherit;
          }
          statistics-modal .sort-icons {
            display: inline-flex;
            flex-direction: column;
            line-height: 10px;
          }
          statistics-modal .tri {
            opacity: 0.35;
            font-size: 10px;
          }
          statistics-modal .tri.on {
            opacity: 1;
          }
          statistics-modal .list-body {
            max-height: 360px;
            overflow: auto;
          }
          statistics-modal .list-row {
            padding: 4px 6px;
          }
          statistics-modal .list-row:nth-child(odd) {
            background: color-mix(in srgb, var(--ui-primary) 85%, transparent);
          }
          statistics-modal .list-td .primary {
            font-size: 12px;
          }
          statistics-modal .list-td .secondary {
            font-size: 11px;
            color: var(--ui-text-muted);
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
        ${this._renderTabs()}
        ${this._renderContent()}${this.activeTab === "List"
          ? html`<span style="display:none">${this._listRefreshTick}</span>`
          : html`<span style="display:none">${this._tick}</span>`}
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

  private _refreshList() {
    this._listRefreshTick++;
  }
  private _updateListStat(idx: number, value: string) {
    const next = [...this._listSelectedStats] as [
      string,
      string,
      string,
      string,
      string,
    ];
    next[idx] = value;
    this._listSelectedStats = next;
    this._refreshList();
  }
  private _toggleSort(idx: number) {
    if (this._listSortIndex !== idx) {
      this._listSortIndex = idx;
      this._listSortDir = "desc";
    } else {
      this._listSortDir = this._listSortDir === "desc" ? "asc" : "desc";
    }
    this._refreshList();
  }

  private _availableListStats(): string[] {
    return [
      "Gold",
      "Industrial Production",
      "Population",
      "Workers",
      "Troops",
      "Productivity %",
      "Productivity Growth %",
      "Investment – Production %",
      "Investment – Production Amount/s",
      "Investment – Roads %",
      "Investment – Roads Amount/s",
      "Investment – Research %",
      "Investment – Research Amount/s",
      "Road Quality %",
      "Road Completion %",
      // Structures (match PlayerInfoOverlay ordering)
      "City",
      "Hospital",
      "Academy",
      "Research Lab",
      "Factory",
      "Port",
      "Warship",
      "Missile Silo",
      "SAM Launcher",
      "Air Field",
      "Fighter Jet",
      "Defense Post",
      // Tech overview
      "Researched Techs",
      "Research Level",
      // Tech by category (researched/total; sort by researched)
      "Land Techs",
      "Sea Techs",
      "Air Techs",
      "Nuclear Techs",
      "Economy Techs",
    ];
  }

  private _computeStatValue(
    label: string,
    p: PlayerView,
  ): {
    sortValue: number;
    sortText?: string;
    displayPrimary: string;
    displaySecondary?: string;
  } {
    const gross = this.game?.config().grossGoldAdditionRate(p) ?? 0;
    const perSecond = 10;
    const inv = p.investmentRate?.() ?? (p as any).data?.investmentRate ?? 0;
    const roadRate =
      (p as any).roadInvestmentRate?.() ??
      p.roadInvestmentRate?.() ??
      (p as any).data?.roadInvestmentRate ??
      0;
    const researchRate =
      (p as any).researchInvestmentRate?.() ??
      p.researchInvestmentRate?.() ??
      (p as any).data?.researchInvestmentRate ??
      0;
    const prodAmt = gross * inv * perSecond;
    const roadAmt = gross * roadRate * perSecond;
    const researchAmt = gross * researchRate * perSecond;
    const ip =
      (p as any).industrialProduction?.() ??
      (p as any).industrialProduction ??
      (p as any).data?.industrialProduction ??
      0;
    switch (label) {
      case "Gold":
        return {
          sortValue: Number(p.gold?.() ?? 0),
          displayPrimary: String(p.gold?.() ?? 0),
        };
      case "Industrial Production":
        return { sortValue: Number(ip ?? 0), displayPrimary: String(ip ?? 0) };
      case "Population":
        return {
          sortValue: p.population(),
          displayPrimary: String(p.population()),
        };
      case "Workers":
        return { sortValue: p.workers(), displayPrimary: String(p.workers()) };
      case "Troops":
        return { sortValue: p.troops(), displayPrimary: String(p.troops()) };
      case "Productivity %": {
        const val = (p.productivity?.() ?? 0) * 100;
        return { sortValue: val, displayPrimary: `${val.toFixed(1)}%` };
      }
      case "Productivity Growth %": {
        const val = (p.productivityGrowthPerMinute?.() ?? 0) * 100;
        return { sortValue: val, displayPrimary: `${val.toFixed(1)}%` };
      }
      case "Investment – Production %": {
        const val = (inv ?? 0) * 100;
        return { sortValue: val, displayPrimary: `${val.toFixed(0)}%` };
      }
      case "Investment – Production Amount/s":
        return { sortValue: prodAmt, displayPrimary: prodAmt.toFixed(2) };
      case "Investment – Roads %": {
        const val = (roadRate ?? 0) * 100;
        return { sortValue: val, displayPrimary: `${val.toFixed(0)}%` };
      }
      case "Investment – Roads Amount/s":
        return { sortValue: roadAmt, displayPrimary: roadAmt.toFixed(2) };
      case "Investment – Research %": {
        const val = (researchRate ?? 0) * 100;
        return { sortValue: val, displayPrimary: `${val.toFixed(0)}%` };
      }
      case "Investment – Research Amount/s":
        return {
          sortValue: researchAmt,
          displayPrimary: researchAmt.toFixed(2),
        };
      case "Road Quality %": {
        const val = (p.roadNetworkQuality?.() ??
          (p as any).data?.roadNetworkQuality ??
          100) as number;
        return { sortValue: val, displayPrimary: `${Math.round(val)}%` };
      }
      case "Road Completion %": {
        const val = (p.roadNetworkCompletion?.() ??
          (p as any).data?.roadNetworkCompletion ??
          100) as number;
        return { sortValue: val, displayPrimary: `${Math.round(val)}%` };
      }
      // Structures (upgradeOwned use unitsOwned, others use units().length)
      case "City":
      case "Hospital":
      case "Academy":
      case "Research Lab":
      case "Factory":
      case "Port": {
        const map: Record<string, UnitType> = {
          City: UnitType.City,
          Hospital: UnitType.Hospital,
          Academy: UnitType.Academy,
          "Research Lab": UnitType.ResearchLab,
          Factory: UnitType.Factory,
          Port: UnitType.Port,
        };
        const t = map[label];
        const count = p.unitsOwned(t);
        return { sortValue: count, displayPrimary: String(count) };
      }
      case "Warship":
      case "Missile Silo":
      case "SAM Launcher":
      case "Air Field":
      case "Fighter Jet":
      case "Defense Post": {
        const map: Record<string, UnitType> = {
          Warship: UnitType.Warship,
          "Missile Silo": UnitType.MissileSilo,
          "SAM Launcher": UnitType.SAMLauncher,
          "Air Field": UnitType.Airfield,
          "Fighter Jet": UnitType.FighterJet,
          "Defense Post": UnitType.DefensePost,
        };
        const t = map[label];
        const count = p.units(t).length;
        return { sortValue: count, displayPrimary: String(count) };
      }
      // Tech overview
      case "Researched Techs": {
        const n = (p as any).data?.researchTreeTechs?.length ?? 0;
        return { sortValue: n, displayPrimary: String(n) };
      }
      case "Research Level": {
        const lvl = Number(p.researchTechLevel()) || 0;
        return { sortValue: lvl, displayPrimary: String(lvl) };
      }

      // Tech by category (researched/total; sort by researched)
      case "Land Techs":
      case "Sea Techs":
      case "Air Techs":
      case "Nuclear Techs":
      case "Economy Techs": {
        const labelToCat: Record<string, Category> = {
          "Land Techs": "Land",
          "Sea Techs": "Sea",
          "Air Techs": "Air",
          "Nuclear Techs": "Nuclear",
          "Economy Techs": "Economy",
        };
        const cat = labelToCat[label];
        const nodes = getTechNodes();
        const total = nodes.filter((n) => n.category === cat).length;
        let researched = 0;
        for (const n of nodes) {
          if (n.category === cat && p.hasResearchedTech(n.id)) researched++;
        }
        return {
          sortValue: researched,
          displayPrimary: `${researched}/${total}`,
        };
      }
    }
    return { sortValue: 0, displayPrimary: "—" };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "statistics-modal": StatisticsModal;
  }
}
