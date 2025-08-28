import { Execution, Player, UpgradeType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";

export class PurchaseUpgradeExecution implements Execution {
  private mg: GameImpl;
  private _isActive = true;

  constructor(
    private player: Player,
    private upgrade: UpgradeType,
  ) {}

  public static fromIntent(
    game: GameImpl,
    intent: {
      type: "purchase_upgrade";
      upgrade: UpgradeType;
      clientID: string;
    },
  ): PurchaseUpgradeExecution {
    const player = game.playerByClientID(intent.clientID);
    if (!player) {
      throw new Error(`Player with clientID ${intent.clientID} not found`);
    }
    return new PurchaseUpgradeExecution(player, intent.upgrade);
  }

  public isActive(): boolean {
    return this._isActive;
  }

  public activeDuringSpawnPhase(): boolean {
    return true;
  }

  public init(mg: GameImpl, ticks: number): void {
    this.mg = mg;
  }

  public tick(ticks: number): void {
    if (this.player.hasUpgrade(this.upgrade)) {
      this._isActive = false;
      return;
    }

    const cost = this.mg.config().upgradeInfo(this.upgrade).cost(this.player);
    if (this.player.gold() >= cost) {
      this.player.removeGold(cost);
      this.player.addUpgrade(this.upgrade);
      this._isActive = false;
    }
  }
}
