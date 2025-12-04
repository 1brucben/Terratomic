import type { PlayerView } from "../../core/game/GameView";

export type Sample = { t: number; v: number };
export type PlayerSeries = {
  playerId: string;
  name: string;
  samples: Sample[];
  aliveUntil?: number; // time when death detected
};

class StatsStore {
  // metric -> playerId -> series
  private series: Map<string, Map<string, PlayerSeries>> = new Map();

  private activeMetrics: Map<
    string,
    {
      getPlayers: () => PlayerView[];
      sampler: (metric: string, p: PlayerView) => number;
      isAlive: (p: PlayerView) => boolean;
      lastSampledTick: number;
    }
  > = new Map();

  ensureSeries(metric: string, players: PlayerView[]): void {
    let m = this.series.get(metric);
    if (!m) {
      m = new Map();
      this.series.set(metric, m);
    }
    for (const p of players) {
      if (!m.has(p.id())) {
        m.set(p.id(), {
          playerId: p.id(),
          name: p.displayName?.() ?? p.name?.() ?? "Player",
          samples: [],
        });
      } else {
        // keep name fresh (in case of rename)
        const s = m.get(p.id())!;
        s.name = p.displayName?.() ?? p.name?.() ?? s.name;
      }
    }
  }

  start(
    metric: string,
    getPlayers: () => PlayerView[],
    sampler: (metric: string, p: PlayerView) => number,
    isAlive: (p: PlayerView) => boolean,
    getTick: () => number, // kept for API compatibility but unused in favor of onTick
  ): void {
    if (this.activeMetrics.has(metric)) return;

    this.activeMetrics.set(metric, {
      getPlayers,
      sampler,
      isAlive,
      lastSampledTick: -1,
    });

    // Seed immediately
    this.onTick(getTick());
  }

  stop(metric: string): void {
    this.activeMetrics.delete(metric);
  }

  onTick(now: number): void {
    for (const [metric, config] of this.activeMetrics.entries()) {
      // Only sample if we haven't yet, or if 100 ticks have passed
      if (config.lastSampledTick !== -1 && now < config.lastSampledTick + 100) {
        continue;
      }

      const players = config.getPlayers();
      this.ensureSeries(metric, players);
      const m = this.series.get(metric)!;

      let anySampled = false;
      for (const p of players) {
        const s = m.get(p.id());
        if (!s) continue;
        if (!config.isAlive(p)) {
          s.aliveUntil ??= now;
          continue;
        }
        const v = config.sampler(metric, p);

        if (s.samples.length > 0 && s.samples[s.samples.length - 1].t === now) {
          s.samples[s.samples.length - 1].v = v;
        } else {
          s.samples.push({ t: now, v });
        }
        anySampled = true;
      }

      if (anySampled || config.lastSampledTick === -1) {
        config.lastSampledTick = now;
      }
    }
  }
  getSeries(metric: string): PlayerSeries[] {
    const m = this.series.get(metric);
    if (!m) return [];
    return [...m.values()];
  }
}

export const statsStore = new StatsStore();
export default statsStore;
