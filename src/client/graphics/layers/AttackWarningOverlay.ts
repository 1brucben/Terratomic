import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

@customElement("attack-warning-overlay")
export class AttackWarningOverlay extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private isUnderAttack = false;

  private attackCheckInterval: number | null = null;
  private glowTimeout: number | null = null;

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
      animation: pulse 2s ease-in-out infinite;
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
  `;

  init() {}

  tick() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this.isUnderAttack) {
        this.isUnderAttack = false;
        this.requestUpdate();
      }
      return;
    }

    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    // Only consider attacks from human or fakehuman players
    const incomingAttacks = myPlayer.incomingAttacks().filter((attack) => {
      const attacker = this.game.playerBySmallID(attack.attackerID);
      // Only consider if attacker is a PlayerView (not TerraNullius)
      if (
        typeof attacker === "object" &&
        "type" in attacker &&
        typeof attacker.type === "function"
      ) {
        const t = attacker.type();
        return t === "HUMAN" || t === "FAKEHUMAN";
      }
      return false;
    });

    if (incomingAttacks.length > 0 && !this.isUnderAttack) {
      this.triggerAttackWarning();
    } else if (incomingAttacks.length === 0 && this.isUnderAttack) {
      this.clearAttackWarning();
    }
  }

  private triggerAttackWarning() {
    this.isUnderAttack = true;
    this.requestUpdate();

    // Clear any existing timeout
    if (this.glowTimeout !== null) {
      clearTimeout(this.glowTimeout);
    }

    // Keep the glow active for 5 seconds
    this.glowTimeout = window.setTimeout(() => {
      this.clearAttackWarning();
    }, 5000);
  }

  private clearAttackWarning() {
    this.isUnderAttack = false;
    this.requestUpdate();

    if (this.glowTimeout !== null) {
      clearTimeout(this.glowTimeout);
      this.glowTimeout = null;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.attackCheckInterval !== null) {
      clearInterval(this.attackCheckInterval);
    }
    if (this.glowTimeout !== null) {
      clearTimeout(this.glowTimeout);
    }
  }

  render() {
    return html`
      <div class="attack-glow ${this.isUnderAttack ? "active" : ""}"></div>
    `;
  }

  renderLayer(): void {}

  shouldTransform(): boolean {
    return false;
  }
}
