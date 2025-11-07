import { GameConfigSchema, PeaceTimerDuration } from "../src/core/Schemas";
import {
  Difficulty,
  GameMapType,
  GameMode,
  GameType,
} from "../src/core/game/Game";

const baseConfig = {
  gameMap: GameMapType.World,
  difficulty: Difficulty.Medium,
  gameMode: GameMode.Team,
  gameType: GameType.Private,
  disableNPCs: false,
  bots: 0,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  peaceTimerDurationMinutes: PeaceTimerDuration.None,
};

describe("PlayerTeamAssignments schema refinement", () => {
  it("accepts spectators and valid team indices", () => {
    expect(() =>
      GameConfigSchema.parse({
        ...baseConfig,
        playerTeamAssignments: {
          PLAYER01: 0,
          PLAYER02: -1,
          PLAYER03: null,
        },
      }),
    ).not.toThrow();
  });

  it("rejects out-of-range team indices", () => {
    expect(() =>
      GameConfigSchema.parse({
        ...baseConfig,
        playerTeamAssignments: {
          PLAYER01: 7,
        },
      }),
    ).toThrow("Team index must be null, -1, or between 0 and 6");

    expect(() =>
      GameConfigSchema.parse({
        ...baseConfig,
        playerTeamAssignments: {
          PLAYER01: -5,
        },
      }),
    ).toThrow();
  });
});
