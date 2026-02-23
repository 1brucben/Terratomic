import { NukeScoreBreakdown } from "../../../core/ai/AINukeHandler";
import {
  ConstructionDebugData,
  ConstructionScoreEntry,
  NukeScoreDebugInfo,
  NukeSequenceDebugInfo,
  UnitScoreEntry,
} from "../../../core/ai/ConstructionDebugData";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

/**
 * Debug overlay toggled by F12 that shows AI construction/spending diagnostics
 * for every AI player: what it's saving up for, structure/unit/nuke scores,
 * active nuke sequence state, and cost breakdowns.
 *
 * Temporary – remove when calibration is done.
 */
export class ConstructionDebugOverlay implements Layer {
  layerName = "ConstructionDebugOverlay";
  private container: HTMLDivElement | null = null;
  private visible = false;
  private lastFetch = 0;
  private cachedData: ConstructionDebugData[] = [];
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
      if (e.key === "F12") {
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
    if (now - this.lastFetch >= ConstructionDebugOverlay.REFRESH_INTERVAL) {
      this.fetchData();
    }
  }

  private fetchData() {
    if (this.fetching) return;
    this.fetching = true;
    this.lastFetch = performance.now();

    this.game.worker
      .constructionDebug()
      .then((data) => {
        this.cachedData = data;
        this.renderContent();
      })
      .catch((err) => {
        console.warn("ConstructionDebugOverlay fetch failed:", err);
      })
      .finally(() => {
        this.fetching = false;
      });
  }

