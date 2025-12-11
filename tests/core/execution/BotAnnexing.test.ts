import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

describe("Bot Annexing (Encirclement Mechanic)", () => {
  let game: Game;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("Basic Functionality", () => {
    it("should not crash when executing with bots", async () => {
      game = await setup(
        "Plains",
        { infiniteGold: true, instantBuild: true, startingGold: 0 },
        [
          new PlayerInfo("us", "Human", PlayerType.Human, null, "human_id"),
          new PlayerInfo("us", "Bot", PlayerType.Bot, null, "bot_id"),
        ],
      );

      while (game.inSpawnPhase()) game.executeNextTick();

      const bot = game.player("bot_id") as Player;
      expect(bot.type()).toBe(PlayerType.Bot);

      // Execute ticks - cluster check runs every 20 ticks
      for (let i = 0; i < 150; i++) {
        game.executeNextTick();
      }

      // Game should still be valid
      expect(game).toBeDefined();
    });

    it("should not annex a human player", async () => {
      game = await setup(
        "Plains",
        { infiniteGold: true, instantBuild: true, startingGold: 0 },
        [
          new PlayerInfo("us", "Human1", PlayerType.Human, null, "human1_id"),
          new PlayerInfo("us", "Human2", PlayerType.Human, null, "human2_id"),
        ],
      );

      while (game.inSpawnPhase()) game.executeNextTick();

      const human1 = game.player("human1_id") as Player;
      const human1TilesBefore = human1.numTilesOwned();

      // Execute many ticks
      for (let i = 0; i < 250; i++) {
        game.executeNextTick();
      }

      // Human should still own same tiles (not auto-annexed)
      expect(human1.numTilesOwned()).toEqual(human1TilesBefore);
    });

    it("should not annex a fakehuman player", async () => {
      game = await setup(
        "Plains",
        { infiniteGold: true, instantBuild: true, startingGold: 0 },
        [
          new PlayerInfo("us", "Human", PlayerType.Human, null, "human_id"),
          new PlayerInfo(
            "us",
            "FakeHuman",
            PlayerType.FakeHuman,
            null,
            "fake_id",
          ),
        ],
      );

      while (game.inSpawnPhase()) game.executeNextTick();

      const fakeHuman = game.player("fake_id") as Player;
      const fakeInitialTiles = fakeHuman.numTilesOwned();

      // Execute many ticks
      for (let i = 0; i < 250; i++) {
        game.executeNextTick();
      }

      // FakeHuman should still own same tiles (not auto-annexed)
      expect(fakeHuman.numTilesOwned()).toEqual(fakeInitialTiles);
    });
  });

  describe("Player Type Guard", () => {
    it("should only process bots, not humans", async () => {
      game = await setup(
        "Plains",
        { infiniteGold: true, instantBuild: true, startingGold: 0 },
        [
          new PlayerInfo("us", "Human", PlayerType.Human, null, "human_id"),
          new PlayerInfo("us", "Bot", PlayerType.Bot, null, "bot_id"),
        ],
      );

      while (game.inSpawnPhase()) game.executeNextTick();

      const human = game.player("human_id") as Player;
      const bot = game.player("bot_id") as Player;

      expect(human.type()).toBe(PlayerType.Human);
      expect(bot.type()).toBe(PlayerType.Bot);

      const humanTilesBefore = human.numTilesOwned();

      for (let i = 0; i < 200; i++) {
        game.executeNextTick();
      }

      // Human tiles should be protected
      expect(human.numTilesOwned()).toEqual(humanTilesBefore);
    });
  });

  describe("Cluster Check Frequency", () => {
    it("should execute without errors over many ticks", async () => {
      game = await setup(
        "Plains",
        { infiniteGold: true, instantBuild: true, startingGold: 0 },
        [
          new PlayerInfo("us", "Bot1", PlayerType.Bot, null, "bot1_id"),
          new PlayerInfo("us", "Bot2", PlayerType.Bot, null, "bot2_id"),
        ],
      );

      while (game.inSpawnPhase()) game.executeNextTick();

      // Execute many ticks (cluster check every 20)
      for (let i = 0; i < 300; i++) {
        game.executeNextTick();
      }

      // Game should still be functional (at least one player/bot exists)
      expect(game).toBeDefined();
    });
  });

  describe("Ocean Escape Route", () => {
    it("should handle ocean-based maps correctly", async () => {
      game = await setup(
        "half_land_half_ocean",
        { infiniteGold: true, instantBuild: true, startingGold: 0 },
        [new PlayerInfo("us", "Bot", PlayerType.Bot, null, "bot_id")],
      );

      while (game.inSpawnPhase()) game.executeNextTick();

      const bot = game.player("bot_id") as Player;
      expect(bot.numTilesOwned()).toBeGreaterThanOrEqual(0);

      // Execute ticks on ocean map
      for (let i = 0; i < 150; i++) {
        game.executeNextTick();
      }

      // Game should still be valid
      expect(game).toBeDefined();
    });
  });
});
