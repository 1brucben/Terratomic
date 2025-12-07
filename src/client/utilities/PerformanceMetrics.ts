import { UnitType } from "../../core/game/Game";

export class PerformanceMetrics {
  private static instance: PerformanceMetrics;

  // Metrics
  public fps: number = 0;
  public frameTime: number = 0; // ms
  public tps: number = 0;
  public latency: number = 0; // ms (Time Since Last Packet)
  public entities: number = 0;
  public memory: number = 0; // MB
  public zoomLevel: number = 1;
  public drawCalls: number = 0;
  public lastRenderTime: number = 0; // ms since last render

  // Internal tracking
  private frames: number = 0;
  private lastFpsUpdate: number = 0;
  private ticks: number = 0;
  private lastTpsUpdate: number = 0;
  private lastPacketTime: number = Date.now();

  // Layer timings
  public layerTimings: Map<string, number> = new Map();
  private layerBuffers: Map<string, SmoothingBuffer> = new Map();

  // Smoothed Metrics
  private fpsBuffer = new SmoothingBuffer(2000); // 2s window
  private frameTimeBuffer = new SmoothingBuffer(2000);
  private tpsBuffer = new SmoothingBuffer(2000);
  private latencyBuffer = new SmoothingBuffer(2000);
  private frameTimeHistory: number[] = []; // Last 100 frame times for percentile calc
  private readonly FRAME_HISTORY_SIZE = 100;

  // Composition & Visibility
  public unitComposition: Map<UnitType, number> = new Map();
  public visibleEntities: number = 0;

  public updateUnitComposition(composition: Map<UnitType, number>) {
    this.unitComposition = composition;
  }

  public enabled: boolean = false;

  private constructor() {}

  public static getInstance(): PerformanceMetrics {
    if (!PerformanceMetrics.instance) {
      PerformanceMetrics.instance = new PerformanceMetrics();
    }
    return PerformanceMetrics.instance;
  }

  public updateFrame(duration: number) {
    if (!this.enabled) return;

    this.frameTime = duration;
    this.frameTimeBuffer.push(duration);
    this.frames++;

    // Track frame time history for percentile calculation
    this.frameTimeHistory.push(duration);
    if (this.frameTimeHistory.length > this.FRAME_HISTORY_SIZE) {
      this.frameTimeHistory.shift();
    }

    // Track time since last render
    const now = performance.now();
    if (this.lastRenderTime > 0) {
      // lastRenderTime stores the gap, not timestamp
    }
    this.lastRenderTime = duration;

    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frames;
      this.fpsBuffer.push(this.frames);
      this.frames = 0;
      this.lastFpsUpdate = now;
      this.updateMemory();
    }
  }

  public resetVisibleCount() {
    if (!this.enabled) return;
    this.visibleEntities = 0;
  }

  public incrementVisibleEntities(count: number) {
    if (!this.enabled) return;
    this.visibleEntities += count;
  }

  public updateTick() {
    if (!this.enabled) return;
    this.ticks++;
    const now = performance.now();
    if (now - this.lastTpsUpdate >= 1000) {
      this.tps = this.ticks;
      this.tpsBuffer.push(this.ticks);
      this.ticks = 0;
      this.lastTpsUpdate = now;
    }
  }

  public updatePacketReceived() {
    if (!this.enabled) return;
    this.lastPacketTime = Date.now();
  }

  public updateEntityCount(count: number) {
    if (!this.enabled) return;
    this.entities = count;
  }

  public updateLayerDuration(layerName: string, duration: number) {
    if (!this.enabled) return;
    let buffer = this.layerBuffers.get(layerName);
    if (!buffer) {
      buffer = new SmoothingBuffer(2000);
      this.layerBuffers.set(layerName, buffer);
    }
    buffer.push(duration);
    this.layerTimings.set(layerName, buffer.getAverage());
  }

  // Helper to get current TSLP
  public getLatency(): number {
    const latency = Date.now() - this.lastPacketTime;
    this.latencyBuffer.push(latency);
    return latency;
  }

  // Get smoothed values
  public getSmoothedFps(): number {
    return this.fpsBuffer.getAverage();
  }
  public getSmoothedFrameTime(): number {
    return this.frameTimeBuffer.getAverage();
  }
  public getSmoothedTps(): number {
    return this.tpsBuffer.getAverage();
  }
  public getSmoothedLatency(): number {
    return this.latencyBuffer.getAverage();
  }

  public updateZoomLevel(zoom: number) {
    if (!this.enabled) return;
    this.zoomLevel = zoom;
  }

  public updateDrawCalls(count: number) {
    if (!this.enabled) return;
    this.drawCalls = count;
  }

  // Get 1% low FPS (99th percentile frame time converted to FPS)
  public get1PercentLowFps(): number {
    if (this.frameTimeHistory.length < 10) return 0;
    const sorted = [...this.frameTimeHistory].sort((a, b) => b - a);
    const index = Math.floor(sorted.length * 0.01);
    const worstFrameTime = sorted[Math.max(0, index)];
    return worstFrameTime > 0 ? 1000 / worstFrameTime : 0;
  }

  private updateMemory() {
    if ((performance as any).memory) {
      this.memory = Math.round(
        (performance as any).memory.usedJSHeapSize / 1024 / 1024,
      );
    }
  }
}

class SmoothingBuffer {
  private values: { val: number; time: number }[] = [];
  constructor(private windowMs: number) {}

  push(val: number) {
    const now = performance.now();
    this.values.push({ val, time: now });
    this.prune(now);
  }

  private prune(now: number) {
    while (
      this.values.length > 0 &&
      now - this.values[0].time > this.windowMs
    ) {
      this.values.shift();
    }
  }

  getAverage(): number {
    if (this.values.length === 0) return 0;
    const sum = this.values.reduce((acc, v) => acc + v.val, 0);
    return sum / this.values.length;
  }
}
