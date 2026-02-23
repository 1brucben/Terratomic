import {
  AttackDebugData,
  AttackTargetBreakdown,
} from "../../../core/ai/AIAttackHandler";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

/**
 * Debug overlay toggled by F10 that shows AI attack diagnostics
 * for every AI player: troop thresholds, boat status, per-enemy
 * attack path and block reasons.
 *
 * Temporary – remove when calibration is done.
 */
export class AttackDebugOverlay implements Layer {
  layerName = "AttackDebugOverlay";
  private container: HTMLDivElement | null = null;
  private visible = false;
  private lastFetch = 0;
  private cachedData: AttackDebugData[] = [];
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
      if (e.key === "F10") {
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
    if (now - this.lastFetch >= AttackDebugOverlay.REFRESH_INTERVAL) {
      this.fetchData();
    }
  }

  private fetchData() {
    if (this.fetching) return;
    this.fetching = true;
    this.lastFetch = performance.now();

    this.game.worker
      .attackDebug()
      .then((data) => {
        this.cachedData = data;
        this.renderContent();
      })
      .catch((err) => {
        console.warn("AttackDebugOverlay fetch failed:", err);
      })
      .finally(() => {
        this.fetching = false;
      });
  }

  private renderContent() {
    if (!this.container) return;

    if (this.cachedData.length === 0) {
      this.container.innerHTML =
        '<div style="padding: 8px;">No AI players with attack data.</div>';
      return;
    }

    // Auto-select first player if none selected
    if (
      this.selectedPlayer === null ||
      !this.cachedData.find((d) => d.playerId === this.selectedPlayer)
    ) {
      this.selectedPlayer = this.cachedData[0].playerId;
    }

    // Build tabs
    const tabs = this.cachedData
      .map((d) => {
        const active = d.playerId === this.selectedPlayer;
        const hasWar = d.targets.length > 0;
        const bg = active
          ? "background: rgba(80,120,200,0.5);"
          : hasWar
            ? "background: rgba(255,100,100,0.2);"
            : "background: rgba(255,255,255,0.1);";
        return `<span data-player-id="${d.playerId}" style="cursor: pointer; padding: 3px 8px; margin-right: 4px; border-radius: 3px; ${bg}">${this.esc(d.playerName)}</span>`;
      })
      .join("");

    const sel = this.cachedData.find((d) => d.playerId === this.selectedPlayer);
    let body = "";
    if (sel) {
      body = this.renderPlayerDetail(sel);
    }

    this.container.innerHTML = `
      <div style="margin-bottom: 6px; font-weight: bold; font-size: 12px;">
        AI Attack Debug <span style="font-weight: normal; color: #888; font-size: 10px;">(F10 to close)</span>
      </div>
      <div style="margin-bottom: 6px; flex-wrap: wrap;">${tabs}</div>
      ${body}
    `;
  }

  private renderPlayerDetail(d: AttackDebugData): string {
    const reached = d.handleAttackReached
      ? '<span style="color: #88cc88;">YES</span>'
      : '<span style="color: #ff5555;">NO (suppressed by TN/Bot)</span>';

    const troopColor =
      d.troopRatio >= d.attackThreshold ? "#88cc88" : "#ff5555";
    const defColor =
      d.defendingRatio >= d.defendingTarget ? "#88cc88" : "#ff5555";
    const oceanColor = d.bordersOcean ? "#88cc88" : "#ff5555";
    const boatColor = d.boatCount < d.boatMax ? "#88cc88" : "#ff5555";
    const cooldownOk =
      d.ticksSinceLastBoat >= d.boatCooldown ? "#88cc88" : "#ffaa00";

    const summary = `
      <div style="margin-bottom: 8px; line-height: 1.6;">
        <b>handleAttack reached:</b> ${reached}
        &nbsp;|&nbsp; <b>last tick:</b> ${d.lastHandleAttackTick}
        <br>
        <b>troopRatio:</b> <span style="color:${troopColor}">${d.troopRatio.toFixed(3)}</span> / ${d.attackThreshold.toFixed(3)}
        &nbsp;|&nbsp; <b>defendingRatio:</b> <span style="color:${defColor}">${d.defendingRatio.toFixed(3)}</span> / ${d.defendingTarget.toFixed(3)}
        <br>
        <b>bordersOcean:</b> <span style="color:${oceanColor}">${d.bordersOcean}</span>
        &nbsp;|&nbsp; <b>oceanShore:</b> ${d.oceanShoreTileCount} tiles
        &nbsp;|&nbsp; <b>boats:</b> <span style="color:${boatColor}">${d.boatCount}/${d.boatMax}</span>
        &nbsp;|&nbsp; <b>boatCooldown:</b> <span style="color:${cooldownOk}">${d.ticksSinceLastBoat}/${d.boatCooldown}</span>
        &nbsp;|&nbsp; <b>boatRange:</b> ${d.boatSearchRange.toFixed(1)}
      </div>
    `;

    if (d.targets.length === 0) {
      return summary + '<div style="color: #888;">No enemies at war.</div>';
    }

    const rows = d.targets.map((t) => this.renderTargetRow(t)).join("");

    const table = `<table style="width: 100%; border-collapse: collapse; margin-top: 4px;">
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
        <th style="text-align: left; padding: 2px 6px;">Enemy</th>
        <th style="text-align: center; padding: 2px 6px;">Border</th>
        <th style="text-align: center; padding: 2px 6px;">Path</th>
        <th style="text-align: center; padding: 2px 6px;">EnemyOcean</th>
        <th style="text-align: right; padding: 2px 6px;">BoatDist</th>
        <th style="text-align: left; padding: 2px 6px;">Status / Block Reason</th>
      </tr>
      ${rows}
    </table>`;

    return summary + table;
  }

  private renderTargetRow(t: AttackTargetBreakdown): string {
    const borderBadge = t.sharesBorder
      ? '<span style="color: #ffaa00;">YES</span>'
      : '<span style="color: #888;">no</span>';

    const pathBadge =
      t.attackPath === "land"
        ? '<span style="color: #cc8844;">LAND</span>'
        : t.attackPath === "boat"
          ? '<span style="color: #4488cc;">BOAT</span>'
          : '<span style="color: #888;">—</span>';

    const oceanBadge = t.enemyBordersOcean
      ? '<span style="color: #88cc88;">yes</span>'
      : '<span style="color: #ff5555;">NO</span>';

    const isOk = t.blockReason.startsWith("OK");
    const statusColor = isOk ? "#88cc88" : "#ff5555";

    const rowBg = isOk
      ? "background: rgba(50,200,50,0.07);"
      : "background: rgba(255,50,50,0.07);";

    return `<tr style="${rowBg} border-bottom: 1px solid rgba(255,255,255,0.05);">
      <td style="padding: 2px 6px;">${this.esc(t.targetName)}</td>
      <td style="text-align: center; padding: 2px 6px;">${borderBadge}</td>
      <td style="text-align: center; padding: 2px 6px;">${pathBadge}</td>
      <td style="text-align: center; padding: 2px 6px;">${oceanBadge}</td>
      <td style="text-align: right; padding: 2px 6px; color: #aaa;">${t.boatDistance > 0 ? t.boatDistance : "—"}</td>
      <td style="padding: 2px 6px; color: ${statusColor};">${this.esc(t.blockReason)}</td>
    </tr>`;
  }

  private esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
