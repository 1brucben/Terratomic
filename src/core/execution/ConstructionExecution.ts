import {
  Execution,
  Game,
  Gold,
  Player,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AcademyExecution } from "./AcademyExecution";
import { AirfieldExecution } from "./AirfieldExecution";
import { CityExecution } from "./CityExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { FighterJetExecution } from "./FighterJetExecution";
import { HospitalExecution } from "./HospitalExecution";
import { MirvExecution } from "./MIRVExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { NukeExecution } from "./NukeExecution";
import { PortExecution } from "./PortExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";
import { WarshipExecution } from "./WarshipExecution";

/**
 * Manages the construction process of various units and structures in the game.
 * This execution handles the building duration, cost, and final spawning of the constructed unit.
 */
export class ConstructionExecution implements Execution {
  private construction: Unit | null = null;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  private cost: Gold;

  /**
   * Initializes a new ConstructionExecution instance.
   * @param player The player initiating the construction.
   * @param tile The tile where the construction is taking place.
   * @param constructionType The type of unit or structure being constructed.
   */
  constructor(
    private player: Player,
    private tile: TileRef,
    private constructionType: UnitType,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  /**
   * Called every game tick to update the construction progress.
   * Handles the initial building of the 'Construction' unit, deducting cost, and completing the construction.
   * @param ticks The current game tick.
   */
  tick(ticks: number): void {
    // If the construction unit hasn't been built yet, initialize it.
    if (this.construction === null) {
      const info = this.mg.unitInfo(this.constructionType);
      // If the unit has no construction duration, complete it immediately.
      if (info.constructionDuration === undefined) {
        this.completeConstruction();
        this.active = false;
        return;
      }
      // Check if the player can build at the target tile.
      const spawnTile = this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile === false) {
        console.warn(`Cannot build ${this.constructionType}`);
        this.active = false;
        return;
      }
      // Build the generic 'Construction' unit.
      this.construction = this.player.buildUnit(
        UnitType.Construction,
        spawnTile,
        {},
      );
      // Deduct the cost from the player's gold.
      this.cost = this.mg.unitInfo(this.constructionType).cost(this.player);
      this.player.removeGold(this.cost);
      // Set the actual type of unit being constructed.
      this.construction.setConstructionType(this.constructionType);
      this.ticksUntilComplete = info.constructionDuration;
      return;
    }

    // If the construction unit becomes inactive (e.g., destroyed), deactivate this execution.
    if (!this.construction.isActive()) {
      this.active = false;
      return;
    }

    // Update the owner if the construction unit has been conquered.
    if (this.player !== this.construction.owner()) {
      this.player = this.construction.owner();
    }

    // If construction is complete, finalize the unit.
    if (this.ticksUntilComplete === 0) {
      this.player = this.construction.owner();
      this.construction.delete(false);
      // Refund the cost so the player has the gold to build the actual unit.
      this.player.addGold(this.cost);
      this.completeConstruction();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  /**
   * Completes the construction process, adding the actual unit to the game.
   * This method uses a switch statement to handle different unit types.
   */
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
          new WarshipExecution({ owner: player, patrolTile: this.tile }),
        );
        break;
      // Handle Fighter Jet construction, adding a new FighterJetExecution.
      case UnitType.FighterJet:
        this.mg.addExecution(
          new FighterJetExecution({ owner: player, patrolTile: this.tile }),
        );
        break;
      case UnitType.Port:
        this.mg.addExecution(new PortExecution(player, this.tile));
        break;
      case UnitType.MissileSilo:
        this.mg.addExecution(new MissileSiloExecution(player, this.tile));
        break;
      case UnitType.DefensePost:
        this.mg.addExecution(new DefensePostExecution(player, this.tile));
        break;
      case UnitType.SAMLauncher:
        this.mg.addExecution(new SAMLauncherExecution(player, this.tile));
        break;
      case UnitType.City:
        this.mg.addExecution(new CityExecution(player, this.tile));
        break;
      case UnitType.Hospital:
        this.mg.addExecution(new HospitalExecution(player, this.tile));
        break;
      case UnitType.Academy:
        this.mg.addExecution(new AcademyExecution(player, this.tile));
        break;
      case UnitType.Airfield:
        this.mg.addExecution(new AirfieldExecution(player, this.tile));
        break;
      default:
        throw Error(`Unit type ${this.constructionType} not supported`);
    }
  }

  /**
   * Checks if the construction execution is currently active.
   * @returns True if active, false otherwise.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Indicates whether this execution should be active during the spawn phase.
   * @returns Always false.
   */
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
