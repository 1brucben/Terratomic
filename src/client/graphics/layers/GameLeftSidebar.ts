import { Colord } from "colord";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMode } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { translateText } from "../../Utils";
import "../icons/LeaderboardRegularIcon";
import "../icons/LeaderboardSolidIcon";
import "../icons/TeamRegularIcon";
import "../icons/TeamSolidIcon";
import { Layer } from "./Layer";

@customElement("game-left-sidebar")
export class GameLeftSidebar extends LitElement implements Layer {
  @state()
  private isLeaderboardShow = false;
  @state()
  private isTeamLeaderboardShow = false;
  private isVisible = false;
  private isPlayerTeamLabelVisible = false;
  private playerTeam: string | null = null;

  private playerColor: Colord = new Colord("#FFFFFF");
  public game: GameView;
  private _shownOnInit = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    if (this.isTeamGame) {
      this.isPlayerTeamLabelVisible = true;
    }
    // Make it visible by default on large screens
    if (window.innerWidth >= 1024) {
      // lg breakpoint
      this._shownOnInit = true;
    }
    this.requestUpdate();
  }

  tick() {
    if (!this.isPlayerTeamLabelVisible) return;

    if (!this.playerTeam && this.game.myPlayer()?.team()) {
      this.playerTeam = this.game.myPlayer()!.team();
      if (this.playerTeam) {
        this.playerColor = this.game
          .config()
          .theme()
          .teamColor(this.playerTeam);
        this.requestUpdate();
      }
    }

    if (this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = false;
      this.isLeaderboardShow = true;
      this.requestUpdate();
    }

    if (!this.game.inSpawnPhase()) {
      this.isPlayerTeamLabelVisible = false;
      this.requestUpdate();
    }
  }

  private toggleLeaderboard(): void {
    this.isLeaderboardShow = !this.isLeaderboardShow;
  }

  private toggleTeamLeaderboard(): void {
    this.isTeamLeaderboardShow = !this.isTeamLeaderboardShow;
  }

  private get isTeamGame(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  private getTranslatedPlayerTeamLabel(): string {
    if (!this.playerTeam) return "";
    const translationKey = `team_colors.${this.playerTeam.toLowerCase()}`;
    const translated = translateText(translationKey);
    return translated === translationKey ? this.playerTeam : translated;
  }

  render() {
    return html`
      <aside
        class=${`submarine-panel fixed top-[50px] lg:top-[10px] left-0 z-[1000] flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 transition-transform duration-300 ease-out transform scale-[0.9] origin-top-left ${
          this.isVisible ? "translate-x-0" : "-translate-x-full"
        }`}
        style="box-shadow: inset 0 0 18px rgba(2, 8, 20, 0.8), 0 2px 6px rgba(0, 0, 0, 0.5);"
      >
        ${this.isPlayerTeamLabelVisible
          ? html`
              <div
                class="flex items-center w-full h-8 lg:h-10 text-white py-1 lg:p-2"
                @contextmenu=${(e: Event) => e.preventDefault()}
              >
                ${translateText("help_modal.ui_your_team")}
                <span style="color: ${this.playerColor.toRgbString()}">
                  ${this.getTranslatedPlayerTeamLabel()} &#10687;
                </span>
              </div>
            `
          : null}
        <div class="flex items-center gap-2 space-x-2 text-white mb-2">
          <div
            class="w-6 h-6 cursor-pointer"
            @click=${this.toggleLeaderboard}
            title=${this.isLeaderboardShow
              ? null
              : translateText("leaderboard.show")}
            aria-label=${this.isLeaderboardShow
              ? null
              : translateText("leaderboard.show")}
          >
            ${this.isLeaderboardShow
              ? html` <leaderboard-solid-icon></leaderboard-solid-icon>`
              : html` <leaderboard-regular-icon></leaderboard-regular-icon>`}
          </div>
          ${this.isTeamGame
            ? html`
                <div
                  class="w-6 h-6 cursor-pointer"
                  @click=${this.toggleTeamLeaderboard}
                >
                  ${this.isTeamLeaderboardShow
                    ? html` <team-solid-icon></team-solid-icon>`
                    : html` <team-regular-icon></team-regular-icon>`}
                </div>
              `
            : null}
        </div>
        <div class="block lg:flex flex-wrap gap-2">
          <leader-board .visible=${this.isLeaderboardShow}></leader-board>
          <team-stats
            class=${`flex-1 ${this.isTeamLeaderboardShow ? "sm:mt-4 lg:mt-12" : ""}`}
            .visible=${this.isTeamLeaderboardShow && this.isTeamGame}
          ></team-stats>
        </div>
        <slot></slot>
      </aside>
    `;
  }
}
