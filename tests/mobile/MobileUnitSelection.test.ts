/** @jest-environment jsdom */

import {
  findSelectableUnitsNearTap,
  isValidRedirectTarget,
  SELECTABLE_UNIT_TYPES,
} from "../../src/client/mobile/MobileUnitSelection";
import { Cell, UnitType } from "../../src/core/game/Game";

// --- Helpers to build minimal mocks ---

function mockUnit(overrides: {
  type: UnitType;
  id: number;
  tile: { x: number; y: number };
  isActive?: boolean;
  ownedByMe?: boolean;
}) {
  const tileRef = {} as any; // opaque TileRef
  const ownerObj = { _me: overrides.ownedByMe ?? true };
  return {
    type: () => overrides.type,
    id: () => overrides.id,
    tile: () => tileRef,
    isActive: () => overrides.isActive ?? true,
    owner: () => ownerObj,
    _tileCoords: overrides.tile,
    _ownerObj: ownerObj,
  };
}

function mockGame(params: {
  units: ReturnType<typeof mockUnit>[];
  myPlayerOwner: object;
}) {
  return {
    myPlayer: () => params.myPlayerOwner,
    units: (unitType: UnitType) =>
      params.units.filter((u) => u.type() === unitType),
    x: (_ref: any) => {
      const unit = params.units.find((u) => u.tile() === _ref);
      return unit?._tileCoords.x ?? 0;
    },
    y: (_ref: any) => {
      const unit = params.units.find((u) => u.tile() === _ref);
      return unit?._tileCoords.y ?? 0;
    },
    isOcean: (tile: any) => tile._isOcean ?? false,
    isLand: (tile: any) => !(tile._isOcean ?? false),
  } as any;
}

function mockTransformHandler(scale: number = 1) {
  return {
    worldToScreenCoordinates: (cell: Cell) => ({
      x: cell.x * scale,
      y: cell.y * scale,
    }),
  } as any;
}

// --- Tests ---

describe("MobileUnitSelection", () => {
  describe("findSelectableUnitsNearTap", () => {
    test("finds own warship within 40px hit radius", () => {
      const owner = { _me: true };
      const warship = mockUnit({
        type: UnitType.Warship,
        id: 1,
        tile: { x: 100, y: 100 },
      });
      warship._ownerObj = owner;
      (warship as any).owner = () => owner;

      const game = mockGame({ units: [warship], myPlayerOwner: owner });
      const result = findSelectableUnitsNearTap({
        position: { x: 110, y: 105 }, // ~11px away
        game,
        transformHandler: mockTransformHandler(),
      });

      expect(result).toHaveLength(1);
      expect(result[0].unit.id()).toBe(1);
    });

    test("ignores units beyond 40px hit radius", () => {
      const owner = { _me: true };
      const warship = mockUnit({
        type: UnitType.Warship,
        id: 1,
        tile: { x: 100, y: 100 },
      });
      (warship as any).owner = () => owner;

      const game = mockGame({ units: [warship], myPlayerOwner: owner });
      const result = findSelectableUnitsNearTap({
        position: { x: 200, y: 200 }, // ~141px away
        game,
        transformHandler: mockTransformHandler(),
      });

      expect(result).toHaveLength(0);
    });

    test("ignores enemy units", () => {
      const myOwner = { _me: true };
      const enemyOwner = { _me: false };
      const enemyShip = mockUnit({
        type: UnitType.Warship,
        id: 2,
        tile: { x: 100, y: 100 },
      });
      (enemyShip as any).owner = () => enemyOwner;

      const game = mockGame({ units: [enemyShip], myPlayerOwner: myOwner });
      const result = findSelectableUnitsNearTap({
        position: { x: 100, y: 100 }, // dead center
        game,
        transformHandler: mockTransformHandler(),
      });

      expect(result).toHaveLength(0);
    });

    test("ignores inactive units", () => {
      const owner = { _me: true };
      const dead = mockUnit({
        type: UnitType.Submarine,
        id: 3,
        tile: { x: 100, y: 100 },
        isActive: false,
      });
      (dead as any).owner = () => owner;

      const game = mockGame({ units: [dead], myPlayerOwner: owner });
      const result = findSelectableUnitsNearTap({
        position: { x: 100, y: 100 },
        game,
        transformHandler: mockTransformHandler(),
      });

      expect(result).toHaveLength(0);
    });

    test("sorts by distance (closest first)", () => {
      const owner = { _me: true };
      const far = mockUnit({
        type: UnitType.Warship,
        id: 1,
        tile: { x: 130, y: 100 }, // 30px away
      });
      const close = mockUnit({
        type: UnitType.FighterJet,
        id: 2,
        tile: { x: 105, y: 100 }, // 5px away
      });
      [far, close].forEach((u) => ((u as any).owner = () => owner));

      const game = mockGame({ units: [far, close], myPlayerOwner: owner });
      const result = findSelectableUnitsNearTap({
        position: { x: 100, y: 100 },
        game,
        transformHandler: mockTransformHandler(),
      });

      expect(result).toHaveLength(2);
      expect(result[0].unit.id()).toBe(2); // closer
      expect(result[1].unit.id()).toBe(1); // farther
    });

    test("covers all four selectable unit types", () => {
      expect(SELECTABLE_UNIT_TYPES).toContain(UnitType.Warship);
      expect(SELECTABLE_UNIT_TYPES).toContain(UnitType.Submarine);
      expect(SELECTABLE_UNIT_TYPES).toContain(UnitType.FighterJet);
      expect(SELECTABLE_UNIT_TYPES).toContain(UnitType.Artillery);
    });
  });

  describe("isValidRedirectTarget", () => {
    const oceanTile = { _isOcean: true } as any;
    const landTile = { _isOcean: false } as any;
    const game = {
      isOcean: (t: any) => t._isOcean === true,
    } as any;

    test("warship can only go to ocean", () => {
      expect(isValidRedirectTarget(UnitType.Warship, oceanTile, game)).toBe(
        true,
      );
      expect(isValidRedirectTarget(UnitType.Warship, landTile, game)).toBe(
        false,
      );
    });

    test("submarine can only go to ocean", () => {
      expect(isValidRedirectTarget(UnitType.Submarine, oceanTile, game)).toBe(
        true,
      );
      expect(isValidRedirectTarget(UnitType.Submarine, landTile, game)).toBe(
        false,
      );
    });

    test("artillery can only go to land", () => {
      expect(isValidRedirectTarget(UnitType.Artillery, landTile, game)).toBe(
        true,
      );
      expect(isValidRedirectTarget(UnitType.Artillery, oceanTile, game)).toBe(
        false,
      );
    });

    test("fighter jet can go anywhere", () => {
      expect(isValidRedirectTarget(UnitType.FighterJet, oceanTile, game)).toBe(
        true,
      );
      expect(isValidRedirectTarget(UnitType.FighterJet, landTile, game)).toBe(
        true,
      );
    });

    test("non-selectable unit returns false", () => {
      expect(isValidRedirectTarget(UnitType.City, landTile, game)).toBe(false);
    });
  });
});
