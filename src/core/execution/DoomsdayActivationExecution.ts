import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

// Unit types that are instantly destroyed by the doomsday wave
const DOOMSDAY_DESTROY_TYPES = new Set<UnitType>([
  UnitType.Bomber,
  UnitType.FighterJet,
  UnitType.Warship,
  UnitType.TradeShip,
]);

// Simple 2D value noise with spatial coherence for fallout blobs
class FalloutNoise {
  private gradX: Float32Array;
  private gradY: Float32Array;
  private perm: Uint8Array;

  constructor(seed: number) {
    const rng = new PseudoRandom(seed);
    const size = 256;
    this.gradX = new Float32Array(size);
    this.gradY = new Float32Array(size);
    this.perm = new Uint8Array(size);

    // Generate random unit gradients
    for (let i = 0; i < size; i++) {
      const angle = rng.next() * Math.PI * 2;
      this.gradX[i] = Math.cos(angle);
      this.gradY[i] = Math.sin(angle);
      this.perm[i] = i;
    }
    // Shuffle permutation table
    for (let i = size - 1; i > 0; i--) {
      const j = rng.nextInt(0, i + 1);
      [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
    }
  }

  private fade(t: number): number {
    // Quintic smoothstep: 6t^5 - 15t^4 + 10t^3
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const idx = hash & 255;
    return this.gradX[idx] * x + this.gradY[idx] * y;
  }

  // Returns a value roughly in range [-1, 1]
  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const X1 = (X + 1) & 255;
    const Y1 = (Y + 1) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.perm[(X + this.perm[Y]) & 255];
    const ab = this.perm[(X + this.perm[Y1]) & 255];
    const ba = this.perm[(X1 + this.perm[Y]) & 255];
    const bb = this.perm[(X1 + this.perm[Y1]) & 255];

    const x1 = this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
    const x2 = this.lerp(
      this.grad(ab, xf, yf - 1),
      this.grad(bb, xf - 1, yf - 1),
      u,
    );

    return this.lerp(x1, x2, v);
  }

  // Fractal Brownian motion for more natural-looking blobs
  fbm(x: number, y: number, octaves: number = 3): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }

    return value / maxValue;
  }
}

export class DoomsdayActivationExecution implements Execution {
  private active = true;
  private mg: Game;
  private device: Unit;
  private spreadTiles: Set<TileRef> = new Set();
  // Radial speed in squared-distance units per tick; controls how fast the
  // wavefront moves outward from the device. Tuned so that visually it
  // feels like a steady expanding circle, independent of tile density.
  private radialSpeed = 1_000; // squared-distance units per tick
  private noise: FalloutNoise;
  // Radial expansion data
  private sortedLandTiles: TileRef[] = [];
  private landDistances: Uint32Array = new Uint32Array(0); // squared distances parallel to sortedLandTiles
  private expansionIndex = 0;
  private currentRadiusSq = 0;
  // Noise parameters for fallout blobs
  private noiseScale = 0.015; // Lower = larger blobs, higher = smaller blobs
  private falloutThreshold = 0.0; // Threshold for fallout (adjust for ~70% coverage)

  constructor(
    private player: Player,
    device: Unit,
    private deviceTile: TileRef,
  ) {
    this.device = device;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.noise = new FalloutNoise(ticks);

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

  // Radial (Euclidean) expansion with noise-based spatial autocorrelation for fallout blobs
  private spreadFallout(): void {
    const startRadiusSq = this.currentRadiusSq;
    const maxRadiusSq = startRadiusSq + this.radialSpeed;
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

      // Apply effects to units on this tile
      const unitsHere = this.mg.unitsAt(tile);
      for (const unit of unitsHere) {
        // Instantly destroy bombers, fighters, warships, tradeships
        if (DOOMSDAY_DESTROY_TYPES.has(unit.type())) {
          unit.delete(true, this.player);
          continue;
        }
        // Apply 80% health reduction to other structures
        if (!unit.hasHealth()) continue;
        const currentHealth = Number(unit.health());
        if (currentHealth <= 0) continue;
        const damage = Math.floor(currentHealth * 0.8);
        if (damage <= 0) continue;
        unit.modifyHealth(-damage);
      }

      // Use noise-based spatial autocorrelation for fallout decision
      // This creates coherent blobs of fallout vs non-fallout areas
      const x = this.mg.x(tile);
      const y = this.mg.y(tile);
      const noiseValue = this.noise.fbm(
        x * this.noiseScale,
        y * this.noiseScale,
      );
      // Skip if noise is above threshold (creates non-fallout blob)
      if (noiseValue > this.falloutThreshold) continue;

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
