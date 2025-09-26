import { Config } from "../configuration/Config";
import { Execution, Game, Player, UnitType } from "../game/Game";

export class PlayerExecution implements Execution {
  private config: Config;
  private mg: Game;
  private active = true;

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.config = mg.config();
  }

  tick(ticks: number) {
    this.player.decayRelations();
    this.player.units().forEach((u) => {
      const tileOwner = this.mg!.owner(u.tile());
      if (u.info().territoryBound) {
        if (tileOwner.isPlayer()) {
          if (tileOwner !== this.player) {
            this.mg!.player(tileOwner.id()).captureUnit(u);
          }
        } else {
          u.delete();
        }
      }
    });

    if (!this.player.isAlive()) {
      // Player has no tiles, delete any remaining units
      this.player.units().forEach((u) => {
        if (
          u.type() !== UnitType.AtomBomb &&
          u.type() !== UnitType.HydrogenBomb &&
          u.type() !== UnitType.MIRVWarhead &&
          u.type() !== UnitType.MIRV
        ) {
          u.delete();
        }
      });
      this.active = false;
      return;
    }

    const popInc =
      this.config.populationIncreaseRate(this.player) +
      this.player.hospitalReturns();
    this.player.resetHospitalReturns();
    this.player.addWorkers(popInc * (1 - this.player.targetTroopRatio()));
    this.player.addTroops(popInc * this.player.targetTroopRatio());
    const goldFromWorkers = this.config.goldAdditionRate(this.player);
    this.player.addGold(goldFromWorkers);
    this.player.updateProductivity();
    // Record stats
    this.mg.stats().goldWork(this.player, goldFromWorkers);

    const adjustRate = this.config.troopAdjustmentRate(this.player);
    this.player.addTroops(adjustRate);
    this.player.removeWorkers(adjustRate);

    const alliances = Array.from(this.player.alliances());
    for (const alliance of alliances) {
      if (
        this.mg.ticks() - alliance.createdAt() >
        this.mg.config().allianceDuration()
      ) {
        alliance.expire();
      }
    }

    const embargoes = this.player.getEmbargoes();
    for (const embargo of embargoes) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    // Regenerate health of damaged buildings
    this.player.units().forEach((u) => {
      if (u.hasHealth() && u.health() < (u.info().maxHealth ?? 0)) {
        u.modifyHealth(0.5);
      }
    });
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }
}
