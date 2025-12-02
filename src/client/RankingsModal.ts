import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "./Utils";
import "./components/baseComponents/Modal";

interface PlayerRanking {
  persistentID: string;
  username: string;
  games: number;
  wins: number;
  score: number;
  lastGameAt: number;
}

interface ClanRanking {
  clanTag: string;
  members: number;
  games: number;
  wins: number;
  score: number;
  lastGameAt: number;
}

interface PlayerRankingsResponse {
  leaderboard: PlayerRanking[];
  totalPlayers: number;
}

interface ClanRankingsResponse {
  leaderboard: ClanRanking[];
  totalClans: number;
}

interface MonthlyWinner {
  month: string;
  players: PlayerRanking[];
  clans: ClanRanking[];
}

interface HallOfFameResponse {
  hallOfFame: MonthlyWinner[];
}

type TabType = "players" | "clans" | "hallOfFame";

@customElement("rankings-modal")
export class RankingsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private activeTab: TabType = "players";
  @state() private playerLeaderboard: PlayerRanking[] = [];
  @state() private clanLeaderboard: ClanRanking[] = [];
  @state() private hallOfFame: MonthlyWinner[] = [];
  @state() private totalPlayers: number = 0;
  @state() private totalClans: number = 0;
  @state() private loading: boolean = false;
  @state() private error: string | null = null;

  createRenderRoot() {
    return this;
  }

  async open() {
    this.modalEl.open();
    await this.fetchRankings();
  }

  close() {
    this.modalEl.close();
  }

  private async fetchRankings() {
    this.loading = true;
    this.error = null;

    try {
      if (this.activeTab === "players") {
        const response = await fetch("/api/rankings?limit=100");
        if (!response.ok) {
          throw new Error(`Failed to fetch rankings: ${response.status}`);
        }
        const data: PlayerRankingsResponse = await response.json();
        this.playerLeaderboard = data.leaderboard;
        this.totalPlayers = data.totalPlayers;
      } else if (this.activeTab === "clans") {
        const response = await fetch("/api/rankings/clans?limit=100");
        if (!response.ok) {
          throw new Error(`Failed to fetch clan rankings: ${response.status}`);
        }
        const data: ClanRankingsResponse = await response.json();
        this.clanLeaderboard = data.leaderboard;
        this.totalClans = data.totalClans;
      } else {
        const response = await fetch("/api/rankings/hall-of-fame");
        if (!response.ok) {
          throw new Error(`Failed to fetch hall of fame: ${response.status}`);
        }
        const data: HallOfFameResponse = await response.json();
        this.hallOfFame = data.hallOfFame;
      }
    } catch (err) {
      this.error =
        err instanceof Error ? err.message : "Failed to load rankings";
      console.error("Error fetching rankings:", err);
    } finally {
      this.loading = false;
    }
  }

  private async switchTab(tab: TabType) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    await this.fetchRankings();
  }

  private formatWinRate(games: number, wins: number): string {
    if (games === 0) return "0%";
    return `${Math.round((wins / games) * 100)}%`;
  }

  private renderTabs() {
    return html`
      <div class="flex w-full mb-4 border-b border-gray-600">
        <button
          class="flex-1 py-2 px-4 text-center font-medium transition-colors ${this
            .activeTab === "players"
            ? "border-b-2 border-blue-500 text-blue-500"
            : "text-gray-400 hover:text-gray-200"}"
          @click=${() => this.switchTab("players")}
        >
          👤 ${translateText("rankings.players_tab")}
        </button>
        <button
          class="flex-1 py-2 px-4 text-center font-medium transition-colors ${this
            .activeTab === "clans"
            ? "border-b-2 border-blue-500 text-blue-500"
            : "text-gray-400 hover:text-gray-200"}"
          @click=${() => this.switchTab("clans")}
        >
          🏰 ${translateText("rankings.clans_tab")}
        </button>
        <button
          class="flex-1 py-2 px-4 text-center font-medium transition-colors ${this
            .activeTab === "hallOfFame"
            ? "border-b-2 border-blue-500 text-blue-500"
            : "text-gray-400 hover:text-gray-200"}"
          @click=${() => this.switchTab("hallOfFame")}
        >
          🏆 ${translateText("rankings.hall_of_fame_tab")}
        </button>
      </div>
    `;
  }

  private renderPlayerLeaderboard() {
    if (this.playerLeaderboard.length === 0) {
      return html`
        <div class="text-center py-8 text-gray-500">
          ${translateText("rankings.no_rankings")}
        </div>
      `;
    }

    return html`
      <div class="w-full overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-[var(--ui-bg-primary)]">
            <tr class="border-b border-gray-600">
              <th class="py-2 px-2 text-left">#</th>
              <th class="py-2 px-2 text-left">
                ${translateText("rankings.player")}
              </th>
              <th class="py-2 px-2 text-center">
                ${translateText("rankings.games")}
              </th>
              <th class="py-2 px-2 text-center">
                ${translateText("rankings.wins")}
              </th>
              <th class="py-2 px-2 text-center">
                ${translateText("rankings.win_rate")}
              </th>
              <th class="py-2 px-2 text-right">
                ${translateText("rankings.score")}
              </th>
            </tr>
          </thead>
          <tbody>
            ${this.playerLeaderboard.map(
              (player, index) => html`
                <tr
                  class="border-b border-gray-700 hover:bg-[var(--ui-bg-secondary)]"
                >
                  <td class="py-2 px-2">
                    ${index < 3
                      ? html`<span class="text-lg"
                          >${index === 0
                            ? "🥇"
                            : index === 1
                              ? "🥈"
                              : "🥉"}</span
                        >`
                      : html`<span class="text-gray-400">${index + 1}</span>`}
                  </td>
                  <td class="py-2 px-2 font-medium truncate max-w-[150px]">
                    ${player.username}
                  </td>
                  <td class="py-2 px-2 text-center">${player.games}</td>
                  <td class="py-2 px-2 text-center">${player.wins}</td>
                  <td class="py-2 px-2 text-center">
                    ${this.formatWinRate(player.games, player.wins)}
                  </td>
                  <td class="py-2 px-2 text-right font-bold">
                    ${player.score.toLocaleString()}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
      <div class="mt-4 text-sm text-gray-400">
        ${translateText("rankings.total_players")}: ${this.totalPlayers}
      </div>
    `;
  }

  private renderClanLeaderboard() {
    if (this.clanLeaderboard.length === 0) {
      return html`
        <div class="text-center py-8 text-gray-500">
          ${translateText("rankings.no_clans")}
        </div>
      `;
    }

    return html`
      <div class="w-full overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-[var(--ui-bg-primary)]">
            <tr class="border-b border-gray-600">
              <th class="py-2 px-2 text-left">#</th>
              <th class="py-2 px-2 text-left">
                ${translateText("rankings.clan")}
              </th>
              <th class="py-2 px-2 text-center">
                ${translateText("rankings.members")}
              </th>
              <th class="py-2 px-2 text-center">
                ${translateText("rankings.games")}
              </th>
              <th class="py-2 px-2 text-center">
                ${translateText("rankings.wins")}
              </th>
              <th class="py-2 px-2 text-center">
                ${translateText("rankings.win_rate")}
              </th>
              <th class="py-2 px-2 text-right">
                ${translateText("rankings.score")}
              </th>
            </tr>
          </thead>
          <tbody>
            ${this.clanLeaderboard.map(
              (clan, index) => html`
                <tr
                  class="border-b border-gray-700 hover:bg-[var(--ui-bg-secondary)]"
                >
                  <td class="py-2 px-2">
                    ${index < 3
                      ? html`<span class="text-lg"
                          >${index === 0
                            ? "🥇"
                            : index === 1
                              ? "🥈"
                              : "🥉"}</span
                        >`
                      : html`<span class="text-gray-400">${index + 1}</span>`}
                  </td>
                  <td class="py-2 px-2 font-medium">[${clan.clanTag}]</td>
                  <td class="py-2 px-2 text-center">${clan.members}</td>
                  <td class="py-2 px-2 text-center">${clan.games}</td>
                  <td class="py-2 px-2 text-center">${clan.wins}</td>
                  <td class="py-2 px-2 text-center">
                    ${this.formatWinRate(clan.games, clan.wins)}
                  </td>
                  <td class="py-2 px-2 text-right font-bold">
                    ${clan.score.toLocaleString()}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
      <div class="mt-4 text-sm text-gray-400">
        ${translateText("rankings.total_clans")}: ${this.totalClans}
      </div>
    `;
  }

  private formatMonthName(month: string): string {
    const [year, monthNum] = month.split("-");
    const date = new Date(parseInt(year), parseInt(monthNum) - 1, 1);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
    });
  }

  private renderHallOfFame() {
    if (this.hallOfFame.length === 0) {
      return html`
        <div class="text-center py-8 text-gray-500">
          ${translateText("rankings.no_hall_of_fame")}
        </div>
      `;
    }

    // Show most recent months first
    const sortedHallOfFame = [...this.hallOfFame].reverse();

    return html`
      <div class="w-full overflow-y-auto space-y-6">
        ${sortedHallOfFame.map(
          (entry) => html`
            <div class="border border-gray-600 rounded-lg p-4">
              <h3 class="text-lg font-bold mb-3 text-center">
                📅 ${this.formatMonthName(entry.month)}
              </h3>

              ${entry.players.length > 0
                ? html`
                    <div class="mb-4">
                      <h4 class="text-sm font-medium text-gray-400 mb-2">
                        ${translateText("rankings.top_players")}
                      </h4>
                      <div class="space-y-1">
                        ${entry.players.slice(0, 3).map(
                          (player, index) => html`
                            <div class="flex justify-between items-center py-1">
                              <span>
                                ${index === 0
                                  ? "🥇"
                                  : index === 1
                                    ? "🥈"
                                    : "🥉"}
                                ${player.username}
                              </span>
                              <span class="text-gray-400">
                                ${player.wins}W / ${player.games}G
                              </span>
                            </div>
                          `,
                        )}
                      </div>
                    </div>
                  `
                : ""}
              ${entry.clans.length > 0
                ? html`
                    <div>
                      <h4 class="text-sm font-medium text-gray-400 mb-2">
                        ${translateText("rankings.top_clans")}
                      </h4>
                      <div class="space-y-1">
                        ${entry.clans.slice(0, 3).map(
                          (clan, index) => html`
                            <div class="flex justify-between items-center py-1">
                              <span>
                                ${index === 0
                                  ? "🥇"
                                  : index === 1
                                    ? "🥈"
                                    : "🥉"}
                                [${clan.clanTag}]
                              </span>
                              <span class="text-gray-400">
                                ${clan.wins}W / ${clan.games}G
                              </span>
                            </div>
                          `,
                        )}
                      </div>
                    </div>
                  `
                : ""}
            </div>
          `,
        )}
      </div>
    `;
  }

  render() {
    return html`
      <o-modal
        id="rankingsModal"
        title="Rankings"
        translationKey="rankings.title"
      >
        <div class="flex flex-col items-center w-full max-h-[70vh]">
          <div class="text-center text-2xl font-bold mb-4">
            🏆 ${translateText("rankings.leaderboard")}
          </div>

          ${this.renderTabs()}
          ${this.loading
            ? html`
                <div class="flex items-center justify-center py-8">
                  <div class="text-lg">
                    ${translateText("rankings.loading")}
                  </div>
                </div>
              `
            : this.error
              ? html`
                  <div class="flex flex-col items-center justify-center py-8">
                    <div class="text-red-500 mb-4">${this.error}</div>
                    <button
                      class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                      @click=${this.fetchRankings}
                    >
                      ${translateText("rankings.retry")}
                    </button>
                  </div>
                `
              : this.activeTab === "players"
                ? this.renderPlayerLeaderboard()
                : this.activeTab === "clans"
                  ? this.renderClanLeaderboard()
                  : this.renderHallOfFame()}
        </div>
      </o-modal>
    `;
  }
}
