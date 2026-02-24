import {
  Execution,
  Game,
  isUnit,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { playerMaxStructureTechLevel } from "../game/Upgradeables";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

type Target = {
  unit: Unit;
  tile: TileRef;
};

type InterceptionTile = {
  tile: TileRef;
  tick: number;
};

/**
 * Smart SAM targeting system preshoting nukes so its range is strictly enforced
 */
class SAMTargetingSystem {
  // Interception tiles are computed a single time, but it may not be reachable yet.
  // Store the result so it can be intercepted at the proper time, rather than recomputing each ticks
  // Null interception tile means there are no interception tiles in range.
  private readonly precomputedNukes: Map<number, InterceptionTile | null> =
    new Map();
  private readonly missileSpeed: number;

  constructor(
    private readonly mg: Game,
    private readonly sam: Unit,
  ) {
    this.missileSpeed = this.mg.config().defaultSamMissileSpeed();
  }

  updateUnreachableNukes(nearbyUnits: { unit: Unit; distSquared: number }[]) {
    if (this.precomputedNukes.size === 0) return;

    // Avoid per-tick allocations for the common case where only a few nukes are tracked.
    if (this.precomputedNukes.size <= 16) {
      for (const nukeId of this.precomputedNukes.keys()) {
        let found = false;
        for (const u of nearbyUnits) {
          if (u.unit.id() === nukeId) {
            found = true;
            break;
          }
        }
        if (!found) {
          this.precomputedNukes.delete(nukeId);
        }
      }
      return;
    }

    const nearbyUnitSet = new Set<number>();
    for (const u of nearbyUnits) {
      nearbyUnitSet.add(u.unit.id());
    }
    for (const nukeId of this.precomputedNukes.keys()) {
      if (!nearbyUnitSet.has(nukeId)) {
        this.precomputedNukes.delete(nukeId);
      }
    }
  }

  private effectiveSamRange(): number {
    const base = this.mg.config().defaultSamRange();
    const bonus = this.mg.config().samRangeUpgradePercent();
    // Use player's SAM tech level, not unit level (which is stack count)
    const lvl = playerMaxStructureTechLevel(
      this.sam.owner(),
      UnitType.SAMLauncher,
    );
    if (lvl <= 1) return base;
    // Apply per-upgrade multiplicative increase
    const factor = Math.pow(1 + bonus, lvl - 1);
    return Math.round(base * factor);
  }

  private isInRange(tile: TileRef) {
    const samTile = this.sam.tile();
    const rangeSquared = this.effectiveSamRange() ** 2;
    return this.mg.euclideanDistSquared(samTile, tile) <= rangeSquared;
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    return Math.ceil(
      this.mg.manhattanDist(currentTile, tile) / this.missileSpeed,
    );
  }

  private computeInterceptionTile(unit: Unit): InterceptionTile | undefined {
    const trajectory = unit.trajectory();
    const samTile = this.sam.tile();
    const currentIndex = unit.trajectoryIndex();
    const explosionTick: number = trajectory.length - currentIndex;
    for (let i = currentIndex; i < trajectory.length; i++) {
      const trajectoryTile = trajectory[i];
      if (trajectoryTile.targetable && this.isInRange(trajectoryTile.tile)) {
        const nukeTickToReach = i - currentIndex;
        const samTickToReach = this.tickToReach(samTile, trajectoryTile.tile);
        const tickBeforeShooting = nukeTickToReach - samTickToReach;
        if (samTickToReach < explosionTick && tickBeforeShooting >= 0) {
          return { tick: tickBeforeShooting, tile: trajectoryTile.tile };
        }
      }
    }
    return undefined;
  }

  public getSingleTarget(ticks: number): Target | null {
    const targets = this.getMultipleTargets(1, ticks);
    return targets.length > 0 ? targets[0] : null;
  }

  // Get multiple targets for stacked SAMs - each SAM can target a different nuke
  public getMultipleTargets(maxCount: number, ticks: number): Target[] {
    // Look beyond the SAM range so it can preshot nukes
    const detectionRange = this.effectiveSamRange() * 2;
    const nukes = this.mg.nearbyUnits(
      this.sam.tile(),
      detectionRange,
      [UnitType.AtomBomb, UnitType.HydrogenBomb],
      ({ unit }) => {
        if (!isUnit(unit)) {
          return false;
        }

        const nukeOwner = unit.owner();
        if (nukeOwner === this.sam.owner()) {
          return false;
        }
        if (this.sam.owner().isFriendly(nukeOwner)) {
          return false;
        }

        // Only intercept neutral nukes if they are actually threatening us.
        return (
          this.sam.owner().isAtWarWith(nukeOwner) ||
          this.nukeThreatensPlayerTerritory(unit, this.sam.owner())
        );
      },
    );

    // Clear precomputed nukes that went out of range
    this.updateUnreachableNukes(nukes);

    const targets: Array<Target> = [];
    for (const nuke of nukes) {
      const nukeId = nuke.unit.id();
      const cached = this.precomputedNukes.get(nukeId);
      if (cached !== undefined) {
        if (cached === null) {
          // Known unreachable, skip.
          continue;
        }
        if (cached.tick === ticks) {
          // Time to shoot! But skip if another SAM already has this nuke covered.
          this.precomputedNukes.delete(nukeId);
          if (nuke.unit.targetedBySAM()) {
            continue;
          }
          targets.push({ tile: cached.tile, unit: nuke.unit });
          continue;
        }
        if (cached.tick > ticks) {
          // Not due yet, skip for now.
          continue;
        }
        // Missed the planned tick (e.g. was on cooldown), recompute a new interception tile if possible
        this.precomputedNukes.delete(nukeId);
      }
      // Skip nukes already being targeted by a SAM missile
      if (nuke.unit.targetedBySAM()) {
        continue;
      }
      const interceptionTile = this.computeInterceptionTile(nuke.unit);
      if (interceptionTile !== undefined) {
        if (interceptionTile.tick <= 1) {
          // Shoot instantly
          targets.push({ unit: nuke.unit, tile: interceptionTile.tile });
        } else {
          // Nuke will be reachable but not yet. Store the result.
          this.precomputedNukes.set(nukeId, {
            tick: interceptionTile.tick + ticks,
            tile: interceptionTile.tile,
          });
        }
      } else {
        // Store unreachable nukes to prevent useless interception computation
        this.precomputedNukes.set(nukeId, null);
      }
    }

    // Sort by priority (H-bombs first) and return up to maxCount
    return targets
      .sort((a: Target, b: Target) => {
        // Prioritize Hydrogen Bombs
        if (
          a.unit.type() === UnitType.HydrogenBomb &&
          b.unit.type() !== UnitType.HydrogenBomb
        )
          return -1;
        if (
          a.unit.type() !== UnitType.HydrogenBomb &&
          b.unit.type() === UnitType.HydrogenBomb
        )
          return 1;

        return 0;
      })
      .slice(0, maxCount);
  }

  private nukeThreatensPlayerTerritory(nuke: Unit, player: Player): boolean {
    const targetTile = nuke.targetTile();
    if (targetTile === undefined) {
      return false;
    }

    const playerSmallID = player.smallID();
    if (this.mg.ownerID(targetTile) === playerSmallID) {
      return true;
    }

    const blastRadius = this.mg.config().nukeMagnitudes(nuke.type()).outer;
    const outer2 = blastRadius * blastRadius;

    // PERF: Avoid bfs() here (allocates a Set + queue) since this can run often.
    // A tight bounding-box scan with early exit is faster and allocation-free.
    const tx = this.mg.x(targetTile);
    const ty = this.mg.y(targetTile);
    const minX = Math.max(0, tx - blastRadius);
    const maxX = Math.min(this.mg.width() - 1, tx + blastRadius);
    const minY = Math.max(0, ty - blastRadius);
    const maxY = Math.min(this.mg.height() - 1, ty + blastRadius);

    for (let y = minY; y <= maxY; y++) {
      const dy = y - ty;
      const dy2 = dy * dy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - tx;
        if (dx * dx + dy2 > outer2) {
          continue;
        }

        const ref = this.mg.ref(x, y);
        if (this.mg.ownerID(ref) === playerSmallID) {
          return true;
        }
      }
    }

    return false;
  }
}

