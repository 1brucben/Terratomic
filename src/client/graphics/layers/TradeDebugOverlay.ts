import {
  TradeDebugPayload,
  TradePlayerDebug,
  TradeShipDebug,
} from "../../../core/execution/TradeDebugData";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

/**
 * Debug overlay toggled by F11 that shows per-country trade ship
 * diagnostics: ship positions, phases, docked/stuck status, and
 * distance to target. Designed to help verify whether ships are
 * getting stuck in or near ports.
 *
 * Temporary – remove when trade debugging is done.
 */
export class TradeDebugOverlay implements Layer {
  layerName = "TradeDebugOverlay";
  private container: HTMLDivElement | null = null;
  private visible = false;
  private lastFetch = 0;
  private cachedData: TradeDebugPayload | null = null;
  private fetching = false;
  private selectedPlayer: string | null = null;

  private static readonly REFRESH_INTERVAL = 2000;

  constructor(private game: GameView) {}

  init() {
    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      maxWidth: "95vw",
      maxHeight: "90vh",
      overflowY: "auto",
      overflowX: "auto",
      backgroundColor: "rgba(0, 0, 0, 0.88)",
      color: "#e0e0e0",
      fontFamily: "monospace",
      fontSize: "11px",
      padding: "8px 10px",
      zIndex: "200",
      pointerEvents: "auto",
      display: "none",
      borderRadius: "4px",
      border: "1px solid rgba(255,255,255,0.15)",
    });
    document.body.appendChild(this.container);

    this.container.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const id = target.dataset.playerId;
      if (id !== undefined) {
        this.selectedPlayer = id === this.selectedPlayer ? null : id;
        this.renderContent();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "F11") {
        e.preventDefault();
        this.visible = !this.visible;
        if (this.container) {
          this.container.style.display = this.visible ? "block" : "none";
        }
        if (this.visible) {
          this.fetchData();
        }
      }
    });
  }

  renderLayer(_ctx: CanvasRenderingContext2D) {
    if (!this.visible) return;

    const now = performance.now();
    if (now - this.lastFetch >= TradeDebugOverlay.REFRESH_INTERVAL) {
      this.fetchData();
    }
  }

  private fetchData() {
    if (this.fetching) return;
    this.fetching = true;
    this.lastFetch = performance.now();

    this.game.worker
      .tradeDebug()
      .then((data) => {
        this.cachedData = data;
        this.renderContent();
      })
      .catch((err) => {
        console.warn("TradeDebugOverlay fetch failed:", err);
      })
      .finally(() => {
        this.fetching = false;
      });
  }

  private renderContent() {
    if (!this.container || !this.cachedData) return;

    const data = this.cachedData;

    if (data.players.length === 0) {
      this.container.innerHTML =
        '<div style="padding: 8px;">No players with trade ships.</div>';
      return;
    }

    // Auto-select first player if none selected
    if (
      this.selectedPlayer === null ||
      !data.players.find((d) => d.playerId === this.selectedPlayer)
    ) {
      this.selectedPlayer = data.players[0].playerId;
    }

    // Build tabs
    const tabs = data.players
      .map((d) => {
        const active = d.playerId === this.selectedPlayer;
        const hasStuck = d.stuckAtPort > 0;
        const bg = active
          ? "background: rgba(80,120,200,0.5);"
          : hasStuck
            ? "background: rgba(255,100,100,0.2);"
            : "background: rgba(255,255,255,0.1);";
        return `<span data-player-id="${d.playerId}" style="cursor: pointer; padding: 3px 8px; margin-right: 4px; border-radius: 3px; ${bg}">${this.esc(d.playerName)} (${d.totalShips})</span>`;
      })
      .join("");

    const sel = data.players.find((d) => d.playerId === this.selectedPlayer);
    let body = "";
    if (sel) {
      body = this.renderPlayerDetail(sel);
    }

    const globalSummary = `
      <span style="color: #888; font-size: 10px;">
        Tick: ${data.tick} &nbsp;|&nbsp; Queue: ${data.queueLength} &nbsp;|&nbsp; Total Ships: ${data.totalTradeShips}
      </span>
    `;

    this.container.innerHTML = `
      <div style="margin-bottom: 6px; font-weight: bold; font-size: 12px;">
        Trade Ship Debug <span style="font-weight: normal; color: #888; font-size: 10px;">(F11 to close)</span>
      </div>
      <div style="margin-bottom: 6px;">${globalSummary}</div>
      <div style="margin-bottom: 6px; flex-wrap: wrap;">${tabs}</div>
      ${body}
    `;
  }

  private renderPlayerDetail(d: TradePlayerDebug): string {
    const stuckColor = d.stuckAtPort > 0 ? "#ff5555" : "#88cc88";
    const stationaryColor =
      d.stationaryShips > d.totalShips * 0.5 ? "#ffaa00" : "#88cc88";

    const summary = `
      <div style="margin-bottom: 8px; line-height: 1.6;">
        <b>Ships:</b> ${d.totalShips}
        &nbsp;|&nbsp; <b>Ports:</b> ${d.portCount}
        &nbsp;|&nbsp; <b>Gold/min:</b> ${d.goldPerMinute.toFixed(1)}
        <br>
        <b>Idle:</b> <span style="color: #888;">${d.idleShips}</span>
        &nbsp;|&nbsp; <b>→Start:</b> <span style="color: #cc8844;">${d.toStartShips}</span>
        &nbsp;|&nbsp; <b>→End:</b> <span style="color: #4488cc;">${d.toEndShips}</span>
        &nbsp;|&nbsp; <b>Returning:</b> <span style="color: #ffaa00;">${d.returningShips}</span>
        <br>
        <b>Stuck@Port:</b> <span style="color: ${stuckColor};">${d.stuckAtPort}</span>
        &nbsp;|&nbsp; <b>Stationary:</b> <span style="color: ${stationaryColor};">${d.stationaryShips}</span>
      </div>
    `;

    if (d.ships.length === 0) {
      return summary + '<div style="color: #888;">No trade ships.</div>';
    }

    const rows = d.ships.map((s) => this.renderShipRow(s)).join("");

    const table = `<table style="width: 100%; border-collapse: collapse; margin-top: 4px;">
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
        <th style="text-align: left; padding: 2px 6px;">Ship</th>
        <th style="text-align: center; padding: 2px 6px;">Phase</th>
        <th style="text-align: center; padding: 2px 6px;">Pos</th>
        <th style="text-align: center; padding: 2px 6px;">OnOcean</th>
        <th style="text-align: center; padding: 2px 6px;">AtPort</th>
        <th style="text-align: center; padding: 2px 6px;">Target</th>
        <th style="text-align: right; padding: 2px 6px;">Dist</th>
        <th style="text-align: center; padding: 2px 6px;">OcnAdj</th>
        <th style="text-align: center; padding: 2px 6px;">Still</th>
        <th style="text-align: left; padding: 2px 6px;">Route</th>
        <th style="text-align: left; padding: 2px 6px;">Status</th>
      </tr>
      ${rows}
    </table>`;

    return summary + table;
  }

  private renderShipRow(s: TradeShipDebug): string {
    // Determine status
    const isStuck =
      s.isAtPort &&
      s.stationaryThisTick &&
      s.targetUnitId !== null &&
      s.distToTarget !== null &&
      s.distToTarget <= 2;
    const isPossiblyStuck =
      s.stationaryThisTick && s.targetUnitId !== null && !isStuck;

    let status: string;
    let statusColor: string;
    if (isStuck) {
      status = "STUCK@PORT";
      statusColor = "#ff5555";
    } else if (s.returning) {
      status = "RETURNING";
      statusColor = "#ffaa00";
    } else if (isPossiblyStuck) {
      status = "STATIONARY";
      statusColor = "#ffaa00";
    } else if (s.phase === "idle") {
      status = "IDLE";
      statusColor = "#888";
    } else {
      status = "OK";
      statusColor = "#88cc88";
    }

    const rowBg = isStuck
      ? "background: rgba(255,50,50,0.12);"
      : isPossiblyStuck
        ? "background: rgba(255,170,0,0.07);"
        : "";

    const phaseBadge =
      s.phase === "toStart"
        ? '<span style="color: #cc8844;">→Start</span>'
        : s.phase === "toEnd"
          ? '<span style="color: #4488cc;">→End</span>'
          : '<span style="color: #888;">idle</span>';

    const oceanBadge = s.isOnOcean
      ? '<span style="color: #88cc88;">yes</span>'
      : '<span style="color: #ff5555;">NO</span>';

    const portBadge = s.isAtPort
      ? `<span style="color: #ffaa00;">P${s.dockedPortId}</span>`
      : '<span style="color: #888;">—</span>';

    const targetStr =
      s.targetUnitId !== null
        ? `#${s.targetUnitId} (${s.targetX},${s.targetY})`
        : "—";

    const distStr = s.distToTarget !== null ? String(s.distToTarget) : "—";

    const stillBadge = s.stationaryThisTick
      ? '<span style="color: #ffaa00;">YES</span>'
      : '<span style="color: #888;">no</span>';

    const routeStr =
      s.startOwner || s.endOwner
        ? `${this.esc(s.startOwner ?? "?")} → ${this.esc(s.endOwner ?? "?")}`
        : "—";

    return `<tr style="${rowBg} border-bottom: 1px solid rgba(255,255,255,0.05);">
      <td style="padding: 2px 6px;">#${s.shipId}</td>
      <td style="text-align: center; padding: 2px 6px;">${phaseBadge}</td>
      <td style="text-align: center; padding: 2px 6px;">(${s.x},${s.y})</td>
      <td style="text-align: center; padding: 2px 6px;">${oceanBadge}</td>
      <td style="text-align: center; padding: 2px 6px;">${portBadge}</td>
      <td style="text-align: center; padding: 2px 6px; color: #aaa;">${targetStr}</td>
      <td style="text-align: right; padding: 2px 6px; color: #aaa;">${distStr}</td>
      <td style="text-align: center; padding: 2px 6px; color: #aaa;">${s.adjacentOceanCount}</td>
      <td style="text-align: center; padding: 2px 6px;">${stillBadge}</td>
      <td style="padding: 2px 6px; color: #aaa; font-size: 10px;">${routeStr}</td>
      <td style="padding: 2px 6px; color: ${statusColor}; font-weight: bold;">${status}</td>
    </tr>`;
  }

  private esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
