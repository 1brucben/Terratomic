/** @jest-environment jsdom */

import {
  MobileActionGrid,
  type ActionGridItem,
} from "../../src/client/mobile/MobileActionGrid";
import {
  HapticFeedback,
  HapticPattern,
} from "../../src/client/mobile/utils/HapticFeedback";
import { UnitType } from "../../src/core/game/Game";

describe("MobileActionGrid", () => {
  let grid: MobileActionGrid;

  beforeEach(() => {
    grid = new MobileActionGrid();
    document.body.appendChild(grid);
  });

  afterEach(() => {
    grid.remove();
    jest.restoreAllMocks();
  });

  test("categorizes neutral water tiles as neutral-can-attack", async () => {
    const tile = {} as any;
    const myPlayer = {
      actions: jest.fn().mockResolvedValue({
        canAttack: false,
        buildableUnits: [],
      }),
    };

    const game = {
      myPlayer: () => myPlayer,
      owner: () => ({ isPlayer: () => false }),
      isLand: () => false,
      isShoreline: () => false,
    };

    const category = await (grid as any).determineTileCategory(tile, game);
    expect(category).toBe("neutral-can-attack");
  });

  test("categorizes enemy land as enemy-can-boat-attack when transport is buildable", async () => {
    const tile = {} as any;
    const myPlayer = {
      actions: jest.fn().mockResolvedValue({
        canAttack: false,
        buildableUnits: [{ type: UnitType.TransportShip, canBuild: true }],
      }),
    };

    const game = {
      myPlayer: () => myPlayer,
      owner: () => ({ isPlayer: () => true }),
      isLand: () => true,
      isShoreline: () => false,
    };

    const category = await (grid as any).determineTileCategory(tile, game);
    expect(category).toBe("enemy-can-boat-attack");
  });

  test("uses error haptic and blocks dispatch for disabled action", () => {
    const triggerSpy = jest
      .spyOn(HapticFeedback, "trigger")
      .mockImplementation(() => {});
    const selectedSpy = jest.fn();
    grid.addEventListener("action-selected", selectedSpy);

    const disabledItem: ActionGridItem = {
      id: "build:city",
      icon: "🏙️",
      label: "City",
      disabled: true,
    };

    (grid as any).handleActionClick(disabledItem);

    expect(triggerSpy).toHaveBeenCalledWith(HapticPattern.ERROR);
    expect(selectedSpy).not.toHaveBeenCalled();
  });

  test("uses tap haptic and dispatches event for enabled action", () => {
    const triggerSpy = jest
      .spyOn(HapticFeedback, "trigger")
      .mockImplementation(() => {});
    const selectedSpy = jest.fn();
    grid.addEventListener("action-selected", selectedSpy);

    const enabledItem: ActionGridItem = {
      id: "diplomacy:chat",
      icon: "💬",
      label: "Chat",
    };

    (grid as any).handleActionClick(enabledItem);

    expect(triggerSpy).toHaveBeenCalledWith(HapticPattern.TAP);
    expect(selectedSpy).toHaveBeenCalledTimes(1);
    expect(selectedSpy.mock.calls[0][0].detail).toEqual({
      action: "diplomacy:chat",
    });
  });

  test("formats costs without trailing .0", () => {
    expect((grid as any).formatNumber(50000)).toBe("50K");
    expect((grid as any).formatNumber(1_500_000)).toBe("1.5M");
    expect((grid as any).formatNumber(1_000_000)).toBe("1M");
  });
});
