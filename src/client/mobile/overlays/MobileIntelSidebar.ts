/**
 * MobileIntelSidebar - Side panel with Players and Events tabs
 * Swipes in from left edge, shows leaderboard and event feed
 * Part of Phase 4: Diplomacy & Intel System
 */

import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameMode, Team } from "../../../core/game/Game";
import type { GameView, PlayerView } from "../../../core/game/GameView";
import { renderNumber } from "../../Utils";
import { HapticFeedback } from "../utils/HapticFeedback";
import type { MobileEventsDisplay } from "./MobileEventsDisplay";

export type IntelTab = "players" | "teams" | "events";

interface PlayerListEntry {
  player: PlayerView;
  population: number;
  gold: number;
  relation: string;
  rank: number;
  isCurrentPlayer: boolean;
}

interface TeamListEntry {
  teamName: string;
  ownedPercent: string;
  ownedSort: number;
  totalGold: string;
  totalTroops: string;
}

@customElement("mobile-intel-sidebar")
export class MobileIntelSidebar extends LitElement {
  @property({ type: Boolean, reflect: true }) visible: boolean = false;
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) eventsDisplay: MobileEventsDisplay | null = null;
  @state() private activeTab: IntelTab = "players";
  private leaderboardCacheTick: number | null = null;
  private leaderboardCache: {
    leaderboardEntries: PlayerListEntry[];
    pinnedCurrentPlayer: PlayerListEntry | null;
  } | null = null;

  static styles = css`
    :host {
      display: none;
      position: fixed;
      top: var(--m-panel-top-offset, 0px);
      right: 0;
      left: auto;
      bottom: 0;
      z-index: 3000;
      pointer-events: none;
      width: 70%;
      max-width: 400px;
    }

    :host([visible]) {
      display: block;
      pointer-events: all;
    }

    .backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.42);
      opacity: 0;
      transition: opacity 0.25s ease;
    }

    :host([visible]) .backdrop {
      opacity: 1;
    }

    .sidebar {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      background:
        linear-gradient(
          180deg,
          rgba(132, 142, 154, 0.14) 0%,
          rgba(76, 85, 97, 0.09) 36%,
          rgba(20, 24, 31, 0.04) 100%
        ),
        linear-gradient(
          180deg,
          rgba(35, 40, 49, 0.97) 0%,
          rgba(23, 28, 36, 0.98) 48%,
          rgba(14, 18, 24, 0.98) 100%
        );
      border-left: 1px solid rgba(174, 185, 198, 0.22);
      box-shadow:
        inset 1px 0 0 rgba(220, 229, 238, 0.12),
        -8px 0 24px rgba(0, 0, 0, 0.52);
      transform: translateX(100%);
      transition: transform 0.25s ease-out;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    :host([visible]) .sidebar {
      transform: translateX(0);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(161, 171, 184, 0.2);
      background: linear-gradient(
        180deg,
        rgba(16, 20, 28, 0.86) 0%,
        rgba(12, 16, 23, 0.92) 100%
      );
      box-shadow:
        inset 0 1px 0 rgba(232, 239, 247, 0.08),
        inset 0 -1px 0 rgba(0, 0, 0, 0.45);
    }

    .title {
      color: rgba(235, 241, 248, 0.95);
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.25px;
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
    }

    .close-btn {
      background: linear-gradient(
        180deg,
        rgba(18, 24, 33, 0.9) 0%,
        rgba(11, 15, 22, 0.94) 100%
      );
      border: 1px solid rgba(136, 146, 159, 0.28);
      border-radius: 6px;
      color: rgba(244, 176, 99, 0.95);
      font-size: 16px;
      cursor: pointer;
      min-width: 28px;
      min-height: 24px;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 1px 1px rgba(0, 0, 0, 0.35);
    }

    .close-btn:active {
      opacity: 0.9;
      transform: translateY(1px);
    }

    .tabs {
      display: flex;
      gap: 6px;
      padding: 8px 10px 7px;
      border-bottom: 1px solid rgba(146, 156, 169, 0.2);
      background: linear-gradient(
        180deg,
        rgba(14, 19, 26, 0.85) 0%,
        rgba(11, 15, 21, 0.9) 100%
      );
    }

    .tab {
      flex: 1;
      padding: 7px 6px;
      background: linear-gradient(
        180deg,
        rgba(17, 22, 30, 0.88) 0%,
        rgba(10, 14, 20, 0.9) 100%
      );
      border: 1px solid rgba(123, 133, 146, 0.28);
      border-radius: 8px;
      color: rgba(214, 222, 232, 0.72);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      position: relative;
      -webkit-tap-highlight-color: transparent;
      letter-spacing: 0.2px;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.05),
        inset 0 -2px 4px rgba(0, 0, 0, 0.35);
    }

    .tab.active {
      color: rgba(241, 246, 252, 0.98);
      border-color: rgba(92, 151, 238, 0.55);
      background: linear-gradient(
        180deg,
        rgba(28, 52, 86, 0.56) 0%,
        rgba(16, 27, 42, 0.9) 100%
      );
    }

    .tab.active::after {
      content: "";
      position: absolute;
      left: 8px;
      right: 8px;
      bottom: 2px;
      height: 1px;
      background: rgba(123, 187, 255, 0.9);
      box-shadow: 0 0 6px rgba(93, 164, 245, 0.45);
    }

    .tab:active {
      filter: brightness(1.08);
    }

    .content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px;
      background: linear-gradient(
        180deg,
        rgba(11, 15, 21, 0.66) 0%,
        rgba(9, 13, 18, 0.7) 100%
      );
    }

    /* Players tab styles */
    .player-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 8px;
      margin-bottom: 4px;
      background: linear-gradient(
        180deg,
        rgba(25, 31, 40, 0.82) 0%,
        rgba(14, 19, 25, 0.9) 100%
      );
      border: 1px solid rgba(124, 135, 149, 0.24);
      border-radius: 7px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }

    .player-row.current-player {
      border: 1px solid rgba(90, 152, 238, 0.55);
      background: linear-gradient(
        180deg,
        rgba(38, 67, 108, 0.45) 0%,
        rgba(15, 31, 51, 0.88) 100%
      );
      box-shadow:
        inset 0 1px 0 rgba(241, 246, 252, 0.08),
        0 0 0 1px rgba(25, 39, 58, 0.4);
    }

    .player-row:active {
      filter: brightness(1.08);
    }

    .player-rank {
      font-size: 14px;
      min-width: 26px;
      text-align: center;
      line-height: 1;
      color: rgba(231, 238, 246, 0.95);
    }

    .player-info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .player-name {
      color: rgba(238, 243, 250, 0.96);
      font-weight: 600;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .player-stats {
      color: rgba(192, 202, 214, 0.82);
      font-size: 11px;
      white-space: nowrap;
      margin-left: auto;
    }

    .player-relation {
      font-size: 14px;
      line-height: 1;
    }

    .self-divider {
      height: 1px;
      margin: 6px 2px;
      background: rgba(152, 162, 175, 0.26);
    }

    /* Teams tab styles */
    .team-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 8px;
      margin-bottom: 4px;
      background: linear-gradient(
        180deg,
        rgba(25, 31, 40, 0.82) 0%,
        rgba(14, 19, 25, 0.9) 100%
      );
      border: 1px solid rgba(124, 135, 149, 0.24);
      border-radius: 7px;
      -webkit-tap-highlight-color: transparent;
    }

    .team-rank {
      font-size: 14px;
      min-width: 26px;
      text-align: center;
      line-height: 1;
      color: rgba(231, 238, 246, 0.95);
    }

    .team-info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .team-name {
      color: rgba(238, 243, 250, 0.96);
      font-weight: 600;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .team-stats {
      color: rgba(192, 202, 214, 0.82);
      font-size: 11px;
      white-space: nowrap;
      margin-left: auto;
    }

    /* Events tab styles */
    .event-item {
      padding: 12px;
      margin-bottom: 8px;
      background: linear-gradient(
        180deg,
        rgba(23, 30, 39, 0.82) 0%,
        rgba(13, 18, 24, 0.92) 100%
      );
      border: 1px solid rgba(123, 133, 145, 0.24);
      border-radius: 8px;
      color: rgba(235, 240, 247, 0.96);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .event-time {
      color: rgba(189, 198, 210, 0.72);
      font-size: 12px;
      margin-bottom: 4px;
    }

    .event-message {
      font-size: 13px;
    }

    .events-content {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 100%;
    }

    .empty-state {
      text-align: center;
      color: rgba(186, 196, 208, 0.68);
      padding: 48px 16px;
      font-size: 14px;
    }

    /* Scrollbar styling */
    .content::-webkit-scrollbar {
      width: 8px;
    }

    .content::-webkit-scrollbar-track {
      background: rgba(20, 27, 36, 0.7);
    }

    .content::-webkit-scrollbar-thumb {
      background: rgba(132, 143, 157, 0.45);
      border-radius: 4px;
    }

    .content::-webkit-scrollbar-thumb:hover {
      background: rgba(150, 161, 174, 0.56);
    }

    /* Stacked layout for larger tablets - portrait mode */
    @media (min-height: 600px) and (max-aspect-ratio: 1 / 1) {
      .tabs {
        display: none;
      }

      .content {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .section-container {
        flex: 0 0 auto;
        min-height: 0;
      }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        color: rgba(235, 241, 248, 0.95);
        padding: 12px 8px 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid rgba(146, 156, 169, 0.2);
        margin-bottom: 8px;
      }

      .section-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
    }

    /* Stacked layout for larger tablets - landscape mode */
    @media (min-height: 500px) and (min-aspect-ratio: 1 / 1) and (min-width: 1000px) {
      .tabs {
        display: none;
      }

      .content {
        overflow-y: auto;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        padding: 16px;
      }

      .section-container {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .section-title {
        font-size: 13px;
        font-weight: 600;
        color: rgba(235, 241, 248, 0.95);
        padding: 8px 0 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid rgba(146, 156, 169, 0.2);
        margin-bottom: 8px;
      }

      .section-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
    }
  `;

  render() {
    if (!this.visible) return null;

    const isTeamMode = this.isTeamMode();
    if (this.activeTab === "teams" && !isTeamMode) {
      this.activeTab = "players";
    }

    const isStackedMode = this.shouldUseStackedLayout();

    return html`
      <div class="backdrop" @click="${this.handleBackdropClick}"></div>
      <div class="sidebar">
        <div class="header">
          <div class="title">Intel</div>
          <button class="close-btn" @click="${this.close}">✕</button>
        </div>
        <div class="tabs">
          <button
            class="tab ${this.activeTab === "players" ? "active" : ""}"
            @click="${() => this.switchTab("players")}"
          >
            Players
          </button>
          ${isTeamMode
            ? html`
                <button
                  class="tab ${this.activeTab === "teams" ? "active" : ""}"
                  @click="${() => this.switchTab("teams")}"
                >
                  Teams
                </button>
              `
            : null}
          <button
            class="tab ${this.activeTab === "events" ? "active" : ""}"
            @click="${() => this.switchTab("events")}"
          >
            Events
          </button>
        </div>
        <div class="content">
          ${isStackedMode
            ? this.renderStackedContent(isTeamMode)
            : this.activeTab === "players"
              ? this.renderPlayersTab()
              : this.activeTab === "teams"
                ? this.renderTeamsTab()
                : this.renderEventsTab()}
        </div>
      </div>
    `;
  }

  private renderStackedContent(isTeamMode: boolean) {
    return html`
      <div class="section-container">
        <div class="section-title">Players</div>
        <div class="section-content">${this.renderPlayersTab()}</div>
      </div>
      ${isTeamMode
        ? html`
            <div class="section-container">
              <div class="section-title">Teams</div>
              <div class="section-content">${this.renderTeamsTab()}</div>
            </div>
          `
        : null}
      <div class="section-container">
        <div class="section-title">Events</div>
        <div class="section-content">${this.renderEventsTab()}</div>
      </div>
    `;
  }

  private shouldUseStackedLayout(): boolean {
    // Portrait: min-height 600px
    // Landscape: min-width 1000px
    const minHeightPortrait =
      window.innerHeight >= 600 && window.innerWidth <= window.innerHeight;
    const minWidthLandscape =
      window.innerWidth >= 1000 && window.innerWidth > window.innerHeight;
    return minHeightPortrait || minWidthLandscape;
  }

  private renderPlayersTab() {
    if (!this.game) {
      // Show loading state while game data loads
      return html`<div class="empty-state">Loading...</div>`;
    }

    const { leaderboardEntries, pinnedCurrentPlayer } =
      this.getLeaderboardData();

    if (leaderboardEntries.length === 0) {
      return html`<div class="empty-state">No players found</div>`;
    }

    return html`
      ${leaderboardEntries.map((entry) => this.renderPlayerRow(entry))}
      ${pinnedCurrentPlayer
        ? html`
            <div class="self-divider"></div>
            ${this.renderPlayerRow(pinnedCurrentPlayer, true)}
          `
        : null}
    `;
  }

  private renderPlayerRow(entry: PlayerListEntry, pinnedSelf: boolean = false) {
    const rowClass = `player-row${entry.isCurrentPlayer ? " current-player" : ""}${pinnedSelf ? " pinned-self" : ""}`;

    const rankIcon =
      entry.rank === 1
        ? "🥇"
        : entry.rank === 2
          ? "🥈"
          : entry.rank === 3
            ? "🥉"
            : `${entry.rank}`;

    const relationIcon =
      entry.relation === "allied"
        ? "🤝"
        : entry.relation === "enemy"
          ? "⚔️"
          : "";

    return html`
      <div
        class="${rowClass}"
        @click="${() => this.handlePlayerClick(entry.player)}"
      >
        <div class="player-rank">${rankIcon}</div>
        <div class="player-info">
          <div class="player-name">${entry.player.name()}</div>
          <div class="player-stats">
            🏠 ${entry.population} · 💰 ${entry.gold}
          </div>
        </div>
        ${relationIcon
          ? html`<div class="player-relation">${relationIcon}</div>`
          : null}
      </div>
    `;
  }

  private renderEventsTab() {
    if (!this.eventsDisplay) {
      return html`
        <div class="empty-state">
          <div style="opacity: 0.6; margin-bottom: 16px;">⏳</div>
          Loading events...
        </div>
      `;
    }

    // Render the events display component
    return html`<div class="events-content">${this.eventsDisplay}</div>`;
  }

  private renderTeamsTab() {
    if (!this.game) {
      return html`<div class="empty-state">Loading...</div>`;
    }

    const teamEntries = this.getTeamLeaderboardData();
    if (teamEntries.length === 0) {
      return html`<div class="empty-state">No teams found</div>`;
    }

    return html`${teamEntries.map((entry, index) =>
      this.renderTeamRow(entry, index + 1),
    )}`;
  }

  private renderTeamRow(entry: TeamListEntry, rank: number) {
    const rankIcon =
      rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`;

    return html`
      <div class="team-row">
        <div class="team-rank">${rankIcon}</div>
        <div class="team-info">
          <div class="team-name">${entry.teamName}</div>
          <div class="team-stats">
            🏠 ${entry.ownedPercent} · 💰 ${entry.totalGold} · ⚔️
            ${entry.totalTroops}
          </div>
        </div>
      </div>
    `;
  }

  private getLeaderboardData(): {
    leaderboardEntries: PlayerListEntry[];
    pinnedCurrentPlayer: PlayerListEntry | null;
  } {
    if (!this.game) {
      return {
        leaderboardEntries: [],
        pinnedCurrentPlayer: null,
      };
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return {
        leaderboardEntries: [],
        pinnedCurrentPlayer: null,
      };
    }

    const tick = this.game.ticks();
    if (this.leaderboardCache && this.leaderboardCacheTick === tick) {
      return this.leaderboardCache;
    }

    const allPlayers = this.game.players();
    const rankedEntries = allPlayers
      .map((player, originalIndex) => {
        const population = player.numTilesOwned();
        const gold = Number(player.gold());

        let relation = "neutral";
        if (myPlayer.isAlliedWith(player)) {
          relation = "allied";
        } else if (myPlayer.isAtWarWith(player)) {
          relation = "enemy";
        }

        return {
          player,
          population,
          gold,
          relation,
          originalIndex,
        };
      })
      .sort((a, b) => {
        if (b.population !== a.population) {
          return b.population - a.population;
        }

        return a.originalIndex - b.originalIndex;
      })
      .map((entry, index) => ({
        ...entry,
        rank: index + 1,
        isCurrentPlayer: entry.player === myPlayer,
      }));

    if (rankedEntries.length === 0) {
      return {
        leaderboardEntries: [],
        pinnedCurrentPlayer: null,
      };
    }

    const leaderboardEntries = rankedEntries.slice(0, 10);

    const currentPlayerInLeaderboard = leaderboardEntries.some(
      (entry) => entry.isCurrentPlayer,
    );
    const pinnedCurrentPlayer = currentPlayerInLeaderboard
      ? null
      : (rankedEntries.find((entry) => entry.isCurrentPlayer) ?? null);

    const result = {
      leaderboardEntries,
      pinnedCurrentPlayer,
    };

    this.leaderboardCacheTick = tick;
    this.leaderboardCache = result;

    return result;
  }

  private getTeamLeaderboardData(): TeamListEntry[] {
    if (!this.game || !this.isTeamMode()) {
      return [];
    }

    const game = this.game;

    const players = game.playerViews();
    const grouped: Record<Team, PlayerView[]> = {};

    for (const player of players) {
      const team = player.team();
      if (team === null) continue;
      grouped[team] ??= [];
      grouped[team].push(player);
    }

    return Object.entries(grouped)
      .map(([teamName, teamPlayers]) => {
        let totalGold = 0n;
        let totalTroops = 0;
        let ownedSort = 0;

        for (const player of teamPlayers) {
          if (player.isAlive()) {
            totalTroops += player.troops();
            totalGold += player.gold();
            ownedSort += player.numTilesOwned();
          }
        }

        const ownedPercent = formatPercentage(ownedSort / game.numLandTiles());

        return {
          teamName,
          ownedPercent,
          ownedSort,
          totalGold: renderNumber(totalGold),
          totalTroops: renderNumber(totalTroops / 10),
        };
      })
      .sort((a, b) => {
        if (b.ownedSort !== a.ownedSort) {
          return b.ownedSort - a.ownedSort;
        }

        return a.teamName.localeCompare(b.teamName);
      });
  }

  private isTeamMode(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  private switchTab(tab: IntelTab): void {
    this.activeTab = tab;
    HapticFeedback.tap();
  }

  private handleBackdropClick(): void {
    this.close();
  }

  private handlePlayerClick(player: PlayerView): void {
    HapticFeedback.tap();
    // Emit event for player click - can open diplomacy actions
    this.dispatchEvent(
      new CustomEvent("player-selected", {
        detail: { player },
        bubbles: true,
        composed: true,
      }),
    );
  }

  open(): void {
    this.visible = true;
    HapticFeedback.tap();
  }

  close(): void {
    this.visible = false;
    this.dispatchEvent(
      new CustomEvent("sidebar-closed", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  toggle(): void {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }
}

function formatPercentage(value: number): string {
  const perc = value * 100;
  if (Number.isNaN(perc)) return "0%";
  return perc.toPrecision(2) + "%";
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-intel-sidebar": MobileIntelSidebar;
  }
}
