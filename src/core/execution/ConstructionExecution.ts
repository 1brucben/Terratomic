import {
  aggregateStructureBuildCost,
  computeBomberUpgradeCost,
} from "../game/Costs";
import {
  Execution,
  Game,
  Gold,
  Player,
  PlayerType,
  Tick,
  Unit,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  isUpgradeableUnit,
  playerMaxStructureLevel,
  playerMaxUnitLevel,
} from "../game/Upgradeables";
import { constructionSpeedModifiers } from "../tech/TechEffects";
import { AirfieldExecution } from "./AirfieldExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { FighterJetExecution } from "./FighterJetExecution";
import { MirvExecution } from "./MIRVExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { NukeExecution } from "./NukeExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";
import { SubmarineExecution } from "./SubmarineExecution";
import { WarshipExecution } from "./WarshipExecution";

export class ConstructionExecution implements Execution {
  private construction: Unit | null = null;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  private reservedTotalCost: Gold = 0n;
  private baseCost: Gold = 0n;
  private desiredLevel: number = 1;

  constructor(
    private player: Player,
    private constructionType: UnitType,
    private tile: TileRef,
    private targetLevel?: number,
    private bomberLevel?: number, // Bomber upgrade level for airfields
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (this.mg.config().isUnitDisabled(this.constructionType)) {
      console.warn(
        `cannot build construction ${this.constructionType} because it is disabled`,
      );
      this.active = false;
      return;
    }

    if (!this.mg.isValidRef(this.tile)) {
      console.warn(`cannot build construction invalid tile ${this.tile}`);
      this.active = false;
      return;
    }
  }

  tick(ticks: number): void {
    if (this.construction === null) {
      const info = this.mg.unitInfo(this.constructionType);
      if (info.constructionDuration === undefined) {
        // No construction phase; treat as instant build path
        // Compute and reserve total aggregated cost first
        this.baseCost = this.mg
          .unitInfo(this.constructionType)
          .cost(this.player);
        this.desiredLevel = this.computeDesiredLevel(
          this.constructionType,
          this.targetLevel,
        );
        // Validate build feasibility BEFORE charging any gold
        const canSpawnInstant = this.player.canBuild(
          this.constructionType,
          this.tile,
        );
        if (canSpawnInstant === false) {
          console.warn(`cannot build ${this.constructionType}`);
          this.active = false;
          return;
        }
        const total =
          aggregateStructureBuildCost(
            this.mg,
            this.player,
            this.constructionType,
            this.desiredLevel,
            // For upgradeable units, aggregateStructureBuildCost ignores multiplier
            this.mg
              .config()
              .structureUpgradeCostMultiplier(this.constructionType),
          ) +
          (this.constructionType === UnitType.Airfield
            ? computeBomberUpgradeCost(
                this.mg,
                this.player,
                this.bomberLevel ?? 1,
                this.desiredLevel,
              )
            : 0n);
        if (this.player.gold() < total) {
          console.warn(
            `cannot afford construction ${this.constructionType} at level ${this.desiredLevel}`,
          );
          this.active = false;
          return;
        }
        this.player.removeGold(total);
        // Refund base before constructing final unit (buildUnit deducts base)
        if (this.baseCost > 0n) {
          this.player.addGold(this.baseCost);
        }
        // Immediately complete construction logic
        this.completeConstruction();
        this.active = false;
        return;
      }
      // Timed construction path: compute and reserve aggregate cost upfront
      this.baseCost = this.mg.unitInfo(this.constructionType).cost(this.player);
      this.desiredLevel = this.computeDesiredLevel(
        this.constructionType,
        this.targetLevel,
      );
      const totalCost =
        aggregateStructureBuildCost(
          this.mg,
          this.player,
          this.constructionType,
          this.desiredLevel,
          // For upgradeable units, aggregateStructureBuildCost ignores multiplier
          this.mg
            .config()
            .structureUpgradeCostMultiplier(this.constructionType),
        ) +
        (this.constructionType === UnitType.Airfield
          ? computeBomberUpgradeCost(
              this.mg,
              this.player,
              this.bomberLevel ?? 1,
              this.desiredLevel,
            )
          : 0n);
      if (this.player.gold() < totalCost) {
        console.warn(
          `cannot afford construction ${this.constructionType} at level ${this.desiredLevel}`,
        );
        this.active = false;
        return;
      }
      this.reservedTotalCost = totalCost;
      const spawnTile = this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile === false) {
        console.warn(`cannot build ${this.constructionType}`);
        this.active = false;
        return;
      }
      this.construction = this.player.buildUnit(
        UnitType.Construction,
        spawnTile,
        {},
      );
      // Reserve total aggregated cost upfront so funds are locked during construction
      this.player.removeGold(this.reservedTotalCost);
      this.construction.setConstructionType(this.constructionType);
      this.construction.setConstructionTargetLevel(this.desiredLevel);
      // Apply construction speed modifier from tech effects
      const speedMods = constructionSpeedModifiers(this.player);
      this.ticksUntilComplete = Math.ceil(
        info.constructionDuration! / speedMods.speedMul,
      );
      // Set up cooldown on the unit for UI progress bar display
      this.construction.launch(this.ticksUntilComplete);
      return;
    }

