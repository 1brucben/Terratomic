import { Cell, Execution, Game, Player, Tick } from "../game/Game";
import { PlayerImpl } from "../game/PlayerImpl";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";

/**
 * Periodically recomputes each player's capital (geographic center of owned tiles).
 * - Recomputes at most once every 30 seconds per player
 * - Spreads computations across 10 ticks by bucketing players by smallID % 10
 * - Uses up to 100 randomly sampled tiles (deterministic sampling per interval)
 */
export class CapitalRecalculationExecution implements Execution {
  private mg!: Game;
  private active = true;

  // Track last tick each player's capital was recalculated
  private lastRecalc: Map<string, Tick> = new Map();

  // Precomputed interval in ticks (30 seconds)
  private intervalTicks = 0;

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    // Harmless during spawn; enables early UI if needed
    return true;
  }

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    const turnMs = this.mg.config().serverConfig().turnIntervalMs();
    this.intervalTicks = Math.max(1, Math.ceil(30_000 / turnMs));
    // Compute capitals immediately at game start for all players
    for (const p of this.mg.players()) {
      this.recomputeCapital(p, _ticks);
    }
  }

  tick(ticks: number): void {
    const bucket = ticks % 10;
    const players = this.mg.players();

    for (const p of players) {
      // Spread across 10 ticks based on smallID bucket
      if (p.smallID() % 10 !== bucket) continue;

      const last = this.lastRecalc.get(p.id()) ?? -Infinity;
      if (ticks - last < this.intervalTicks) continue;

      this.recomputeCapital(p, ticks);
    }
  }

  private recomputeCapital(player: Player, ticks: Tick): void {
    const tiles = Array.from(player.tiles());
    let capital: Cell | null = null;

    if (tiles.length > 0) {
      const sampleSize = Math.min(100, tiles.length);
      const intervalIndex = Math.floor(ticks / Math.max(1, this.intervalTicks));
      const prng = new PseudoRandom(
        simpleHash(`${player.id()}::${intervalIndex}`),
      );
      // Deterministic reservoir sampling of up to 100 tiles
      const sample: number[] = [];
      for (let i = 0; i < tiles.length; i++) {
        if (i < sampleSize) {
          sample[i] = tiles[i];
        } else {
          const j = prng.nextInt(0, i + 1);
          if (j < sampleSize) sample[j] = tiles[i];
        }
      }

      // Compute centroid
      let sumX = 0;
      let sumY = 0;
      for (const t of sample) {
        sumX += this.mg.x(t as any);
        sumY += this.mg.y(t as any);
      }
      const cx = sumX / sample.length;
      const cy = sumY / sample.length;

      // Snap to the nearest sampled owned tile to keep it on-land and owned
      let best = sample[0];
      let bestD2 = Infinity;
      for (const t of sample) {
        const dx = this.mg.x(t as any) - cx;
        const dy = this.mg.y(t as any) - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          best = t;
          bestD2 = d2;
        }
      }

      capital = new Cell(this.mg.x(best as any), this.mg.y(best as any));
    }

    (player as PlayerImpl)._setCapital(capital);
    this.lastRecalc.set(player.id(), this.mg.ticks());
  }
}
