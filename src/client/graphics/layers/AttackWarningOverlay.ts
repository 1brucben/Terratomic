import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerType, nukeTypes } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

@customElement("attack-warning-overlay")
export class AttackWarningOverlay extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private isUnderAttack = false;
  @state()
  private isNukeAttack = false;

  private incomingNukeIDs = new Set<number>();

  static styles = css`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 40;
    }

    .attack-glow {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      box-shadow: inset 0 0 20px 8px rgba(255, 230, 40, 0.75);
      transition: opacity 0.3s ease-in-out;
    }

    .attack-glow.active {
      opacity: 1;
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    .attack-glow.nuke {
      box-shadow: inset 0 0 20px 8px rgba(255, 0, 0, 0.75);
      animation: nuke-pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      opacity: 1 !important;
    }

    @keyframes pulse {
      0%,
      100% {
        box-shadow: inset 0 0 20px 8px rgba(255, 230, 40, 0.75);
      }
      50% {
        box-shadow: inset 0 0 20px 8px rgba(255, 255, 120, 0.95);
      }
    }

    @keyframes nuke-pulse {
      0%,
      100% {
        box-shadow: inset 0 0 20px 8px rgba(255, 0, 0, 0.75);
      }
      50% {
        box-shadow: inset 0 0 20px 8px rgba(255, 100, 100, 0.95);
      }
    }
  `;

  init() {}

  tick() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this.isUnderAttack || this.isNukeAttack) {
        this.isUnderAttack = false;
        this.isNukeAttack = false;
        this.requestUpdate();
      }
      return;
    }

    // Only consider attacks from human or fakehuman players (not bots)
    const incomingAttacks = myPlayer.incomingAttacks().filter((attack) => {
      const attacker = this.game.playerBySmallID(attack.attackerID);
      if (
        typeof attacker === "object" &&
        "type" in attacker &&
        typeof attacker.type === "function"
      ) {
        const t = attacker.type();
        return t !== PlayerType.Bot;
      }
      return false;
    });

    // Check for new incoming nuke events from game updates
    const updates = this.game.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.UnitIncoming]) {
      updates[GameUpdateType.UnitIncoming].forEach((update) => {
        if (update.playerID === myPlayer.smallID()) {
          const unit = this.game.unit(update.unitID);
          if (unit && nukeTypes.includes(unit.type())) {
            this.incomingNukeIDs.add(update.unitID);
          }
        }
      });
    }

    // Prune nuke IDs that are no longer valid (exploded or destroyed)
    for (const id of this.incomingNukeIDs) {
      if (!this.game.unit(id)) {
        this.incomingNukeIDs.delete(id);
      }
    }

    const hasIncomingNuke = this.incomingNukeIDs.size > 0;

    if (hasIncomingNuke) {
      if (!this.isNukeAttack) {
        this.isNukeAttack = true;
        this.isUnderAttack = false; // Nuke takes precedence
        this.requestUpdate();
      }
    } else if (this.isNukeAttack) {
      this.isNukeAttack = false;
      this.requestUpdate();
    }

    if (!hasIncomingNuke) {
      if (incomingAttacks.length > 0) {
        if (!this.isUnderAttack) {
          this.isUnderAttack = true;
          this.requestUpdate();
        }
      } else if (this.isUnderAttack) {
        this.isUnderAttack = false;
        this.requestUpdate();
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  render() {
    return html`
      <div
        class="attack-glow ${this.isUnderAttack ? "active" : ""} ${this
          .isNukeAttack
          ? "active nuke"
          : ""}"
      ></div>
    `;
  }

  renderLayer(): void {}

  shouldTransform(): boolean {
    return false;
  }
}