export class SAMLauncherExecution implements Execution {
  executionName = "SAMLauncherExecution";
  private mg: Game;
  private active: boolean = true;

  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;
  private targetingSystem: SAMTargetingSystem;

  private pseudoRandom: PseudoRandom | undefined;

  constructor(
    private player: Player,
    private tile: TileRef | null,
    private sam: Unit | null = null,
    private desiredLevel?: number,
    private stackCount: number = 1, // Number of stacked SAMs (fires multiple missiles)
  ) {
    if (sam !== null) {
      this.tile = sam.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }
  private isHit(type: UnitType, random: number): boolean {
    if (!this.sam) return false; // Should not happen
    const healthPercentage = this.sam.hasHealth()
      ? Number(this.sam.health()) / (this.sam.info().maxHealth ?? 1)
      : 1;

    if (type === UnitType.AtomBomb || type === UnitType.HydrogenBomb) {
      return (
        random < this.mg.config().samNukeHittingChance() * healthPercentage
      );
    }

    if (type === UnitType.MIRVWarhead) {
      return random < this.mg.config().samWarheadHittingChance();
    }

    // For planes (Bomber, FighterJet)
    return random < this.mg.config().samPlaneHittingChance() * healthPercentage;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }

    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    if (this.sam === null) {
      if (this.tile === null) {
        throw new Error("tile is null");
      }
      const spawnTile = this.player.canBuild(UnitType.SAMLauncher, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build SAM Launcher");
        this.active = false;
        return;
      }
      this.sam = this.player.buildUnit(UnitType.SAMLauncher, spawnTile, {});
      // Apply tech level upgrades
      const level = this.computeDesiredLevel(
        UnitType.SAMLauncher,
        this.desiredLevel,
      );
      this.applyUpgrades(this.sam, level);
      // Set stack count for multiple missiles
      if (this.stackCount > 1) {
        (this.sam as any).setStackCount(this.stackCount);
        // Apply HP bonuses for stacking (one upgrade per extra stack)
        for (let i = 1; i < this.stackCount; i++) {
          (this.sam as any).upgradeStructure();
        }
      }
    }
    this.targetingSystem ??= new SAMTargetingSystem(this.mg, this.sam);

    if (this.sam.isInCooldown()) {
      this.sam.touch(); // Emit updates for per-slot cooldown recovery
      return;
    }

    if (!this.sam.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.sam.owner()) {
      this.player = this.sam.owner();
    }

    this.pseudoRandom ??= new PseudoRandom(this.sam.id());

    const mirvWarheadTargets = this.mg.nearbyUnits(
      this.sam.tile(),
      this.MIRVWarheadSearchRadius,
      UnitType.MIRVWarhead,
      ({ unit }) => {
        if (!isUnit(unit)) return false;
        if (unit.owner() === this.player) return false;
        if (this.player.isFriendly(unit.owner())) return false;
        const dst = unit.targetTile();
        return (
          this.sam !== null &&
          dst !== undefined &&
          this.mg.manhattanDist(dst, this.sam.tile()) <
            this.MIRVWarheadProtectionRadius
        );
      },
    );

    // Get a single target - stacked SAMs use per-slot independent cooldowns
    let target: Target | null = null;
    if (mirvWarheadTargets.length === 0) {
      target = this.targetingSystem.getSingleTarget(ticks);
    }

    const cooldown = this.sam.ticksLeftInCooldown();
    if (typeof cooldown === "number" && cooldown >= 0) {
      this.sam.touch();
    }

    const hasTarget = target !== null;
    if ((hasTarget || mirvWarheadTargets.length > 0) && !isPeaceTimerActive) {
      this.sam.launch();
      const type =
        mirvWarheadTargets.length > 0
          ? UnitType.MIRVWarhead
          : target?.unit.type();
      if (type === undefined) throw new Error("Unknown unit type");
      const random = this.pseudoRandom.next();
      const hit = this.isHit(type, random);
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${type}`,
          MessageType.SAM_MISS,
          this.sam.owner().id(),
        );
      } else if (mirvWarheadTargets.length > 0) {
        const samOwner = this.sam.owner();

        // Message
        this.mg.displayMessage(
          `${mirvWarheadTargets.length} MIRV warheads intercepted`,
          MessageType.SAM_HIT,
          samOwner.id(),
        );

        mirvWarheadTargets.forEach(({ unit: u }) => {
          // Delete warheads
          if (u.isActive()) {
            u.delete();
          }
        });

        // Record stats
        this.mg
          .stats()
          .bombIntercept(
            samOwner,
            UnitType.MIRVWarhead,
            mirvWarheadTargets.length,
          );
      } else if (target !== null) {
        // Fire one missile at the target
        target.unit.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.sam.tile(),
            this.sam.owner(),
            this.sam,
            target.unit,
            target.tile,
          ),
        );
      } else {
        // No valid target to engage (should not happen when firing)
      }
    }
    if (this.mg.ticks() % 20 === 0) {
      this.interceptPlanes();
    }
  }

  private interceptPlanes() {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    const effectiveRange = (() => {
      const base = this.mg.config().defaultSamRange();
      const bonus = this.mg.config().samRangeUpgradePercent();
      // Use player's SAM tech level, not unit level (which is stack count)
      const lvl = playerMaxStructureTechLevel(
        this.sam!.owner(),
        UnitType.SAMLauncher,
      );
      if (lvl <= 1) return base;
      const factor = Math.pow(1 + bonus, lvl - 1);
      return Math.round(base * factor);
    })();

    const potentialAirborneTargets = this.mg.nearbyUnits(
      this.sam!.tile(),
      effectiveRange,
      [UnitType.Bomber, UnitType.FighterJet, UnitType.Paratrooper],
    );
    if (!this.sam) return;

    const validAirborneTargets = potentialAirborneTargets
      .filter(({ unit }) => {
        const unitOwner = unit.owner();
        const targetUnitOwner = unit.targetUnit()?.owner();

        if (unitOwner === this.player) return false;

        if (this.player.isFriendly(unitOwner as Player)) return false;

        // Neutral behavior: only intercept when at war, except defend against
        // bomber/paratrooper explicitly targeting our land.
        if (!this.canEngageAirborneTarget(unitOwner as Player, unit)) {
          return false;
        }
        if (
          targetUnitOwner === this.player ||
          (targetUnitOwner &&
            (targetUnitOwner as Player).isFriendly(this.player))
        ) {
          return false;
        }

        // Exclude returning bombers
        if (unit.type() === UnitType.Bomber && unit.returning()) {
          return false;
        }

        // Exclude bombers at their source airfield
        if (unit.isAtSourceAirfield()) {
          return false;
        }

        return !unit.targetedBySAM();
      })
      .sort((a, b) => {
        // Prioritize by unit type: Bomber > FighterJet
        const typeOrder = {
          [UnitType.Bomber]: 0,
          [UnitType.FighterJet]: 1,
        };
        const typeA = typeOrder[a.unit.type() as UnitType];
        const typeB = typeOrder[b.unit.type() as UnitType];

        if (typeA !== typeB) {
          return typeA - typeB;
        }

        // For same type, prioritize by distance (closer first)
        return a.distSquared - b.distSquared;
      });

    if (
      validAirborneTargets.length > 0 &&
      !this.sam.isInCooldown(this.mg.config().SAMPlaneCooldown()) &&
      !isPeaceTimerActive
    ) {
      this.sam.launch(this.mg.config().SAMPlaneCooldown());
      const samOwner = this.sam!.owner();
      const targetPlane = validAirborneTargets[0].unit;
      const random = this.pseudoRandom!.next();
      const hit = this.isHit(targetPlane.type(), random);

      // Always create missile execution for visual FX, whether hit or miss
      targetPlane.setTargetedBySAM(true);
      this.mg.addExecution(
        new SAMMissileExecution(
          this.sam!.tile(),
          this.sam!.owner(),
          this.sam!,
          targetPlane,
          targetPlane.tile(),
        ),
      );

      if (hit) {
        this.mg.displayMessage(
          "messages.airplane_intercepted",
          MessageType.SAM_HIT,
          samOwner.id(),
        );
      } else {
        this.mg.displayMessage(
          "messages.missile_failed_intercept",
          MessageType.SAM_MISS,
          this.sam.owner().id(),
        );
      }
    }
  }

  private canEngageAirborneTarget(unitOwner: Player, unit: Unit): boolean {
    if (this.player.isAtWarWith(unitOwner)) {
      return true;
    }

    // Neutral: only defend against incoming bomber/paratrooper attacks.
    if (
      unit.type() !== UnitType.Bomber &&
      unit.type() !== UnitType.Paratrooper
    ) {
      return false;
    }

    const targetTile = unit.targetTile();
    if (targetTile === undefined) {
      return false;
    }

    return this.mg.owner(targetTile) === this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private computeDesiredLevel(_type: UnitType, target?: number): number {
    if (target === undefined || target < 1) return 1;
    return Math.min(3, Math.max(1, target));
  }
  private applyUpgrades(unit: Unit, desiredLevel: number) {
    const steps = Math.max(0, desiredLevel - 1);
    if (steps <= 0) return;
    const impl = unit as any;
    if (typeof impl.upgradeStructure === "function") {
      for (let i = 0; i < steps; i++) impl.upgradeStructure();
    }
  }
}
