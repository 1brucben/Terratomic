import { Execution, Game, MessageType, Player, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

export class DoomsdayActivationExecution implements Execution {
  private active = true;
  private mg: Game;
  private device: Unit;
  private spreadTiles: Set<TileRef> = new Set();
  // Legacy wavefront fields retained for now (unused after radial refactor)
  private currentWavefront: Set<TileRef> = new Set();
  private processedTiles: Set<TileRef> = new Set();
  private spreadSpeed = 500; // tiles per tick (radial expansion)
  private random: PseudoRandom;
  private damageApplied = false;
  // Radial expansion data
  private sortedLandTiles: TileRef[] = [];
  private expansionIndex = 0;

  constructor(
    private player: Player,
    device: Unit,
    private deviceTile: TileRef,
  ) {
    this.device = device;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(ticks);

    // Build sorted land tile list (ascending Euclidean distance from device)
    const landTiles: TileRef[] = [];
    this.mg.forEachTile((t) => {
      if (this.mg.isLand(t)) landTiles.push(t);
    });
    landTiles.sort(
      (a, b) =>
        this.mg.euclideanDistSquared(this.deviceTile, a) -
        this.mg.euclideanDistSquared(this.deviceTile, b),
    );
    this.sortedLandTiles = landTiles;
    console.log(
      `[Doomsday] Initialized. Total land tiles: ${this.sortedLandTiles.length}. Using 50% probabilistic fallout per tile encountered.`,
    );

    // Mark device tile processed immediately if land & first element
    if (this.mg.isLand(this.deviceTile)) {
      this.spreadTiles.add(this.deviceTile);
      // Ensure fallout on starting tile if unowned
      if (this.mg.hasOwner(this.deviceTile)) {
        const owner = this.mg.owner(this.deviceTile);
        if (owner.isPlayer()) {
          try {
            owner.relinquish(this.deviceTile);
          } catch (e) {
            console.error(
              `[Doomsday] Failed to relinquish device tile ${this.deviceTile}:`,
              e,
            );
          }
        }
      }
      try {
        this.mg.setFallout(this.deviceTile, true);
      } catch (e) {
        console.error(
          `[Doomsday] Failed to set fallout on device tile ${this.deviceTile}:`,
          e,
        );
      }
      this.expansionIndex = 1; // start expanding from next tile in sorted list
    }

    // Apply hydrogen bomb FX at device location
    this.mg.bomberExplosion(this.deviceTile, 160, this.player);

    // Send message to all players
    for (const player of this.mg.players()) {
      this.mg.displayMessage(
        "events_display.doomsday_triggered",
        MessageType.DOOMSDAY_DEVICE_ACTIVATED,
        player.id(),
        undefined,
        { player: this.player.displayName() },
      );
    }

    // Destroy the device
    this.device.delete(true, this.player);
  }

  tick(ticks: number): void {
    if (!this.active) return;

    // Apply 80% health damage to all units once at the start
    if (!this.damageApplied) {
      this.applyGlobalDamage();
      this.damageApplied = true;
    }

    // Spread fallout until we've processed all land tiles
    if (this.expansionIndex < this.sortedLandTiles.length) {
      this.spreadFallout();
    } else {
      console.log(
        `[Doomsday] Finished processing all land tiles. Fallout tiles: ${this.spreadTiles.size}. Deactivating.`,
      );
      this.active = false;
    }
  }

  private applyGlobalDamage(): void {
    console.log(`[Doomsday] Applying global damage.`);
    const allUnits = this.mg.units();
    let unitsDamaged = 0;

    for (const unit of allUnits) {
      if (unit.hasHealth()) {
        const currentHealth = Number(unit.health());
        const damage = Math.floor(currentHealth * 0.8);
        unit.modifyHealth(-damage);
        unitsDamaged++;
      }
    }
    console.log(`[Doomsday] Damaged ${unitsDamaged} units.`);
  }

  // Radial (Euclidean) expansion with per-tile 50% probability for fallout
  private spreadFallout(): void {
    let processed = 0;
    let newFallout = 0;
    const startIndex = this.expansionIndex;
    while (
      processed < this.spreadSpeed &&
      this.expansionIndex < this.sortedLandTiles.length
    ) {
      const tile = this.sortedLandTiles[this.expansionIndex];
      this.expansionIndex++;
      processed++;
      if (!this.mg.isLand(tile)) continue;
      // Relinquish if owned
      if (this.mg.hasOwner(tile)) {
        const owner = this.mg.owner(tile);
        if (owner.isPlayer()) {
          try {
            owner.relinquish(tile);
          } catch (e) {
            console.error(`[Doomsday] Failed to relinquish tile ${tile}:`, e);
            continue; // skip setting fallout if relinquish failed
          }
        }
      }
      // 50% chance for fallout
      if (this.random.next() < 0.5) {
        try {
          this.mg.setFallout(tile, true);
          this.spreadTiles.add(tile);
          newFallout++;
        } catch (e) {
          console.error(`[Doomsday] Failed to set fallout on tile ${tile}:`, e);
        }
      }
    }
    console.log(
      `[Doomsday] Tick radial processing: tiles ${startIndex}->${this.expansionIndex} (processed ${processed}), new fallout ${newFallout}, total fallout ${this.spreadTiles.size}.`,
    );
    if (this.expansionIndex >= this.sortedLandTiles.length) {
      console.log(`[Doomsday] All land tiles processed.`);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
