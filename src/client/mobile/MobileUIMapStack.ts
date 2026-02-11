import { Cell, UnitType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import type { GameView, PlayerView, UnitView } from "../../core/game/GameView";
import { isUpgradeableStructure } from "../../core/game/Upgradeables";
import type { TransformHandler } from "../graphics/TransformHandler";

const STACKABLE_STRUCTURE_TYPES: UnitType[] = [
  UnitType.City,
  UnitType.Port,
  UnitType.Airfield,
  UnitType.Hospital,
  UnitType.Academy,
  UnitType.ResearchLab,
  UnitType.Factory,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
];

const STACK_TAP_SCREEN_HIT_RADIUS_PX = 28;
const STACK_TAP_STICKY_RADIUS_PX = 72;

export function screenToTile(params: {
  position: { x: number; y: number };
  game: GameView | null;
  transformHandler: TransformHandler | null;
}): TileRef | null {
  const { position, game, transformHandler } = params;

  if (!game || !transformHandler) {
    return null;
  }

  const cell = transformHandler.screenToWorldCoordinates(
    position.x,
    position.y,
  );

  if (!game.isValidCoord(cell.x, cell.y)) {
    return null;
  }

  return game.ref(cell.x, cell.y);
}

function screenDistanceSquaredToUnit(params: {
  position: { x: number; y: number };
  unit: UnitView;
  game: GameView | null;
  transformHandler: TransformHandler | null;
}): number {
  const { position, unit, game, transformHandler } = params;

  if (!game || !transformHandler) {
    return Number.POSITIVE_INFINITY;
  }

  const tile = unit.tile();
  const cell = new Cell(game.x(tile), game.y(tile));
  const screenPos = transformHandler.worldToScreenCoordinates(cell);
  const dx = screenPos.x - position.x;
  const dy = screenPos.y - position.y;
  return dx * dx + dy * dy;
}

function getStickyStackTarget(params: {
  myPlayer: PlayerView;
  game: GameView | null;
  stackTargetUnitId: number | null;
}): { stickyTarget: UnitView | null; nextStackTargetUnitId: number | null } {
  const { myPlayer, game, stackTargetUnitId } = params;

  if (stackTargetUnitId === null) {
    return { stickyTarget: null, nextStackTargetUnitId: null };
  }

  const target = game?.unit(stackTargetUnitId);
  if (!target) {
    return { stickyTarget: null, nextStackTargetUnitId: null };
  }

  if (
    !target.isActive() ||
    target.owner().id() !== myPlayer.id() ||
    !isUpgradeableStructure(target.type())
  ) {
    return { stickyTarget: null, nextStackTargetUnitId: null };
  }

  return { stickyTarget: target, nextStackTargetUnitId: stackTargetUnitId };
}

export function findUpgradeableStructureForStackTap(params: {
  tile: TileRef;
  myPlayer: PlayerView;
  position?: { x: number; y: number };
  game: GameView | null;
  transformHandler: TransformHandler | null;
  stackTargetUnitId: number | null;
}): { structure: UnitView | null; nextStackTargetUnitId: number | null } {
  const { myPlayer, position, game, transformHandler, stackTargetUnitId } =
    params;

  if (!game || !position) {
    return { structure: null, nextStackTargetUnitId: stackTargetUnitId };
  }

  const { stickyTarget, nextStackTargetUnitId } = getStickyStackTarget({
    myPlayer,
    game,
    stackTargetUnitId,
  });

  if (
    stickyTarget &&
    screenDistanceSquaredToUnit({
      position,
      unit: stickyTarget,
      game,
      transformHandler,
    }) <=
      STACK_TAP_STICKY_RADIUS_PX * STACK_TAP_STICKY_RADIUS_PX
  ) {
    return { structure: stickyTarget, nextStackTargetUnitId };
  }

  const byScreenDistance = myPlayer
    .units(...STACKABLE_STRUCTURE_TYPES)
    .filter((unit) => unit.isActive() && isUpgradeableStructure(unit.type()))
    .map((unit) => ({
      unit,
      screenDistSquared: screenDistanceSquaredToUnit({
        position,
        unit,
        game,
        transformHandler,
      }),
    }))
    .sort((a, b) => a.screenDistSquared - b.screenDistSquared);

  const withinHitRadius = byScreenDistance.find(
    (entry) =>
      entry.screenDistSquared <=
      STACK_TAP_SCREEN_HIT_RADIUS_PX * STACK_TAP_SCREEN_HIT_RADIUS_PX,
  );

  if (!withinHitRadius) {
    return { structure: null, nextStackTargetUnitId };
  }

  return {
    structure: (withinHitRadius.unit as UnitView) ?? null,
    nextStackTargetUnitId,
  };
}
