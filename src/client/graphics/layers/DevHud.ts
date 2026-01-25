import { PlayerType, UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { PerformanceMetrics } from "../../utilities/PerformanceMetrics";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class DevHud implements Layer {
  layerName = "DevHud";
  private userSettings: UserSettings;
  private metrics: PerformanceMetrics;
  private game: GameView;
  private transformHandler: TransformHandler;
  private cachedEnabled: boolean = false;
  private sortColumn: "type" | "count" | "render" | "visible" = "render";
  private sortDirection: "asc" | "desc" = "desc";

  constructor(game: GameView, transformHandler: TransformHandler) {
    this.game = game;
    this.transformHandler = transformHandler;
    this.userSettings = new UserSettings();
    this.metrics = PerformanceMetrics.getInstance();
  }

  private container: HTMLDivElement | null = null;
  private lastUpdate = 0;
  private isInteracting = false;

  init() {
    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.top = "160px";
    this.container.style.right = "10px";
    this.container.style.width = "550px";
    this.container.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    this.container.style.color = "white";
    this.container.style.fontFamily = "monospace";
    this.container.style.fontSize = "12px";
    this.container.style.padding = "10px";
    this.container.style.zIndex = "100"; // High z-index to stay on top
    this.container.style.pointerEvents = "auto";
    this.container.style.display = "flex";
    this.container.style.flexDirection = "row";
    this.container.style.gap = "15px";
    this.container.style.maxHeight = "calc(100vh - 170px)";
    this.container.style.overflowY = "auto";
    document.body.appendChild(this.container);

    // Use event delegation for all clicks to avoid handlers being destroyed on DOM updates
    this.container.addEventListener("mousedown", () => {
      this.isInteracting = true;
      setTimeout(() => {
        this.isInteracting = false;
      }, 300);
    });

    this.container.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const id = target.id;

      // Column sorting
      if (id.startsWith("devhud-sort-")) {
        const col = id.replace("devhud-sort-", "") as typeof this.sortColumn;
        if (this.sortColumn === col) {
          this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        } else {
          this.sortColumn = col;
          this.sortDirection = "desc";
        }
        this.updateDom();
        return;
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "\\" && e.ctrlKey) {
        this.userSettings.toggleDevHud();
      }
    });
  }

  renderLayer(_context: CanvasRenderingContext2D) {
    const now = performance.now();

    // Only check settings every 200ms to avoid frequent updates
    if (now - this.lastUpdate >= 100) {
      const newEnabled = this.userSettings.showDevHud();
      const enabledChanged = this.cachedEnabled !== newEnabled;
      this.cachedEnabled = newEnabled;
      this.metrics.enabled = this.cachedEnabled;

      // Sync metrics enabled state to worker
      if (enabledChanged) {
        const workerClient = (window as any).__WORKER_CLIENT__;
        if (workerClient) {
          workerClient.postMessage({
            type: "set_metrics_enabled",
            enabled: this.cachedEnabled,
          });
        }
      }

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

      // Don't update DOM while user is clicking/interacting
      if (!this.isInteracting) {
        this.updateDom();
      }
      return;
    }

    // Fast path: use cached state between updates
    if (!this.cachedEnabled) return;
  }

  private updateDom() {
    if (!this.container) return;

    const generalHtml = this.renderGeneralTab();
    const unitsHtml = this.renderUnitsTab();

    this.container.innerHTML = `
      <div style="flex: 1; min-width: 200px;">${generalHtml}</div>
      <div style="flex: 1; min-width: 260px;">${unitsHtml}</div>
    `;
  }

  private renderGeneralTab(): string {
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
    const aiPlayers = { alive: 0, total: 0 };
    const bots = { alive: 0, total: 0 };
    for (const p of allPlayers) {
      const type = p.type();
      const isAlive = p.isAlive();
      if (type === PlayerType.Human) {
        humans.total++;
        if (isAlive) humans.alive++;
      } else if (type === PlayerType.AI) {
        aiPlayers.total++;
        if (isAlive) aiPlayers.alive++;
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
      "AI",
      `${aiPlayers.alive} / ${aiPlayers.total}`,
      aiPlayers.alive,
      aiPlayers.total || 1,
      "#ffff00",
      true,
      "AI players (alive / total)",
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

    return html;
  }

  private renderUnitsTab(): string {
    // Collect all unit types with data
    const unitTypes = new Set<UnitType>();
    this.metrics.unitComposition.forEach((_, type) => unitTypes.add(type));
    this.metrics.unitRenderTime.forEach((_, type) => unitTypes.add(type));
    this.metrics.unitExecutionTime.forEach((_, type) => unitTypes.add(type));
    this.metrics.unitQueryCount.forEach((_, type) => unitTypes.add(type));
    this.metrics.unitVisibleCount.forEach((_, type) => unitTypes.add(type));

    // Define structure types
    const structureTypes = new Set([
      UnitType.City,
      UnitType.Port,
      UnitType.Airfield,
      UnitType.Factory,
      UnitType.DefensePost,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
      UnitType.ResearchLab,
      UnitType.Academy,
      UnitType.Hospital,
      UnitType.Construction,
    ]);

    // Build data rows and split into mobile vs structures
    const allRows = Array.from(unitTypes).map((type) => ({
      type: type as string,
      count: this.metrics.unitComposition.get(type) ?? 0,
      render: this.metrics.unitRenderTime.get(type) ?? 0,
      visible: this.metrics.unitVisibleCount.get(type) ?? 0,
    }));

    const mobileRows = allRows.filter(
      (row) => !structureTypes.has(row.type as UnitType),
    );
    const structureRows = allRows.filter((row) =>
      structureTypes.has(row.type as UnitType),
    );

    // Sort function
    const sortRows = (rows: typeof allRows) => {
      rows.sort((a, b) => {
        const aVal = a[this.sortColumn];
        const bVal = b[this.sortColumn];
        const cmp =
          typeof aVal === "string"
            ? aVal.localeCompare(bVal as string)
            : (aVal as number) - (bVal as number);
        return this.sortDirection === "asc" ? cmp : -cmp;
      });
    };

    sortRows(mobileRows);
    sortRows(structureRows);

    const renderHeader = (
      col: typeof this.sortColumn,
      label: string,
      title: string,
    ) => {
      const isActive = this.sortColumn === col;
      const arrow = isActive ? (this.sortDirection === "asc" ? "▲" : "▼") : "";
      return `<th id="devhud-sort-${col}" style="cursor: pointer; user-select: none; padding: 4px; border-bottom: 1px solid #555; text-align: left;" title="${title}">${label} ${arrow}</th>`;
    };

    const renderTable = (rows: typeof mobileRows, title: string) => {
      let tableHtml = `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; margin-bottom: 4px; border-bottom: 1px solid #555; padding-bottom: 2px;">${title}</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr>
                ${renderHeader("type", "Type", "Unit type name. Click to sort alphabetically.")}
                ${renderHeader("count", "#", "Total Count: Total number of this unit type in the game (all players). Higher counts can impact memory and performance. Click to sort by count.")}
                ${renderHeader("render", "R", "Render Time: Total milliseconds spent rendering ALL units of this type per frame. Measures GPU/Canvas rendering cost for all units of this type combined. Good: <0.5ms (green), Warning: 0.5-1ms (yellow), Bad: >1ms (red). High render time causes FPS drops. Click to sort by render time.")}
                ${renderHeader("visible", "V", "Currently Visible: Number of these units currently visible in your viewport. Only visible units are rendered, so this directly affects render time. The difference between Count and Visible shows off-screen units. Click to sort by visible count.")}
              </tr>
            </thead>
            <tbody>
      `;

      for (const row of rows) {
        const renderColor =
          row.render > 1 ? "#ff0000" : row.render > 0.5 ? "#ffff00" : "#00ff00";

        const rowTooltip = `${row.type} Performance:
Count: ${row.count} total units in game
Render: ${row.render > 0 ? row.render.toFixed(2) + "ms/frame for ALL units of this type" : "not tracked"} ${row.render > 1 ? "(BAD - causing FPS drops)" : row.render > 0.5 ? "(WARNING)" : row.render > 0 ? "(GOOD)" : ""}
Visible: ${row.visible || 0} in viewport (only these are rendered)

This shows TOTAL time for all ${row.type} units combined, not per unit.
High render time = many units visible or slow rendering code.`;

        tableHtml += `
          <tr style="border-bottom: 1px solid #333;" title="${rowTooltip}">
            <td style="padding: 3px; max-width: 80px; overflow: hidden; text-overflow: ellipsis;" title="${row.type}">${row.type}</td>
            <td style="padding: 3px; text-align: right;">${row.count}</td>
            <td style="padding: 3px; text-align: right; color: ${renderColor}">${row.render > 0 ? row.render.toFixed(2) : "-"}</td>
            <td style="padding: 3px; text-align: right;">${row.visible || "-"}</td>
          </tr>
        `;
      }

      tableHtml += `
            </tbody>
          </table>
        </div>
      `;
      return tableHtml;
    };

    // Build executions section
    const execMetrics = this.metrics.getExecutionMetrics();
    let executionsHtml = "";

    if (execMetrics.length === 0) {
      executionsHtml = `
        <div style="margin-top: 16px; padding: 12px; border-top: 2px solid #555;">
          <div style="font-weight: bold; margin-bottom: 4px; color: #4a9eff;">Executions (Logic)</div>
          <div style="color: #888; font-size: 10px; padding: 10px; text-align: center;">
            No execution data yet. Executions will appear once the game simulation starts.
          </div>
        </div>
      `;
    } else {
      executionsHtml = `
        <div style="margin-top: 16px; padding-top: 12px; border-top: 2px solid #555;">
          <div style="font-weight: bold; margin-bottom: 4px; color: #4a9eff;">Executions (Logic)</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr style="border-bottom: 1px solid #555;">
                <th style="text-align: left; padding: 4px;" title="Execution type name">Type</th>
                <th style="text-align: right; padding: 4px;" title="Average count per tick">#</th>
                <th style="text-align: right; padding: 4px;" title="Average time per tick (ms). Green: <1ms, Yellow: 1-2ms, Red: >2ms">T</th>
              </tr>
            </thead>
            <tbody>
      `;

      // Top 15 executions by time
      execMetrics.slice(0, 15).forEach((exec) => {
        const timeColor =
          exec.time > 2 ? "#ff6b6b" : exec.time > 1 ? "#ffd93d" : "#6bcf7f";
        const tooltip = `${exec.type}Execution Performance:\nCount: ${exec.count.toFixed(1)} per tick\nTime: ${exec.time.toFixed(2)}ms average per tick\n${exec.time > 2 ? "⚠️ PERFORMANCE HOTSPOT" : exec.time > 1 ? "⚠️ Moderate load" : "✅ Good performance"}`;

        executionsHtml += `
          <tr style="border-bottom: 1px solid #333;" title="${tooltip}">
            <td style="padding: 3px; max-width: 100px; overflow: hidden; text-overflow: ellipsis;">${exec.type}</td>
            <td style="text-align: right; padding: 3px;">${exec.count.toFixed(1)}</td>
            <td style="text-align: right; padding: 3px; color: ${timeColor};">${exec.time.toFixed(2)}</td>
          </tr>
        `;
      });

      executionsHtml += `
            </tbody>
          </table>
          <div style="margin-top: 4px; font-size: 10px; color: #888;">
            T=Time (ms/tick), #=Count. Top 15 by time.
          </div>
        </div>
      `;
    }

    let html = `<div style="margin-top: 4px;">`;
    html += renderTable(mobileRows, "Mobile Units");
    html += `
      <div style="margin-top: 8px; font-size: 10px; color: #888;">
        Click column headers to sort. R=Render, V=Visible
      </div>
    `;
    html += executionsHtml;
    html += `</div>`;

    return html;
  }

  private renderExecutionsTab(): string {
    const execMetrics = this.metrics.getExecutionMetrics();

    if (execMetrics.length === 0) {
      return `
        <div style="padding: 10px;">
          <h3 style="margin: 0 0 8px 0; color: #4a9eff; font-size: 13px;">Executions (Logic)</h3>
          <div style="color: #888; font-size: 11px; padding: 20px; text-align: center;">
            No execution data yet.<br/>
            Executions will appear once the game simulation starts.
          </div>
        </div>
      `;
    }

    let html = `
      <div style="padding: 10px; overflow-y: auto;">
        <h3 style="margin: 0 0 8px 0; color: #4a9eff; font-size: 13px;">Executions (Logic)</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <thead>
            <tr style="border-bottom: 1px solid #555;">
              <th style="text-align: left; padding: 4px; cursor: pointer;" title="Execution type name. Click to sort alphabetically.">Type</th>
              <th style="text-align: right; padding: 4px; cursor: pointer;" title="Average count per tick. How many instances of this execution run each tick.">#</th>
              <th style="text-align: right; padding: 4px; cursor: pointer;" title="Average time per tick (ms). Total time spent in this execution's tick() method per frame. Green: <1ms, Yellow: 1-2ms, Red: >2ms. Click to sort by time.">T</th>
            </tr>
          </thead>
          <tbody>
    `;

    // Top 15 executions by time
    execMetrics.slice(0, 15).forEach((exec) => {
      const timeColor =
        exec.time > 2 ? "#ff6b6b" : exec.time > 1 ? "#ffd93d" : "#6bcf7f";

      const tooltip = `${exec.type}Execution Performance:
Count: ${exec.count.toFixed(1)} per tick
Time: ${exec.time.toFixed(2)}ms average per tick
${exec.time > 2 ? "⚠️ PERFORMANCE HOTSPOT - Optimize this execution" : exec.time > 1 ? "⚠️ Moderate load" : "✅ Good performance"}

This measures client-side game logic execution time.
High times here impact TPS (ticks per second) and game simulation speed.`;

      html += `
        <tr style="border-bottom: 1px solid #333;" title="${tooltip}">
          <td style="padding: 3px; max-width: 100px; overflow: hidden; text-overflow: ellipsis;">${exec.type}</td>
          <td style="text-align: right; padding: 3px;">${exec.count.toFixed(1)}</td>
          <td style="text-align: right; padding: 3px; color: ${timeColor};">${exec.time.toFixed(2)}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <div style="margin-top: 8px; font-size: 10px; color: #888;">
          T=Time (ms/tick), #=Count. Showing top 15 by time.
        </div>
      </div>
    `;

    return html;
  }

  shouldTransform(): boolean {
    return false; // Render in screen space
  }
}
