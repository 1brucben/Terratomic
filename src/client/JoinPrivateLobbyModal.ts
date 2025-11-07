import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { translateText } from "../client/Utils";
import {
  ClientInfo,
  GameInfo,
  GameRecord,
  TeamCountConfig,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { PastelTheme } from "../core/configuration/PastelTheme";
import { ColoredTeams, Duos, GameMode, Quads, Trios } from "../core/game/Game";
import { JoinLobbyEvent } from "./Main";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
@customElement("join-private-lobby-modal")
export class JoinPrivateLobbyModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;
  @state() private message: string = "";
  @state() private hasJoined = false;
  @state() private clients: ClientInfo[] = [];
  @state() private playerTeamAssignments: Record<string, number | null> = {};
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;
  @state() private startingGold: number | null = null;

  private playersInterval: NodeJS.Timeout | null = null;
  private theme = new PastelTheme();

  private computeTeamCount(value: TeamCountConfig = this.teamCount): number {
    if (typeof value === "number") {
      return Math.max(2, value);
    }
    const playerCount = Math.max(this.clients.length, 1);
    switch (value) {
      case Duos:
        return Math.max(2, Math.ceil(playerCount / 2));
      case Trios:
        return Math.max(2, Math.ceil(playerCount / 3));
      case Quads:
        return Math.max(2, Math.ceil(playerCount / 4));
      default:
        return 2;
    }
  }

  private getTeamLabels(count: number): string[] {
    const colorLabels = [
      ColoredTeams.Red,
      ColoredTeams.Blue,
      ColoredTeams.Yellow,
      ColoredTeams.Green,
      ColoredTeams.Purple,
      ColoredTeams.Orange,
      ColoredTeams.Teal,
    ];
    if (count <= colorLabels.length) {
      return colorLabels.slice(0, count);
    }
    return Array.from({ length: count }, (_, index) => `Team ${index + 1}`);
  }

  render() {
    return html`
      <o-modal title=${translateText("private_lobby.title")}>
        <div class="lobby-id-box">
          <input
            type="text"
            id="lobbyIdInput"
            placeholder=${translateText("private_lobby.enter_id")}
            @keyup=${this.handleChange}
          />
          <button
            @click=${this.pasteFromClipboard}
            class="lobby-id-paste-button"
          >
            <svg
              class="lobby-id-paste-button-icon"
              stroke="currentColor"
              fill="currentColor"
              stroke-width="0"
              viewBox="0 0 32 32"
              height="18px"
              width="18px"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M 15 3 C 13.742188 3 12.847656 3.890625 12.40625 5 L 5 5 L 5 28 L 13 28 L 13 30 L 27 30 L 27 14 L 25 14 L 25 5 L 17.59375 5 C 17.152344 3.890625 16.257813 3 15 3 Z M 15 5 C 15.554688 5 16 5.445313 16 6 L 16 7 L 19 7 L 19 9 L 11 9 L 11 7 L 14 7 L 14 6 C 14 5.445313 14.445313 5 15 5 Z M 7 7 L 9 7 L 9 11 L 21 11 L 21 7 L 23 7 L 23 14 L 13 14 L 13 26 L 7 26 Z M 15 16 L 25 16 L 25 28 L 15 28 Z"
              ></path>
            </svg>
          </button>
        </div>
        <div class="message-area ${this.message ? "show" : ""}">
          ${this.message}
        </div>
        <div class="options-layout">
          ${this.hasJoined && this.clients.length > 0
            ? html` <div class="options-section">
                <div class="option-title">
                  ${this.clients.length}
                  ${this.clients.length === 1
                    ? translateText("private_lobby.player")
                    : translateText("private_lobby.players")}
                </div>
                <div class="team-columns-container">
                  ${this.renderTeamColumns()}
                </div>
              </div>`
            : ""}
        </div>
        <div class="flex justify-center">
          ${!this.hasJoined
            ? html` <o-button
                title=${translateText("private_lobby.join_lobby")}
                block
                @click=${this.joinLobby}
              ></o-button>`
            : ""}
        </div>
      </o-modal>
    `;
  }

  private renderPlayerCard(client: ClientInfo) {
    return html`
      <span class="player-tag">
        <span class="player-name">${client.username}</span>
      </span>
    `;
  }

  private renderTeamColumns() {
    if (this.gameMode !== GameMode.Team) {
      return html`
        <div class="players-list">
          ${repeat(
            this.clients,
            (client) => client.clientID,
            (client) => html`
              <span class="player-tag">
                <span class="player-name">${client.username}</span>
              </span>
            `,
          )}
        </div>
      `;
    }

    const teams = new Map<number | null, ClientInfo[]>();
    const teamLabels = this.getTeamLabels(this.computeTeamCount());

    // Initialize teams map
    for (let i = 0; i < teamLabels.length; i++) {
      teams.set(i, []);
    }
    teams.set(null, []); // For unassigned players
    teams.set(-1, []); // For spectators

    // Group clients by team
    for (const client of this.clients) {
      const teamIndex = this.playerTeamAssignments[client.clientID] ?? null;
      if (teams.has(teamIndex)) {
        teams.get(teamIndex)?.push(client);
      } else {
        teams.get(null)?.push(client);
      }
    }

    const unassignedPlayers = teams.get(null) ?? [];
    const spectators = teams.get(-1) ?? [];
    teams.delete(null);
    teams.delete(-1);

    const renderPlayerList = (players: ClientInfo[]) =>
      repeat(
        players,
        (client) => client.clientID,
        (client) => this.renderPlayerCard(client),
      );

    return html`
      <div class="teams-layout-container">
        <!-- Unassigned Players Section -->
        <div class="unassigned-column">
          <div class="team-column-header">
            ${translateText("host_modal.unassigned_players")}
          </div>
          <div class="unassigned-body">
            ${renderPlayerList(unassignedPlayers)}
          </div>
        </div>

        <!-- Assigned Teams Section -->
        <div class="team-columns">
          ${repeat(
            Array.from(teams.entries()),
            ([teamIndex]) => teamIndex,
            ([teamIndex, players]) => {
              const teamLabel =
                teamLabels[teamIndex as number] ?? `Team ${teamIndex}`;
              const teamColor = this.theme
                .teamColor(teamLabel)
                .alpha(0.1)
                .toRgbString();
              return html`
                <div class="team-column" style="background-color: ${teamColor}">
                  <div class="team-column-header">${teamLabel}</div>
                  <div class="team-column-body">
                    ${renderPlayerList(players)}
                  </div>
                </div>
              `;
            },
          )}
        </div>

        <!-- Spectators Section -->
        <div class="spectator-column">
          <div class="team-column-header">
            ${translateText("host_modal.spectator")}
          </div>
          <div class="unassigned-body">${renderPlayerList(spectators)}</div>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // light DOM
  }

  public open(id: string = "") {
    this.modalEl?.open();
    if (id) {
      this.setLobbyId(id);
      this.joinLobby();
    }
  }

  public close() {
    this.lobbyIdInput.value = "";
    this.modalEl?.close();
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
    this.startingGold = null;
  }

  public closeAndLeave() {
    this.close();
    this.hasJoined = false;
    this.message = "";
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.lobbyIdInput.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private extractLobbyIdFromUrl(input: string): string {
    if (input.startsWith("http")) {
      if (input.includes("#join=")) {
        const params = new URLSearchParams(input.split("#")[1]);
        return params.get("join") ?? input;
      } else if (input.includes("join/")) {
        return input.split("join/")[1];
      } else {
        return input;
      }
    } else {
      return input;
    }
  }

  private setLobbyId(id: string) {
    this.lobbyIdInput.value = this.extractLobbyIdFromUrl(id);
  }

  private handleChange(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim();
    this.setLobbyId(value);
  }

  private async pasteFromClipboard() {
    try {
      const clipText = await navigator.clipboard.readText();
      this.setLobbyId(clipText);
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
    }
  }

  private async joinLobby(): Promise<void> {
    const lobbyId = this.lobbyIdInput.value;
    console.log(`Joining lobby with ID: ${lobbyId}`);
    this.message = `${translateText("private_lobby.checking")}`;

    try {
      // First, check if the game exists in active lobbies
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      // If not active, check archived games
      const archivedGame = await this.checkArchivedGame(lobbyId);
      if (archivedGame) return;

      this.message = `${translateText("private_lobby.not_found")}`;
    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.message = `${translateText("private_lobby.error")}`;
    }
  }

  private async checkActiveLobby(lobbyId: string): Promise<boolean> {
    const config = await getServerConfigFromClient();
    const url = `/${config.workerPath(lobbyId)}/api/game/${lobbyId}/exists`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const gameInfo = await response.json();

    if (gameInfo.exists) {
      this.message = translateText("private_lobby.joined_waiting");
      this.hasJoined = true;

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      if (this.playersInterval) {
        clearInterval(this.playersInterval);
      }
      this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
      return true;
    }

    return false;
  }

  private async checkArchivedGame(lobbyId: string): Promise<boolean> {
    const config = await getServerConfigFromClient();
    const archiveUrl = `/${config.workerPath(lobbyId)}/api/archived_game/${lobbyId}`;

    const archiveResponse = await fetch(archiveUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const archiveData = await archiveResponse.json();

    if (
      archiveData.success === false &&
      archiveData.error === "Version mismatch"
    ) {
      console.warn(
        `Git commit hash mismatch for game ${lobbyId}`,
        archiveData.details,
      );
      this.message =
        "This game was created with a different version. Cannot join.";
      return true;
    }

    if (archiveData.exists) {
      const gameRecord = archiveData.gameRecord as GameRecord;

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            gameRecord: gameRecord,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      return true;
    }

    return false;
  }

  private async pollPlayers() {
    if (!this.lobbyIdInput?.value) return;
    const config = await getServerConfigFromClient();

    fetch(
      `/${config.workerPath(this.lobbyIdInput.value)}/api/game/${
        this.lobbyIdInput.value
      }`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
      .then((response) => response.json())
      .then((data: GameInfo) => {
        this.clients = data.clients ?? [];
        if (data.gameConfig) {
          this.playerTeamAssignments =
            data.gameConfig.playerTeamAssignments ?? {};
          this.gameMode = data.gameConfig.gameMode ?? GameMode.FFA;
          this.teamCount = data.gameConfig.playerTeams ?? 2;
          this.startingGold = data.gameConfig.startingGold ?? 0;
        }
      })
      .catch((error) => {
        console.error("Error polling players:", error);
      });
  }
}
