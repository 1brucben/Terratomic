import {
  GameConfigSchema,
  PeaceTimerDuration,
  StartingGoldValues,
} from "../../src/core/Schemas";
import {
  Difficulty,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";

const baseConfig = {
  gameMap: GameMapType.World,
  difficulty: Difficulty.Medium,
  gameType: GameType.Singleplayer,
  gameMode: GameMode.FFA,
  disableNPCs: false,
  bots: 0,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  peaceTimerDurationMinutes: PeaceTimerDuration.None,
};

describe("GameConfigSchema startingGold validation", () => {
  it("accepts approved starting gold values", () => {
    for (const value of StartingGoldValues) {
      const result = GameConfigSchema.safeParse({
        ...baseConfig,
        startingGold: value,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.startingGold).toBe(value);
      }
    }
  });

  it("defaults startingGold to zero when omitted", () => {
    const result = GameConfigSchema.parse(baseConfig);
    expect(result.startingGold).toBe(0);
  });

  it("rejects arbitrary starting gold values", () => {
    const result = GameConfigSchema.safeParse({
      ...baseConfig,
      startingGold: 123456,
    });
    expect(result.success).toBe(false);
  });
});
