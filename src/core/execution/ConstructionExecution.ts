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
  isStackableStructure,
  isTechUpgradeableStructure,
  isUpgradeableUnit,
  maxStackCount,
  playerMaxStructureTechLevel,
  playerMaxUnitLevel,
} from "../game/Upgradeables";
import { constructionSpeedModifiers } from "../tech/TechEffects";
import { AirfieldExecution } from "./AirfieldExecution";
import { ArtilleryExecution } from "./ArtilleryExecution";
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
  private desiredStackCount: number = 1; // How many stacked instances
  private desiredTechLevel: number = 1; // Tech upgrade level (for SAM, Airfield)

  constructor(
    private player: Player,
    private constructionType: UnitType,
    private tile: TileRef,
    private stackCount?: number, // User-selected stack count (renamed from targetLevel)
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

      // Compute stack count and tech level
      this.desiredStackCount = this.computeStackCount(this.constructionType);
      this.desiredTechLevel = this.computeTechLevel(this.constructionType);

      if (info.constructionDuration === undefined) {
        // No construction phase; treat as instant build path
        // Compute and reserve total aggregated cost first
        this.baseCost = this.mg
          .unitInfo(this.constructionType)
          .cost(this.player);
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
        const total = this.computeTotalCost();
        if (this.player.gold() < total) {
          console.warn(
            `cannot afford construction ${this.constructionType} stack=${this.desiredStackCount} techLevel=${this.desiredTechLevel}`,
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
      const totalCost = this.computeTotalCost();
      if (this.player.gold() < totalCost) {
        console.warn(
          `cannot afford construction ${this.constructionType} stack=${this.desiredStackCount} techLevel=${this.desiredTechLevel}`,
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
      this.construction.setConstructionTargetLevel(this.desiredStackCount);
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
            this.desiredTechLevel,
          ),
        );
        break;
      case UnitType.Submarine:
        this.mg.addExecution(
          new SubmarineExecution(
            { owner: player, patrolTile: this.tile },
            this.desiredTechLevel,
          ),
        );
        break;
      case UnitType.FighterJet:
        this.mg.addExecution(
          new FighterJetExecution(
            { owner: player, patrolTile: this.tile },
            this.desiredTechLevel,
          ),
        );
        break;
      case UnitType.Artillery:
        this.mg.addExecution(
          new ArtilleryExecution(
            { owner: player, patrolTile: this.tile },
            this.desiredTechLevel,
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
          this.applyStackingIfNeeded(built, this.desiredStackCount);
        }
        break;
      case UnitType.MissileSilo:
        this.mg.addExecution(
          new MissileSiloExecution(
            player,
            this.tile,
            this.desiredTechLevel,
            this.desiredStackCount,
          ),
        );
        break;
      case UnitType.DefensePost:
        // DefensePost does not support stacking
        this.mg.addExecution(new DefensePostExecution(player, this.tile));
        break;
      case UnitType.SAMLauncher:
        if (
          player.type() === PlayerType.FakeHuman &&
          player.unitsOwned(UnitType.SAMLauncher) === 0
        ) {
          player.addUpgrade(UpgradeType.CityAntiAir);
        }
        // SAM uses tech level for capability AND stack count for multiple missiles
        this.mg.addExecution(
          new SAMLauncherExecution(
            player,
            this.tile,
            null,
            this.desiredTechLevel,
            this.desiredStackCount,
          ),
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
          this.applyStackingIfNeeded(built, this.desiredStackCount);
        }
        break;
      case UnitType.Airfield:
        // Airfield uses bomber level for capability AND stack count for multiple bombers
        this.mg.addExecution(
          new AirfieldExecution(
            player,
            this.tile,
            this.bomberLevel ?? this.desiredTechLevel,
            this.desiredStackCount,
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
          this.applyStackingIfNeeded(built, this.desiredStackCount);
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

  // Compute the stack count (how many instances in one tile)
  private computeStackCount(type: UnitType): number {
    // Use client-provided stack count, clamped to valid range
    if (isStackableStructure(type) && this.stackCount && this.stackCount > 1) {
      return Math.min(maxStackCount(type), this.stackCount);
    }
    return 1;
  }

  // Compute the tech level for upgradeable units/structures
  private computeTechLevel(type: UnitType): number {
    if (isUpgradeableUnit(type)) {
      return playerMaxUnitLevel(this.player, type);
    }
    if (isTechUpgradeableStructure(type)) {
      return playerMaxStructureTechLevel(this.player, type);
    }
    return 1;
  }

  // Compute total cost including stacking and tech upgrades
  private computeTotalCost(): Gold {
    // For combat units, use hardcoded tech-based costs
    if (isUpgradeableUnit(this.constructionType)) {
      return aggregateStructureBuildCost(
        this.mg,
        this.player,
        this.constructionType,
        this.desiredTechLevel,
        0, // multiplier ignored for upgradeable units
      );
    }

    // For structures, compute stacking cost
    const stackCost = aggregateStructureBuildCost(
      this.mg,
      this.player,
      this.constructionType,
      this.desiredStackCount,
      this.mg.config().structureUpgradeCostMultiplier(this.constructionType),
    );

    // Add bomber upgrade cost for airfields
    if (this.constructionType === UnitType.Airfield) {
      const bomberLvl = this.bomberLevel ?? this.desiredTechLevel;
      return (
        stackCost +
        computeBomberUpgradeCost(
          this.mg,
          this.player,
          bomberLvl,
          this.desiredStackCount,
        )
      );
    }

    return stackCost;
  }

  // Apply stacking upgrades (HP bonus) for non-tech structures
  private applyStackingIfNeeded(unit: Unit, stackCount: number) {
    const steps = Math.max(0, stackCount - 1);
    if (steps <= 0) return;
    const impl = unit as any; // UnitImpl
    // Set the stack count on the unit
    if (typeof impl.setStackCount === "function") {
      impl.setStackCount(stackCount);
    }
    // Apply HP bonuses via upgradeStructure
    if (typeof impl.upgradeStructure === "function") {
      for (let i = 0; i < steps; i++) {
        impl.upgradeStructure();
      }
    }
  }
}
