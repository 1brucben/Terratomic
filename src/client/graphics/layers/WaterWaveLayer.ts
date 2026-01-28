import mapData from "../../../../resources/maps/maps.json" with { type: "json" };
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

interface WavePixel {
  index: number;
  dist: number;
  randomVal: number;
}

const DEFAULT_MAX_WAVE_DIST = 30;
const DEFAULT_WAVE_SPEED = 0.05;

export class WaterWaveLayer implements Layer {
  layerName = "WaterWaveLayer";
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private wavePixels: WavePixel[] = [];

  // Animation state
  private phase = 0;

  // Config
  private maxDist = DEFAULT_MAX_WAVE_DIST;
  private waveSpeed = DEFAULT_WAVE_SPEED;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("2d context not supported");
    this.context = context;

    this.loadConfig();
    this.initWavePixels();

    // Create initial image data (all transparent)
    this.imageData = this.context.createImageData(
      this.canvas.width,
      this.canvas.height,
    );
  }

  private loadConfig() {
    const gameMapName = this.game.config().gameConfig().gameMap;
    const mapConfig = mapData.find((m) => m.displayName === gameMapName);

    if (mapConfig) {
      if (
        "waveDistance" in mapConfig &&
        typeof mapConfig.waveDistance === "number"
      ) {
        this.maxDist = mapConfig.waveDistance;
      }
      if ("waveSpeed" in mapConfig && typeof mapConfig.waveSpeed === "number") {
        this.waveSpeed = mapConfig.waveSpeed;
      }
    }
  }

  private initWavePixels() {
    const w = this.game.width();
    const h = this.game.height();
    const size = w * h;

    // 1. Detect Real Ocean (Flood fill from edges)
    // Helps distinct inland lakes from the main ocean if map bits are unreliable
    const isOcean = new Int8Array(size).fill(0); // 0 = unknown/lake, 1 = ocean
    const oceanQueue: number[] = [];

    // Seed edges
    for (let x = 0; x < w; x++) {
      const top = x;
      const bottom = (h - 1) * w + x;
      if (this.game.isWater(top)) {
        isOcean[top] = 1;
        oceanQueue.push(top);
      }
      if (this.game.isWater(bottom)) {
        isOcean[bottom] = 1;
        oceanQueue.push(bottom);
      }
    }
    for (let y = 1; y < h - 1; y++) {
      const left = y * w;
      const right = y * w + (w - 1);
      if (this.game.isWater(left) && isOcean[left] === 0) {
        isOcean[left] = 1;
        oceanQueue.push(left);
      }
      if (this.game.isWater(right) && isOcean[right] === 0) {
        isOcean[right] = 1;
        oceanQueue.push(right);
      }
    }

    // BFS Helper
    const getNeighbors = (idx: number): number[] => {
      const x = idx % w;
      const y = Math.floor(idx / w);
      const ns: number[] = [];
      if (x > 0) ns.push(idx - 1);
      if (x < w - 1) ns.push(idx + 1);
      if (y > 0) ns.push(idx - w);
      if (y < h - 1) ns.push(idx + w);
      return ns;
    };

    let oceanHead = 0;
    while (oceanHead < oceanQueue.length) {
      const curr = oceanQueue[oceanHead++];
      const ns = getNeighbors(curr);
      for (const n of ns) {
        // If it's water and not marked ocean yet
        if (this.game.isWater(n) && isOcean[n] === 0) {
          isOcean[n] = 1;
          oceanQueue.push(n);
        }
      }
    }

    // 2. BFS for Distance Field (from Land)
    const distMap = new Int16Array(size).fill(-1);
    const queue: number[] = [];

    // Initialize BFS with all land tiles
    for (let i = 0; i < size; i++) {
      if (this.game.isLand(i)) {
        distMap[i] = 0; // Distance 0 (Land source)
        queue.push(i);
      }
    }

    // BFS to find water pixels up to usage distance
    let head = 0;

    // We calculate slightly further than maxDist to allow for peak detection
    const calcDist = this.maxDist + 2;

    while (head < queue.length) {
      const curr = queue[head++];
      const d = distMap[curr];

      if (d >= calcDist) continue;

      const ns = getNeighbors(curr);
      for (const n of ns) {
        if (distMap[n] === -1) {
          distMap[n] = d + 1;
          queue.push(n);
        }
      }
    }

    // 3. Collect Valid Pixels
    const RIVER_THRESHOLD_DIST = 3;

    for (let i = 0; i < size; i++) {
      // FILTER: Must be part of the main ocean connected to edges
      if (isOcean[i] === 0) continue;

      const d = distMap[i];
      if (d > 0 && d <= this.maxDist) {
        // Check for river artifact (peak logic)
        let isRiverPeak = true;
        const ns = getNeighbors(i);
        for (const n of ns) {
          if (distMap[n] > d) {
            isRiverPeak = false;
            break;
          }
        }

        if (isRiverPeak && d < RIVER_THRESHOLD_DIST) {
          continue;
        }

        this.wavePixels.push({
          index: i,
          dist: d,
          randomVal: Math.random(),
        });
      }
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.update();

    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }

    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private update() {
    this.phase += this.waveSpeed;

    const data = this.imageData.data;

    // Config for overlapping waves
    // Make the period slightly shorter than the distance so waves overlap (one starts before other finishes)
    const period = this.maxDist * 0.6;
    const waveWidth = 1.0; // Reduced from 3.5 to 1.5 for thinner waves

    const breakStart = this.maxDist * 0.4;
    const fadeStart = this.maxDist * 0.5;

    for (const p of this.wavePixels) {
      const offset = p.index * 4;

      // Calculate distance from the nearest wave front
      // Wave front moves as phase increases.
      // delta is "how far past the wave passed"
      let delta = (this.phase - p.dist) % period;
      if (delta < 0) delta += period;

      // Distance to the nearest peak (either "just passed" or "about to arrive")
      // We want the peak at delta=0 (or delta=period).
      // But visually we want it centered.
      // If delta is small (0..width), wave is here.
      // If delta is large (period-width..period), wave is here.
      const distFromPeak = Math.min(delta, period - delta);

      let intensity = 0;
      if (distFromPeak < waveWidth) {
        // Easing: Sine curve from 0 to 1 back to 0
        // map distFromPeak (0..waveWidth) to angle (0..PI/2)
        // Intensity = cos(dist * factor)
        // distFromPeak=0 -> 1. distFromPeak=waveWidth -> 0.
        const ratio = distFromPeak / waveWidth;
        intensity = Math.cos(ratio * (Math.PI / 2));

        // Enhance the peak non-linearly
        intensity = Math.pow(intensity, 1.5);
      }

      // Apply scaling/fading logic based on maxDist
      if (intensity > 0) {
        // Break up
        if (p.dist > breakStart) {
          const progress = Math.max(
            0,
            (p.dist - breakStart) / (this.maxDist - breakStart),
          );
          if (p.randomVal < progress) {
            intensity = 0;
          }
        }

        // Fade out
        if (intensity > 0 && p.dist > fadeStart) {
          const fadeProgress = Math.max(
            0,
            (p.dist - fadeStart) / (this.maxDist - fadeStart),
          );
          intensity *= 1.0 - fadeProgress;
        }
      }

      if (intensity > 0) {
        intensity *= 0.1; // Base opacity
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = Math.floor(intensity * 255);
      } else {
        data[offset + 3] = 0;
      }
    }

    this.context.putImageData(this.imageData, 0, 0);
  }
}
