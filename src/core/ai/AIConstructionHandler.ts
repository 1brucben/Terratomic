import { ConstructionExecution } from "../execution/ConstructionExecution";
import { Game, Player, PlayerID, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles structure construction for AI players.
 * Builds cities, factories, and ports based on density parameters.
 */
export class AIConstructionHandler {
  private target: UnitType | null = null;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {}

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  tickConstruction(): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    const numTiles = player.numTilesOwned();
    if (numTiles === 0) {
      return;
    }

    if (this.target === null) {
      this.target = this.pickTarget(null, player);
      return;
    }

    // Only attempt placement if we can afford the target structure
    if (!this.canAffordTarget(player, this.target)) {
      return;
    }

    const placement = this.findPlacement(player, this.target, 200);
    if (placement !== null) {
      this.mg.addExecution(
        new ConstructionExecution(player, this.target, placement),
      );
      this.target = null;
      return;
    }

    // Failed to place after N attempts: pick a different target (re-score)
    const original = this.target;
    const next = this.pickTarget(original, player);
    this.target = next;
  }

  private candidateTargets(): UnitType[] {
    const candidates: UnitType[] = [];
    if (this.params.buildCities ?? true) candidates.push(UnitType.City);
    if (this.params.buildFactories ?? true) candidates.push(UnitType.Factory);
    if (this.params.buildPorts ?? true) candidates.push(UnitType.Port);
    return candidates;
  }

  private scoreTarget(_player: Player, _unitType: UnitType): number {
    // Placeholder: all structures have equal score for now.
    return 0;
  }

  private pickTarget(
    exclude: UnitType | null,
    player: Player,
  ): UnitType | null {
    const candidates = this.candidateTargets().filter((t) =>
      exclude === null ? true : t !== exclude,
    );

    if (candidates.length === 0) {
      return null;
    }

    let bestScore = -Infinity;
    let best: UnitType[] = [];
    for (const t of candidates) {
      const s = this.scoreTarget(player, t);
      if (s > bestScore) {
        bestScore = s;
        best = [t];
      } else if (s === bestScore) {
        best.push(t);
      }
    }

    return this.random.randElement(best);
  }

  private canAffordTarget(player: Player, unitType: UnitType): boolean {
    const cost = this.mg.unitInfo(unitType).cost(player);
    return player.gold() >= cost;
  }

  private findPlacement(
    player: Player,
    unitType: UnitType,
    maxAttempts: number,
  ): TileRef | null {
    const ownedTiles = Array.from(player.tiles());
    if (ownedTiles.length === 0) {
      return null;
    }

    for (let i = 0; i < maxAttempts; i++) {
      const tile = this.random.randElement(ownedTiles);
      const canBuild = player.canBuild(unitType, tile);
      if (canBuild !== false) {
        return tile;
      }
    }

    return null;
  }
}
