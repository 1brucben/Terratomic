import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UnitType } from "../core/game/Game";
import {
  isUpgradeableStructure,
  maxStructureLevel,
  tryParseUnitType,
} from "../core/game/Upgradeables";
import "./components/baseComponents/Modal";

interface BuildSettingsItem {
  id: string;
  name: string;
  icon: string;
}

@customElement("build-settings-modal")
export class BuildSettingsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    isModalOpen: boolean;
  };

  @state() private items: BuildSettingsItem[] = [];
  @state() private levels: Record<string, number> = {};

  /** Populate and open the modal. Loads persisted levels; defaults to 1 */
  public open(
    structureTypes: UnitType[] = [],
    unitIconMap: Record<string, string | undefined> = {},
  ) {
    const upgradeables = structureTypes.filter((t) =>
      isUpgradeableStructure(t),
    );
    this.items = upgradeables.map((t) => {
      const id = String(t);
      return {
        id,
        name: id,
        icon: unitIconMap[id] || "",
      };
    });
    const persisted = this._loadPersisted();
    const lvls: Record<string, number> = {};
    this.items.forEach((i) => {
      const raw = persisted[i.id];
      const parsed = typeof raw === "number" && raw >= 1 ? raw : 1;
      lvls[i.id] = this._applyCap(i.id, parsed);
    });
    this.levels = lvls;
    this.updateComplete.then(() => this.modalEl?.open());
  }

  private _loadPersisted(): Record<string, number> {
    try {
      const json = localStorage.getItem("buildSettings.levels") ?? "{}";
      const data = JSON.parse(json);
      if (data && typeof data === "object")
        return data as Record<string, number>;
    } catch (_) {
      /* ignore parse errors */
    }
    return {};
  }

  private _persist() {
    try {
      localStorage.setItem("buildSettings.levels", JSON.stringify(this.levels));
    } catch (_) {
      /* ignore quota issues */
    }
  }

  // Apply structure-specific level caps via shared rule
  private _applyCap(id: string, desired: number): number {
    const t = tryParseUnitType(id);
    if (!t) return Math.max(1, desired);
    return Math.min(maxStructureLevel(t), Math.max(1, desired));
  }

  private _inc(id: string) {
    const next = this._applyCap(id, (this.levels[id] ?? 1) + 1);
    this.levels = { ...this.levels, [id]: next };
    this._persist();
  }
  private _dec(id: string) {
    const cur = this.levels[id] ?? 1;
    const next = Math.max(1, cur - 1);
    this.levels = { ...this.levels, [id]: next };
    this._persist();
  }

  render() {
    // Light DOM: provide styles inline (avoids shadow + Tailwind conflicts).
    return html`
      <o-modal title="Build Settings" max-width="520px" max-height="65dvh">
        <style>
          build-settings-modal .bs-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          build-settings-modal .bs-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 6px 10px;
            border: 1px solid var(--ui-panel-border);
            border-radius: 6px;
            background: var(--ui-primary);
            min-height: 40px;
          }
          build-settings-modal .bs-row:hover {
            background: var(--ui-secondary);
          }
          build-settings-modal .bs-left {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            flex: 1 1 auto;
          }
          build-settings-modal .bs-icon {
            width: 22px;
            height: 22px;
            flex-shrink: 0;
            display: block;
            object-fit: contain;
            filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.35));
          }
          build-settings-modal .bs-name {
            font-size: 13px;
            color: var(--ui-text-default);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1 1 auto;
          }
          build-settings-modal .bs-controls {
            display: inline-flex;
            align-items: center;
            gap: 4px;
          }
          build-settings-modal button.bs-btn {
            width: 24px;
            height: 22px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--ui-panel-border);
            background: #111a2e;
            color: var(--ui-text-default);
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            line-height: 1;
          }
          build-settings-modal button.bs-btn:hover {
            border-color: var(--ui-secondary-hover);
            box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
          }
          build-settings-modal .bs-val {
            min-width: 22px;
            text-align: center;
            font-variant-numeric: tabular-nums;
            font-size: 12px;
          }
          build-settings-modal .hint {
            font-size: 11px;
            color: var(--ui-text-muted, #94a3b8);
            margin-bottom: 8px;
          }
        </style>
        <div class="hint">
          Default structure levels (persistent; capped where applicable)
        </div>
        <div class="bs-list">
          ${this.items.map(
            (i) => html`
              <div class="bs-row" data-id=${i.id}>
                <div class="bs-left">
                  <img
                    class="bs-icon"
                    src=${i.icon}
                    alt=${i.name}
                    width="22"
                    height="22"
                  />
                  <div class="bs-name">${i.name}</div>
                </div>
                <div class="bs-controls">
                  <button
                    class="bs-btn"
                    @click=${() => this._dec(i.id)}
                    title="Decrease"
                  >
                    &#x25BC;
                  </button>
                  <span class="bs-val">${this.levels[i.id] ?? 1}</span>
                  <button
                    class="bs-btn"
                    @click=${() => this._inc(i.id)}
                    title="Increase"
                  >
                    &#x25B2;
                  </button>
                </div>
              </div>
            `,
          )}
        </div>
      </o-modal>
    `;
  }

  createRenderRoot() {
    return this;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "build-settings-modal": BuildSettingsModal;
  }
}
