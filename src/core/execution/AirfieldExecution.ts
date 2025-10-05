import {
  Execution,
  Game,
  Player,
  PlayerType,
  Relation,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { BomberExecution } from "./BomberExecution";
import { CargoPlaneExecution } from "./CargoPlaneExecution";

export class AirfieldExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private airfield: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;
  private spawnTicker = 0;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("AirfieldExecution not initialized");
    }
    const mg = this.mg;

    if (this.airfield === null) {
      const spawn = this.player.canBuild(UnitType.Airfield, this.tile);
      if (!spawn) {
        console.warn(
          `Player ${this.player.id()} cannot build airfield at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.airfield = this.player.buildUnit(UnitType.Airfield, spawn, {});
    }

    if (!this.airfield.isActive()) {
      this.active = false;
      return;
    }

    if (this.player.id() !== this.airfield.owner().id()) {
      this.player = this.airfield.owner();
    }

    if ((mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    const airfieldUnit = this.airfield;
    const totalEffectiveAirfields = mg
      .players()
      .reduce((sum, p) => sum + p.effectiveUnits(UnitType.Airfield), 0);
    const activeBombers = this.player.units(UnitType.Bomber).length;

    if (activeBombers >= totalEffectiveAirfields) {
      return;
    }

    if (mg.config().cargoPlanesEnabled()) {
      if (
        this.random.chance(
          mg.config().cargoPlaneSpawnRate(totalEffectiveAirfields),
        )
      ) {
        const possiblePorts = this.player.airfields(airfieldUnit);
        if (possiblePorts.length > 0) {
          const destField = this.random.randElement(possiblePorts);
          mg.addExecution(
            new CargoPlaneExecution(this.player, airfieldUnit, destField),
          );
        }
      }
    }

    if (!mg.config().bombersEnabled()) return;

    const isPeaceTimerActive =
      mg.peaceTimerEndsAtTick !== null && mg.ticks() < mg.peaceTimerEndsAtTick;

    if (isPeaceTimerActive) {
      return; // Block bomber launch
    }

    this.spawnTicker++;
    if (this.spawnTicker < mg.config().bomberSpawnInterval()) return;
    this.spawnTicker = 0;

    const findAndLaunchBomber = (targets: Unit[]) => {
      for (const targetUnit of targets) {
        const currentBombers =
          this.player.bombersOnTarget.get(targetUnit.tile()) ?? 0;
        if (currentBombers < 6) {
          mg.addExecution(
            new BomberExecution(
              this.player,
              airfieldUnit,
              targetUnit.tile(),
              this.player.bombersOnTarget,
            ),
          );
          this.player.bombersOnTarget.set(
            targetUnit.tile(),
            currentBombers + 1,
          );
          return true;
        }
      }
      return false;
    };

    const intent = this.player.getBomberIntent?.();
    if (intent?.targetPlayerID && intent?.structure) {
      const targetPlayer = mg.player(intent.targetPlayerID);
      if (targetPlayer && !this.player.isFriendly(targetPlayer)) {
        const targets = targetPlayer.units(intent.structure);
        if (findAndLaunchBomber(targets)) {
          return;
        }
      }
    }

    // Default targeting logic
    if (!this.player.isAutoBombingEnabled()) {
      return;
    }
    const range = mg.config().bomberTargetRange();
    const enemies = mg
      .nearbyUnits(airfieldUnit.tile(), range, [
        UnitType.SAMLauncher,
        UnitType.Airfield,
        UnitType.MissileSilo,
        UnitType.Port,
        UnitType.DefensePost,
        UnitType.City,
        UnitType.Academy,
        UnitType.Hospital,
      ])
      .filter(({ unit }) => {
        const o = mg.owner(unit.tile());
        return (
          o.isPlayer() &&
          o.id() !== this.player.id() &&
          (this.player.type() === PlayerType.FakeHuman
            ? this.player.relation(o) <= Relation.Hostile
            : !this.player.isFriendly(o))
        );
      })
      .map(({ unit, distSquared }) => ({ unit, dist2: distSquared }));

    if (enemies.length === 0) return;

    const priority: UnitType[] = [
      UnitType.SAMLauncher,
      UnitType.Airfield,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.DefensePost,
      UnitType.City,
      UnitType.Academy,
      UnitType.Hospital,
    ];

    const sortedEnemies = enemies.sort((a, b) => {
      const priorityA = priority.indexOf(a.unit.type());
      const priorityB = priority.indexOf(b.unit.type());
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return a.dist2 - b.dist2;
    });

    const potentialTargets = sortedEnemies.map((e) => e.unit);

    findAndLaunchBomber(potentialTargets);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
