import { WarScoreDebugData } from "../../../core/ai/AIDiplomacyHandler";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

/**
 * Debug overlay toggled by F9 that shows war score breakdowns
 * for every AI player vs every other AI/Human player.
 *
 * Temporary – remove when calibration is done.
 */
export class WarScoreOverlay implements Layer {
  layerName = "WarScoreOverlay";
  private container: HTMLDivElement | null = null;
  private visible = false;
  private lastFetch = 0;
  private cachedData: WarScoreDebugData[] = [];
  private fetching = false;
  private selectedPlayer: string | null = null; // PlayerID to show detail for

  // How often to re-fetch from worker (ms)
  private static readonly REFRESH_INTERVAL = 2000;

  constructor(private game: GameView) {}

  init() {
    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "fixed",
      top: "10px",
      left: "10px",
      maxWidth: "95vw",
      maxHeight: "90vh",
      overflowY: "auto",
      overflowX: "auto",
      backgroundColor: "rgba(0, 0, 0, 0.85)",
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

    // Click delegation for player selection tabs
    this.container.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const id = target.dataset.playerId;
      if (id !== undefined) {
        this.selectedPlayer = id === this.selectedPlayer ? null : id;
        this.renderContent();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "F9") {
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
    if (now - this.lastFetch >= WarScoreOverlay.REFRESH_INTERVAL) {
      this.fetchData();
    }
  }

  private fetchData() {
    if (this.fetching) return;
    this.fetching = true;
    this.lastFetch = performance.now();

    this.game.worker
      .warScoreDebug()
      .then((data) => {
        this.cachedData = data;
        this.renderContent();
      })
      .catch((err) => {
        console.warn("WarScoreOverlay fetch failed:", err);
      })
      .finally(() => {
        this.fetching = false;
      });
  }

  private renderContent() {
    if (!this.container) return;

    if (this.cachedData.length === 0) {
      this.container.innerHTML =
        '<div style="padding: 8px;">No AI players with war score data.</div>';
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
        const bg = active
          ? "background: rgba(80,120,200,0.5);"
          : "background: rgba(255,255,255,0.1);";
        return `<span data-player-id="${d.playerId}" style="cursor: pointer; padding: 3px 8px; margin-right: 4px; border-radius: 3px; ${bg}">${this.escHtml(d.playerName)}</span>`;
      })
      .join("");

    const selected = this.cachedData.find(
      (d) => d.playerId === this.selectedPlayer,
    );
    let table = "";
    if (selected) {
      // Sort breakdowns: at war first, then by total descending
      const sorted = [...selected.breakdowns].sort((a, b) => {
        if (a.isAtWar !== b.isAtWar) return a.isAtWar ? -1 : 1;
        return b.total - a.total;
      });

      table = `<table style="width: 100%; border-collapse: collapse; margin-top: 6px;">
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
          <th style="text-align: left; padding: 2px 6px;">Target</th>
          <th style="text-align: right; padding: 2px 6px;">Total</th>
          <th style="text-align: right; padding: 2px 6px;">MovAvg</th>
          <th style="text-align: right; padding: 2px 6px;">Thresh</th>
          <th style="text-align: right; padding: 2px 6px;">Border</th>
          <th style="text-align: right; padding: 2px 6px;">Military</th>
          <th style="text-align: right; padding: 2px 6px;">AllyPen</th>
          <th style="text-align: right; padding: 2px 6px;">DistPen</th>
          <th style="text-align: right; padding: 2px 6px;">Domn</th>
          <th style="text-align: right; padding: 2px 6px;">MilShr</th>
          <th style="text-align: right; padding: 2px 6px;">Status</th>
        </tr>
        ${sorted.map((b) => this.renderRow(b)).join("")}
      </table>`;
    }

    this.container.innerHTML = `
      <div style="margin-bottom: 6px; font-weight: bold; font-size: 12px;">
        War Score Debug <span style="font-weight: normal; color: #888; font-size: 10px;">(F9 to close)</span>
      </div>
      <div style="margin-bottom: 6px;">${tabs}</div>
      ${table}
    `;
  }

  private renderRow(b: {
    targetName: string;
    total: number;
    movingAverage: number;
    threshold: number;
    borderScore: number;
    militaryScore: number;
    allyPenalty: number;
    distancePenalty: number;
    dominanceBonus: number;
    militaryStrengthShare: number;
    isAtWar: boolean;
    isFriendly: boolean;
    unreachable: boolean;
  }): string {
    let status = "";
    let rowBg = "";
    if (b.isAtWar) {
      status = '<span style="color: #ff5555;">WAR</span>';
      rowBg = "background: rgba(255,50,50,0.1);";
    } else if (b.isFriendly) {
      status = '<span style="color: #55ff55;">ALLY</span>';
      rowBg = "background: rgba(50,255,50,0.05);";
    } else if (b.unreachable) {
      status = '<span style="color: #888;">UNREACH</span>';
    } else if (b.movingAverage >= b.threshold) {
      status = '<span style="color: #ffaa00;">READY</span>';
      rowBg = "background: rgba(255,170,0,0.1);";
    } else {
      status = '<span style="color: #888;">—</span>';
    }

    const fmt = (v: number) => v.toFixed(1);
    const colorNum = (v: number) => {
      if (v > 0.5) return `<span style="color: #88cc88;">${fmt(v)}</span>`;
      if (v < -0.5) return `<span style="color: #cc8888;">${fmt(v)}</span>`;
      return `<span style="color: #888;">${fmt(v)}</span>`;
    };

    return `<tr style="${rowBg} border-bottom: 1px solid rgba(255,255,255,0.05);">
      <td style="padding: 2px 6px;">${this.escHtml(b.targetName)}</td>
      <td style="text-align: right; padding: 2px 6px; font-weight: bold;">${colorNum(b.total)}</td>
      <td style="text-align: right; padding: 2px 6px;">${colorNum(b.movingAverage)}</td>
      <td style="text-align: right; padding: 2px 6px; color: #aaa;">${fmt(b.threshold)}</td>
      <td style="text-align: right; padding: 2px 6px;">${colorNum(b.borderScore)}</td>
      <td style="text-align: right; padding: 2px 6px;">${colorNum(b.militaryScore)}</td>
      <td style="text-align: right; padding: 2px 6px;">${colorNum(-b.allyPenalty)}</td>
      <td style="text-align: right; padding: 2px 6px;">${colorNum(-b.distancePenalty)}</td>
      <td style="text-align: right; padding: 2px 6px;">${colorNum(b.dominanceBonus)}</td>
      <td style="text-align: right; padding: 2px 6px; color: #aaa;">${(b.militaryStrengthShare * 100).toFixed(1)}%</td>
      <td style="text-align: right; padding: 2px 6px;">${status}</td>
    </tr>`;
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
