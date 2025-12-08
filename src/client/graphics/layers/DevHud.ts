import { PlayerType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { PerformanceMetrics } from "../../utilities/PerformanceMetrics";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class DevHud implements Layer {
  private userSettings: UserSettings;
  private metrics: PerformanceMetrics;
  private game: GameView;
  private transformHandler: TransformHandler;
  private cachedEnabled: boolean = false;

  constructor(game: GameView, transformHandler: TransformHandler) {
    this.game = game;
    this.transformHandler = transformHandler;
    this.userSettings = new UserSettings();
    this.metrics = PerformanceMetrics.getInstance();
  }

  private container: HTMLDivElement | null = null;
  private lastUpdate = 0;

  init() {
    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.top = "160px";
    this.container.style.right = "10px";
    this.container.style.width = "220px";
    this.container.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    this.container.style.color = "white";
    this.container.style.fontFamily = "monospace";
    this.container.style.fontSize = "12px";
    this.container.style.padding = "10px";
    this.container.style.zIndex = "100"; // High z-index to stay on top
    this.container.style.pointerEvents = "auto";
    this.container.style.display = "flex";
    this.container.style.flexDirection = "column";
    this.container.style.gap = "4px";
    document.body.appendChild(this.container);

    window.addEventListener("keydown", (e) => {
      if (e.key === "\\" && e.ctrlKey) {
        this.userSettings.toggleDevHud();
      }
    });
  }

  renderLayer(_context: CanvasRenderingContext2D) {
    const now = performance.now();

    // Only check settings every 100ms to avoid frequent localStorage reads
    if (now - this.lastUpdate >= 100) {
      this.cachedEnabled = this.userSettings.showDevHud();
      this.metrics.enabled = this.cachedEnabled;
      this.lastUpdate = now;

      if (!this.cachedEnabled) {
        if (this.container && this.container.style.display !== "none") {
          this.container.style.display = "none";
        }
        return;
      }

      if (this.container && this.container.style.display !== "flex") {
        this.container.style.display = "flex";
      }

      this.updateDom();
      return;
    }

    // Fast path: use cached state between updates
    if (!this.cachedEnabled) return;
  }

  private updateDom() {
    if (!this.container) return;

    // Collect unit composition
    const unitComposition = Array.from(this.metrics.unitComposition.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Timings
    const timings = Array.from(this.metrics.layerTimings.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Player counts
    const allPlayers = this.game.players();
    const humans = { alive: 0, total: 0 };
    const fakeHumans = { alive: 0, total: 0 };
    const bots = { alive: 0, total: 0 };
    for (const p of allPlayers) {
      const type = p.type();
      const isAlive = p.isAlive();
      if (type === PlayerType.Human) {
        humans.total++;
        if (isAlive) humans.alive++;
      } else if (type === PlayerType.FakeHuman) {
        fakeHumans.total++;
        if (isAlive) fakeHumans.alive++;
      } else if (type === PlayerType.Bot) {
        bots.total++;
        if (isAlive) bots.alive++;
      }
    }

    // Metrics
    const fps = this.metrics.getSmoothedFps();
    const frameTime = this.metrics.getSmoothedFrameTime();
    const tps = this.metrics.getSmoothedTps();
    const latency = this.metrics.getSmoothedLatency();
    const memory = this.metrics.memory;
    const entities = this.metrics.entities;
    const visible = this.metrics.visibleEntities;
    const onePercentLow = this.metrics.get1PercentLowFps();
    const currentTick = this.game.ticks();
    const zoom = this.transformHandler.scale;

    // Helper to generate bar HTML
    const renderBar = (val: number, max: number, color: string) => {
      const pct = Math.min(Math.max(val / max, 0), 1) * 100;
      return `
            <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); margin-top: 2px;">
                <div style="width: ${pct}%; height: 100%; background: ${color};"></div>
            </div>`;
    };

    const renderRow = (
      label: string,
      value: string,
      rawVal: number,
      max: number,
      color: string,
      showBar: boolean = true,
      title: string = "",
    ) => `
            <div title="${title}" style="cursor: help;">
                <div style="display: flex; justify-content: space-between;">
                    <span>${label}:</span>
                    <span style="color: ${color}">${value}</span>
                </div>
                ${showBar ? renderBar(rawVal, max, color) : ""}
            </div>
        `;

    let html = "";

    // Core Metrics
    html += renderRow(
      "Toggle on/off",
      "Ctrl + \\",
      0,
      1,
      "#ffffff",
      false,
      "Press Ctrl + \\ to toggle this HUD (Dev Monitor)",
    );
    html += renderRow(
      "FPS",
      fps.toFixed(0),
      fps,
      60,
      fps < 30 ? "#ff0000" : fps < 55 ? "#ffff00" : "#00ff00",
      true,
      "Frames Per Second. >55 is Good, <30 is Bad.",
    );
    html += renderRow(
      "1% Low",
      onePercentLow.toFixed(0),
      onePercentLow,
      60,
      onePercentLow < 20
        ? "#ff0000"
        : onePercentLow < 40
          ? "#ffff00"
          : "#00ff00",
      true,
      "1% Low FPS (worst frames). Shows stutters. >40 is Good, <20 is Bad.",
    );
    html += renderRow(
      "Frame Time",
      `${frameTime.toFixed(2)}ms`,
      frameTime,
      50,
      frameTime > 33 ? "#ff0000" : frameTime > 16 ? "#ffff00" : "#00ff00",
      true,
      "Time to render one frame. <16ms is Good (60fps), >33ms is Bad (<30fps).",
    );
    html += renderRow(
      "TPS",
      tps.toFixed(1),
      tps,
      20,
      tps < 5 ? "#ff0000" : tps < 8 ? "#ffff00" : "#00ff00",
      true,
      "Ticks Per Second. Should match server tick rate. Stable is Good.",
    );
    html += renderRow(
      "TSLP",
      `${latency.toFixed(0)}ms`,
      latency,
      500,
      latency > 200 ? "#ff0000" : latency > 100 ? "#ffff00" : "#00ff00",
      true,
      "Time Since Last Packet. <100ms is Good, >200ms is Bad.",
    );
    html += renderRow(
      "Tick",
      currentTick.toString(),
      currentTick % 100,
      100,
      "#888888",
      true,
      "Current game tick number.",
    );
    html += renderRow(
      "Zoom",
      zoom.toFixed(2),
      zoom,
      5,
      "#888888",
      true,
      "Current camera zoom level.",
    );

    // Memory & Entities
    html += renderRow(
      "Memory",
      memory ? `${memory}MB` : "N/A",
      memory,
      1000,
      "#00ffff",
      true,
      "JS Heap usage (Chrome only). Lower is better.",
    );
    html += renderRow(
      "Entities / Vis",
      `${entities} / ${visible}`,
      visible,
      entities || 1,
      "#ffffff",
      true,
      "Total vs Visible entities. Lower visible count improves render performance.",
    );

    // Player Breakdown
    html += `<div style="margin-top: 4px; border-bottom: 1px solid #555; padding-bottom: 2px;" title="Player counts by type (alive/total)">Players</div>`;
    html += renderRow(
      "Humans",
      `${humans.alive} / ${humans.total}`,
      humans.alive,
      humans.total || 1,
      "#00ff00",
      true,
      "Human players (alive / total)",
    );
    html += renderRow(
      "FakeHumans",
      `${fakeHumans.alive} / ${fakeHumans.total}`,
      fakeHumans.alive,
      fakeHumans.total || 1,
      "#ffff00",
      true,
      "FakeHuman players (alive / total)",
    );
    html += renderRow(
      "Bots",
      `${bots.alive} / ${bots.total}`,
      bots.alive,
      bots.total || 1,
      "#ff8800",
      true,
      "Bot players (alive / total)",
    );

    // Top Consumers
    html += `<div style="margin-top: 4px; border-bottom: 1px solid #555; padding-bottom: 2px;" title="Time spent in each render layer per frame">Top Consumers</div>`;
    for (const [name, time] of timings) {
      html += renderRow(
        name,
        `${time.toFixed(2)}ms`,
        time,
        frameTime || 1,
        "#ffa500",
        true,
        `Time spent rendering ${name} layer`,
      );
    }

    // Unit Breakdown
    html += `<div style="margin-top: 4px; border-bottom: 1px solid #555; padding-bottom: 2px;" title="Top 5 unit types by count">Unit Breakdown</div>`;
    for (const [type, count] of unitComposition) {
      html += renderRow(
        type,
        count.toString(),
        count,
        entities || 1,
        "#aaaaaa",
        true,
        `Count of ${type} units`,
      );
    }

    this.container.innerHTML = html;
  }

  shouldTransform(): boolean {
    return false; // Render in screen space
  }
}
