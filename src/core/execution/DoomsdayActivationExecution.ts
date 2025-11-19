import { Execution, Game, MessageType, Player, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

export class DoomsdayActivationExecution implements Execution {
  private active = true;
  private mg: Game;
  private device: Unit;
  private spreadTiles: Set<TileRef> = new Set();
  private currentWavefront: Set<TileRef> = new Set();
  private processedTiles: Set<TileRef> = new Set();
  private spreadSpeed = 2; // tiles per tick
  private totalTilesToSpread: number;
  private random: PseudoRandom;
  private damageApplied = false;

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

    // Calculate 50% of all land tiles
    this.totalTilesToSpread = Math.floor(this.mg.numLandTiles() * 0.5);

    // Initialize wavefront at device location
    this.currentWavefront.add(this.deviceTile);
    this.processedTiles.add(this.deviceTile);

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

    // Spread fallout gradually
    if (this.spreadTiles.size < this.totalTilesToSpread) {
      this.spreadFallout();
    } else {
      // Finished spreading
      this.active = false;
    }
  }

  private applyGlobalDamage(): void {
    const allUnits = this.mg.units();

    for (const unit of allUnits) {
      if (unit.hasHealth()) {
        const currentHealth = Number(unit.health());
        const damage = Math.floor(currentHealth * 0.8);
        unit.modifyHealth(-damage);
      }
    }
  }

  private spreadFallout(): void {
    const nextWavefront: Set<TileRef> = new Set();
    let tilesAddedThisTick = 0;

    // Expand from current wavefront
    for (const tile of this.currentWavefront) {
      if (tilesAddedThisTick >= this.spreadSpeed) break;

      // Get neighbors
      const neighbors = this.mg.neighbors(tile);

      for (const neighbor of neighbors) {
        if (this.processedTiles.has(neighbor)) continue;
        if (this.spreadTiles.size >= this.totalTilesToSpread) break;

        this.processedTiles.add(neighbor);

        // Only spread to land tiles
        if (this.mg.isLand(neighbor)) {
          // 50% of tiles get fallout (but we're already limiting total count)
          // Since we want exactly 50% of all land tiles, we can be more selective
          if (this.spreadTiles.size < this.totalTilesToSpread) {
            this.spreadTiles.add(neighbor);
            this.mg.setFallout(neighbor, true);
            tilesAddedThisTick++;
          }
        }

        // Add to next wavefront for continued spreading
        nextWavefront.add(neighbor);
      }
    }

    // Update wavefront for next tick
    this.currentWavefront = nextWavefront;

    // If no more tiles to expand to, we're done
    if (this.currentWavefront.size === 0) {
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