    if (!this.construction.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.construction.owner()) {
      this.player = this.construction.owner();
    }

    if (this.ticksUntilComplete === 0) {
      this.player = this.construction.owner();
      this.construction.delete(false);
      // Refund only base cost; PlayerImpl.buildUnit will deduct base again.
      // Net effect over the flow is total aggregated cost.
      if (this.baseCost > 0n) {
        this.player.addGold(this.baseCost);
      }
      this.completeConstruction();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  private completeConstruction() {
    const player = this.player;
    switch (this.constructionType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        this.mg.addExecution(
          new NukeExecution(this.constructionType, player, this.tile),
        );
        break;
      case UnitType.MIRV:
        this.mg.addExecution(new MirvExecution(player, this.tile));
        break;
      case UnitType.Warship:
        this.mg.addExecution(
          new WarshipExecution(
            { owner: player, patrolTile: this.tile },
            this.desiredLevel,
          ),
        );
        break;
      case UnitType.Submarine:
        this.mg.addExecution(
          new SubmarineExecution(
            { owner: player, patrolTile: this.tile },
            this.desiredLevel,
          ),
        );
        break;
      case UnitType.FighterJet:
        this.mg.addExecution(
          new FighterJetExecution(
            { owner: player, patrolTile: this.tile },
            this.desiredLevel,
          ),
        );
        break;
      case UnitType.Port:
        {
          const canSpawn = this.player.canBuild(
            this.constructionType,
            this.tile,
          );
          if (canSpawn === false) {
            console.warn(`cannot build ${this.constructionType}`);
            return;
          }
          const built = this.player.buildUnit(
            this.constructionType,
            canSpawn,
            {},
          );
          this.applyUpgradesIfNeeded(built, this.desiredLevel);
        }
        break;
      case UnitType.MissileSilo:
        this.mg.addExecution(
          new MissileSiloExecution(player, this.tile, this.desiredLevel),
        );
        break;
      case UnitType.DefensePost:
        this.mg.addExecution(new DefensePostExecution(player, this.tile));
        break;
      case UnitType.SAMLauncher:
        if (
          player.type() === PlayerType.FakeHuman &&
          player.unitsOwned(UnitType.SAMLauncher) === 0
        ) {
          player.addUpgrade(UpgradeType.CityAntiAir);
        }
        this.mg.addExecution(
          new SAMLauncherExecution(player, this.tile, null, this.desiredLevel),
        );
        break;
      case UnitType.City:
      case UnitType.Hospital:
      case UnitType.Academy:
      case UnitType.ResearchLab:
      case UnitType.Factory:
        {
          const canSpawn = this.player.canBuild(
            this.constructionType,
            this.tile,
          );
          if (canSpawn === false) {
            console.warn(`cannot build ${this.constructionType}`);
            return;
          }
          const built = this.player.buildUnit(
            this.constructionType,
            canSpawn,
            {},
          );
          this.applyUpgradesIfNeeded(built, this.desiredLevel);
        }
        break;
      case UnitType.Airfield:
        this.mg.addExecution(
          new AirfieldExecution(
            player,
            this.tile,
            this.bomberLevel,
            this.desiredLevel,
          ),
        );
        break;
      default:
        {
          const canSpawn = this.player.canBuild(
            this.constructionType,
            this.tile,
          );
          if (canSpawn === false) {
            console.warn(`cannot build ${this.constructionType}`);
            return;
          }
          const built = this.player.buildUnit(
            this.constructionType,
            canSpawn,
            {},
          );
          this.applyUpgradesIfNeeded(built, this.desiredLevel);
        }
        break;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private computeDesiredLevel(type: UnitType, target?: number): number {
    if (target === undefined || target < 1) return 1;
    // For units, use player-specific max level based on researched techs
    // For structures, use player-specific max (e.g., SAM launchers depend on SAM tech level)
    const cap = isUpgradeableUnit(type)
      ? playerMaxUnitLevel(this.player, type)
      : playerMaxStructureLevel(this.player, type);
    return Math.max(1, Math.min(cap, target));
  }

  // step cost is centralized in ../game/Costs

  private applyUpgradesIfNeeded(unit: Unit, desiredLevel: number) {
    const steps = Math.max(0, desiredLevel - 1);
    if (steps <= 0) return;
    const impl = unit as any; // UnitImpl
    if (typeof impl.upgradeStructure === "function") {
      for (let i = 0; i < steps; i++) {
        impl.upgradeStructure();
      }
    }
  }
}
