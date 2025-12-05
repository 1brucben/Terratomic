import { Execution, Player, UpgradeType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { RESEARCH_TECH_IDS } from "../tech/TechEffects";

export class ScorchedEarthExecution implements Execution {
  private mg: GameImpl;
  private _isActive = true;

  constructor(private player: Player) {}

  public static fromIntent(
    game: GameImpl,
    intent: {
      type: "activate_scorched_earth";
      clientID: string;
    },
  ): ScorchedEarthExecution {
    const player = game.playerByClientID(intent.clientID);
    if (!player) {
      throw new Error(`Player with clientID ${intent.clientID} not found`);
    }
    return new ScorchedEarthExecution(player);
  }

  public isActive(): boolean {
    return this._isActive;
  }

  public activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: GameImpl, ticks: number): void {
    this.mg = mg;

    // Already activated
    if (this.player.hasUpgrade(UpgradeType.ScorchedEarth)) {
      this._isActive = false;
      return;
    }

    // Must have researched Mechanized Warfare Doctrine to unlock Scorched Earth
    if (
      !this.player.hasResearchedTech(
        RESEARCH_TECH_IDS.MECHANIZED_WARFARE_DOCTRINE,
      )
    ) {
      this._isActive = false;
      return;
    }

    // Check gold cost
    const cost = this.mg.config().scorchedEarthActivationCost(this.player);
    if (this.player.gold() < cost) {
      this._isActive = false;
      return;
    }

    // Deduct gold and activate
    this.player.removeGold(cost);
    this.player.addUpgrade(UpgradeType.ScorchedEarth);

    // Destroy roads only (keep techs and upgrades)
    this.mg.destroyPlayerRoads(this.player);
    this.player.setRoadInvestmentRate(0);
    this.mg.markPlayerNodesForReconnection(this.player);

    this._isActive = false;
  }

  public tick(ticks: number): void {
    // Logic is in init()
  }
}
