import { Execution, Game, MessageType, Player, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

export class DoomsdayActivationExecution implements Execution {
  private active = true;
  private mg: Game;
  private device: Unit;
  private spreadTiles: Set<TileRef> = new Set();
  // Radial speed in squared-distance units per tick; controls how fast the
  // wavefront moves outward from the device. Tuned so that visually it
  // feels like a steady expanding circle, independent of tile density.
  private radialSpeed = 1_000; // squared-distance units per tick
  private random: PseudoRandom;
  // Radial expansion data
  private sortedLandTiles: TileRef[] = [];
  private landDistances: Uint32Array = new Uint32Array(0); // squared distances parallel to sortedLandTiles
  private expansionIndex = 0;
  private currentRadiusSq = 0;

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

    // Build land tile list & precompute squared distances once
    const landTilesTemp: TileRef[] = [];
    const distTemp: number[] = [];
    this.mg.forEachTile((t) => {
      if (this.mg.isLand(t)) {
        landTilesTemp.push(t);
        distTemp.push(this.mg.euclideanDistSquared(this.deviceTile, t));
      }
    });
    // Create index array and sort by precomputed distance (avoids recomputing in comparator)
    const idx = distTemp.map((_, i) => i);
    idx.sort((a, b) => distTemp[a] - distTemp[b]);
    // Materialize sorted arrays
    this.sortedLandTiles = idx.map((i) => landTilesTemp[i]);
    this.landDistances = new Uint32Array(idx.map((i) => distTemp[i]));

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
            // Swallow relinquish errors; they are non-fatal for gameplay.
          }
        }
      }
      try {
        this.mg.setFallout(this.deviceTile, true);
      } catch (e) {
        // Swallow fallout set errors on the device tile; non-fatal.
      }
      this.expansionIndex = 1; // start expanding from next tile in sorted list
    }

    // Apply custom slow doomsday FX at device location (visual-only)
    this.mg.doomsdayExplosion(this.deviceTile, 200, this.player);

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

    // Spread fallout until we've processed all land tiles
    if (this.expansionIndex < this.sortedLandTiles.length) {
      this.spreadFallout();
    } else {
      this.active = false;
    }
  }

  // Radial (Euclidean) expansion with per-tile 50% probability for fallout
  private spreadFallout(): void {
    const startRadiusSq = this.currentRadiusSq;
    const maxRadiusSq = startRadiusSq + this.radialSpeed;
    let newFallout = 0;
    while (this.expansionIndex < this.sortedLandTiles.length) {
      const tile = this.sortedLandTiles[this.expansionIndex];
      const distSq = this.landDistances[this.expansionIndex];
      // Stop for this tick once we've reached tiles beyond the current
      // radial band; they'll be processed in future ticks as the radius
      // continues to grow.
      if (distSq > maxRadiusSq) {
        break;
      }
      this.expansionIndex++;
      // If there are units/structures here, apply the 80% health reduction
      // to them when the wave reaches this tile, but do NOT apply fallout
      // on this tile itself.
      const unitsHere = this.mg.unitsAt(tile);
      if (unitsHere.length > 0) {
        for (const unit of unitsHere) {
          if (!unit.hasHealth()) continue;
          const currentHealth = Number(unit.health());
          if (currentHealth <= 0) continue;
          const damage = Math.floor(currentHealth * 0.8);
          if (damage <= 0) continue;
          unit.modifyHealth(-damage);
        }
        // Skip fallout on this tile entirely to avoid double punishment.
        continue;
      }
      // 50% chance for fallout first – only pay ownership costs if applying
      if (this.random.next() >= 0.5) continue;
      if (this.mg.hasOwner(tile)) {
        const owner = this.mg.owner(tile);
        if (owner.isPlayer()) {
          try {
            owner.relinquish(tile);
          } catch (e) {
            // If relinquish fails, skip fallout to avoid exception spam
            continue;
          }
        }
      }
      try {
        this.mg.setFallout(tile, true);
        this.spreadTiles.add(tile);
        newFallout++;
      } catch {
        // Swallow fallout set errors on individual tiles; non-fatal.
      }
    }
    // Advance the wavefront radius for the next tick
    this.currentRadiusSq = maxRadiusSq;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