  private renderContent() {
    if (!this.container) return;

    if (this.cachedData.length === 0) {
      this.container.innerHTML =
        '<div style="padding: 8px;">No AI players with construction data.</div>';
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
        const isNuking = d.spendingWinner === "nuke";
        const bg = active
          ? "background: rgba(80,120,200,0.5);"
          : isNuking
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
        AI Construction Debug <span style="font-weight: normal; color: #888; font-size: 10px;">(F12 to close)</span>
      </div>
      <div style="margin-bottom: 6px; flex-wrap: wrap;">${tabs}</div>
      ${body}
    `;
  }

  private renderPlayerDetail(d: ConstructionDebugData): string {
    const winnerColors: Record<string, string> = {
      construction: "#88cc88",
      unit: "#4488cc",
      nuke: "#ff5555",
      none: "#888",
    };
    const winnerColor = winnerColors[d.spendingWinner] ?? "#888";

    const summary = `
      <div style="margin-bottom: 8px; line-height: 1.6;">
        <b>Gold:</b> ${this.formatNum(d.gold)}
        &nbsp;|&nbsp; <b>Income/min:</b> ${this.formatNum(d.goldPerMinute)}
        <br>
        <b>Spending Winner:</b> <span style="color: ${winnerColor}; font-weight: bold; text-transform: uppercase;">${d.spendingWinner}</span>
        <br>
        <b>Best Construction Score:</b> ${this.formatScore(d.bestConstructionScore)}
        &nbsp;|&nbsp; <b>Best Unit Score:</b> ${this.formatScore(d.bestUnitScore)}
        &nbsp;|&nbsp; <b>Adjusted Nuke Score:</b> ${this.formatScore(d.nukeScores.adjustedBestNukeScore)}
      </div>
    `;

    const constructionTable = this.renderConstructionScores(
      d.constructionScores,
    );
    const unitTable = this.renderUnitScores(d.unitScores);
    const nukeSection = this.renderNukeScores(d.nukeScores);
    const nukeSequenceSection = this.renderNukeSequence(d.nukeSequence);

    return (
      summary +
      constructionTable +
      unitTable +
      nukeSection +
      nukeSequenceSection
    );
  }

  private renderConstructionScores(scores: ConstructionScoreEntry[]): string {
    if (scores.length === 0)
      return '<div style="color: #888; margin-bottom: 8px;">No construction candidates.</div>';

    const rows = scores
      .map((s) => {
        const isTop = s === scores[0] && s.score > 0;
        const rowBg = isTop ? "background: rgba(50,200,50,0.07);" : "";
        const upgBadge = s.upgradePreferred
          ? '<span style="color: #ffaa00; margin-left: 4px;">UPG</span>'
          : "";
        return `<tr style="${rowBg} border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 2px 6px;">${this.esc(s.unitType)}${upgBadge}</td>
          <td style="text-align: right; padding: 2px 6px;">${this.formatScore(s.score)}</td>
        </tr>`;
      })
      .join("");

    return `
      <div style="margin-bottom: 8px;">
        <b style="font-size: 11px;">Structure Scores</b>
        <table style="width: 100%; border-collapse: collapse; margin-top: 2px;">
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
            <th style="text-align: left; padding: 2px 6px;">Structure</th>
            <th style="text-align: right; padding: 2px 6px;">Score</th>
          </tr>
          ${rows}
        </table>
      </div>
    `;
  }

  private renderUnitScores(scores: UnitScoreEntry[]): string {
    if (scores.length === 0)
      return '<div style="color: #888; margin-bottom: 8px;">No unit candidates.</div>';

    const rows = scores
      .map((s) => {
        const isTop = s === scores[0] && s.score > 0;
        const rowBg = isTop ? "background: rgba(50,100,200,0.07);" : "";
        return `<tr style="${rowBg} border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 2px 6px;">${this.esc(s.unitType)}</td>
          <td style="text-align: right; padding: 2px 6px;">${this.formatScore(s.score)}</td>
        </tr>`;
      })
      .join("");

    return `
      <div style="margin-bottom: 8px;">
        <b style="font-size: 11px;">Unit Scores</b>
        <table style="width: 100%; border-collapse: collapse; margin-top: 2px;">
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
            <th style="text-align: left; padding: 2px 6px;">Unit</th>
            <th style="text-align: right; padding: 2px 6px;">Score</th>
          </tr>
          ${rows}
        </table>
      </div>
    `;
  }

  private renderNukeScores(n: NukeScoreDebugInfo): string {
    const atomColor = n.bestAtomScore > 0 ? "#ff8888" : "#888";
    const hydroColor = n.bestHydrogenScore > 0 ? "#ff5555" : "#888";

    return `
      <div style="margin-bottom: 8px;">
        <b style="font-size: 11px;">Nuke Scores</b>
        <table style="width: 100%; border-collapse: collapse; margin-top: 2px;">
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
            <th style="text-align: left; padding: 2px 6px;">Type</th>
            <th style="text-align: right; padding: 2px 6px;">Raw Score</th>
            <th style="text-align: left; padding: 2px 6px;">Target</th>
          </tr>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 2px 6px;">Atom Bomb</td>
            <td style="text-align: right; padding: 2px 6px; color: ${atomColor};">${this.formatScore(n.bestAtomScore)}</td>
            <td style="padding: 2px 6px;">${this.esc(n.bestAtomTargetPlayerName)}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 2px 6px;">Hydrogen Bomb</td>
            <td style="text-align: right; padding: 2px 6px; color: ${hydroColor};">${this.formatScore(n.bestHydrogenScore)}</td>
            <td style="padding: 2px 6px;">${this.esc(n.bestHydrogenTargetPlayerName)}</td>
          </tr>
        </table>
        <div style="margin-top: 2px; color: #aaa;">
          Adjusted best nuke score (×multiplier×0.7): <b style="color: ${n.adjustedBestNukeScore > 0 ? "#ff8888" : "#888"};">${this.formatScore(n.adjustedBestNukeScore)}</b>
        </div>
        ${this.renderNukeBreakdown("Atom", n.atomBreakdown)}
        ${this.renderNukeBreakdown("Hydrogen", n.hydrogenBreakdown)}
      </div>
    `;
  }

  private renderNukeBreakdown(
    label: string,
    b: NukeScoreBreakdown | null,
  ): string {
    if (!b) return "";
    const fmt = (v: number) => this.formatScore(v);
    const fmtK = (v: number) =>
      v >= 1_000_000
        ? (v / 1_000_000).toFixed(2) + "M"
        : v >= 1000
          ? (v / 1000).toFixed(1) + "k"
          : v.toFixed(0);
    return `
      <div style="margin-top: 4px; padding: 4px; background: rgba(255,255,255,0.03); border-radius: 3px;">
        <b style="font-size: 10px; color: #ff8888;">${label} Breakdown</b>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 2px;">
          <tr><td style="color:#aaa;padding:1px 4px;">Enemy structs</td><td style="text-align:right;padding:1px 4px;">${b.enemyStructureCount}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">Raw enemy value</td><td style="text-align:right;padding:1px 4px;">${fmtK(b.rawEnemyValue)}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">Strongest enemy?</td><td style="text-align:right;padding:1px 4px;">${b.isStrongestEnemy ? "Yes (+1000/struct)" : "No"}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">War score (raw)</td><td style="text-align:right;padding:1px 4px;">${b.rawWarScore.toFixed(1)}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">War score sigmoid</td><td style="text-align:right;padding:1px 4px;">${b.warScoreSigmoid.toFixed(4)}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">Friendly structs</td><td style="text-align:right;padding:1px 4px;">${b.friendlyStructureCount}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">Friendly value</td><td style="text-align:right;padding:1px 4px;">${fmtK(b.friendlyValue)}</td></tr>
          <tr style="border-top:1px solid rgba(255,255,255,0.1);"><td style="color:#ccc;padding:1px 4px;"><b>Numerator</b></td><td style="text-align:right;padding:1px 4px;"><b>${fmt(b.numerator)}</b></td></tr>
          <tr><td colspan="2" style="padding:2px 4px;color:#666;">───── Cost / Discount ─────</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">Bomb cost</td><td style="text-align:right;padding:1px 4px;">${fmtK(b.bombCost)}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">SAM levels</td><td style="text-align:right;padding:1px 4px;">${b.samLevels}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">Silo cost (amort.)</td><td style="text-align:right;padding:1px 4px;">${fmtK(b.siloCost)}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">Total cost</td><td style="text-align:right;padding:1px 4px;">${fmtK(b.totalCost)}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">Gold/min</td><td style="text-align:right;padding:1px 4px;">${fmtK(b.goldPerMinute)}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">T (minutes)</td><td style="text-align:right;padding:1px 4px;">${b.T === Infinity ? "∞" : b.T.toFixed(2)}</td></tr>
          <tr><td style="color:#aaa;padding:1px 4px;">(1+r)^T</td><td style="text-align:right;padding:1px 4px;">${b.discountFactor >= 1e6 ? b.discountFactor.toExponential(2) : b.discountFactor.toFixed(4)}</td></tr>
          <tr style="border-top:1px solid rgba(255,255,255,0.1);"><td style="color:#ff8888;padding:1px 4px;"><b>Final Score</b></td><td style="text-align:right;padding:1px 4px;color:#ff8888;"><b>${fmt(b.finalScore)}</b></td></tr>
        </table>
      </div>
    `;
  }

  private renderNukeSequence(seq: NukeSequenceDebugInfo | null): string {
    if (!seq) {
      return '<div style="color: #888; margin-bottom: 8px;"><b>Nuke Sequence:</b> idle</div>';
    }

    const phaseColors: Record<string, string> = {
      waitForFunds: "#ffaa00",
      buildSilo: "#ff8844",
      launchSAMs: "#ff5555",
      waitForMain: "#ff4444",
      launchMain: "#ff0000",
    };
    const phaseColor = phaseColors[seq.phase] ?? "#888";

    return `
      <div style="margin-bottom: 8px; border: 1px solid rgba(255,80,80,0.3); padding: 6px; border-radius: 4px; background: rgba(255,50,50,0.05);">
        <b style="font-size: 11px; color: #ff5555;">Active Nuke Sequence</b>
        <table style="width: 100%; border-collapse: collapse; margin-top: 4px;">
          <tr>
            <td style="padding: 2px 6px; color: #aaa;">Phase:</td>
            <td style="padding: 2px 6px; color: ${phaseColor}; font-weight: bold;">${this.esc(seq.phase)}</td>
          </tr>
          <tr>
            <td style="padding: 2px 6px; color: #aaa;">Bomb Type:</td>
            <td style="padding: 2px 6px;">${this.esc(seq.bombType)}</td>
          </tr>
          <tr>
            <td style="padding: 2px 6px; color: #aaa;">Target Player:</td>
            <td style="padding: 2px 6px;">${this.esc(seq.targetPlayerName)}</td>
          </tr>
          <tr>
            <td style="padding: 2px 6px; color: #aaa;">SAM Nukes Needed:</td>
            <td style="padding: 2px 6px;">${seq.samNukesNeeded}</td>
          </tr>
          <tr>
            <td style="padding: 2px 6px; color: #aaa;">Silo Capacity:</td>
            <td style="padding: 2px 6px;">${seq.siloCapacity}</td>
          </tr>
          <tr>
            <td style="padding: 2px 6px; color: #aaa;">Total Bombs Needed:</td>
            <td style="padding: 2px 6px;">${seq.bombsNeeded}</td>
          </tr>
          <tr>
            <td style="padding: 2px 6px; color: #aaa;">Est. Total Cost:</td>
            <td style="padding: 2px 6px;">${this.formatNum(seq.estimatedTotalCost)}</td>
          </tr>
          <tr>
            <td style="padding: 2px 6px; color: #aaa;">Current Score:</td>
            <td style="padding: 2px 6px;">${this.formatScore(seq.currentScore)}</td>
          </tr>
        </table>
      </div>
    `;
  }

  private formatScore(n: number): string {
    if (n === 0) return '<span style="color: #666;">0</span>';
    if (Math.abs(n) >= 1e6) return n.toExponential(2);
    if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString();
    if (Math.abs(n) >= 1) return n.toFixed(1);
    return n.toExponential(2);
  }

  private formatNum(n: number): string {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return Math.round(n).toString();
  }

  private esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
