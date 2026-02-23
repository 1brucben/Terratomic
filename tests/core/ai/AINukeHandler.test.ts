import { AIBehaviorParams } from "../../../src/core/ai/AIBehaviorParams";
import { AINukeHandler } from "../../../src/core/ai/AINukeHandler";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
  UpgradeType,
} from "../../../src/core/game/Game";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";

// Costs (infiniteGold=false, all players pay full price):
//   AtomBomb:      750,000
//   HydrogenBomb:  5,000,000
//   MissileSilo:   1,000,000
//   City:          min(1M, 2^numOwned * 125k)  — caps at 1M
//   SAMLauncher:   1,500,000

let game: Game;
let aiPlayer: Player;
let enemy: Player;

const params: AIBehaviorParams = {};

function createHandler(): AINukeHandler {
  return new AINukeHandler(game, aiPlayer.id(), new PseudoRandom(42), params);
}

function conquerBlock(
  player: Player,
  x: number,
  y: number,
  size: number,
): void {
  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) {
      player.conquer(game.ref(x + dx, y + dy));
    }
  }
}

describe("AINukeHandler", () => {
  beforeEach(async () => {
    // infiniteGold=false keeps costs non-zero for scoring (scoring values
    // structures by their cost(owner), which is 0 when infiniteGold+Human).
    game = await setup(
      "BigPlains",
      { infiniteGold: false, instantBuild: true },
      [
        new PlayerInfo(
          "us",
          "ai_player",
          PlayerType.Human,
          "client_ai",
          "ai_player",
        ),
        new PlayerInfo(
          "us",
          "enemy_player",
          PlayerType.Human,
          "client_enemy",
          "enemy_player",
        ),
      ],
    );

    // Atom inner=5, Hydrogen inner=10
    (game.config() as TestConfig).nukeMagnitudes = jest.fn((type: UnitType) => {
      if (type === UnitType.HydrogenBomb) {
        return { inner: 10, outer: 15 };
      }
      return { inner: 5, outer: 8 };
    });

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    aiPlayer = game.player("ai_player");
    enemy = game.player("enemy_player");

    aiPlayer.addUpgrade(UpgradeType.NuclearFission);
    enemy.addUpgrade(UpgradeType.NuclearFission);

    aiPlayer.setWarWith(enemy);
    enemy.setWarWith(aiPlayer);

    // Territory makes players alive (isAlive() checks tiles > 0)
    conquerBlock(aiPlayer, 1, 1, 5);
    conquerBlock(enemy, 50, 50, 10);

    // Give AI player enough workers so grossGoldPerMinute is non-trivial.
    // Without workers the discount-rate denominator (1+r)^T → ∞, zeroing all scores.
    aiPlayer.addWorkers(10000);
    // Recompute estimated income so the discount formula doesn't divide by zero.
    aiPlayer.updateIncomeTracking();
  });

  // --------------------------------------------------------------------------
  // Atom bomb
  // --------------------------------------------------------------------------
  describe("atom bomb scoring", () => {
    test("finds high-value target without SAMs", () => {
      // 5 cities clustered within atom inner range (5) of each other.
      // After 5 cities, cost(enemy) = min(1M, 2^5*125k) = 1M each.
      // Total enemy value ≈ 5 * 1M = 5M
      // Atom bomb cost = 750k, silo cost = 1M → score ≈ 3.25M
      for (let i = 0; i < 5; i++) {
        enemy.buildUnit(UnitType.City, game.ref(55 + i, 55), {});
      }

      const handler = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) {
        handler.tick(i);
      }

      const best = handler.bestAtomTarget();
      expect(best).not.toBeNull();
      expect(best!.score).toBeGreaterThan(0);
    });

    test("SAMs reduce atom bomb score", () => {
      for (let i = 0; i < 5; i++) {
        enemy.buildUnit(UnitType.City, game.ref(55 + i, 55), {});
      }

      // Without SAMs
      const h1 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) h1.tick(i);
      const noSAM = h1.bestAtomTarget();

      // Add a SAM within SAM range (20) of the city cluster
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(55, 57), {});

      // With SAM
      const h2 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) h2.tick(i);
      const withSAM = h2.bestAtomTarget();

      expect(noSAM).not.toBeNull();
      // SAM penalty = atomBombCost (750k) per SAM level + extra silo levels
      // Score must be strictly lower or null (negative → pruned)
      if (withSAM !== null) {
        expect(withSAM.score).toBeLessThan(noSAM!.score);
      }
    });

    test("single low-value target returns lower score than high-value cluster", () => {
      // One city: value = 125k (first city). Bomb = 750k, silo = 1M/2
      // Discount-based scoring: low value → low discounted net score
      enemy.buildUnit(UnitType.City, game.ref(55, 55), {});

      const handler = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 500; i++) handler.tick(i);

      const singleCityScore = handler.bestAtomTarget();

      // Now build a high-value cluster for comparison
      for (let i = 1; i < 5; i++) {
        enemy.buildUnit(UnitType.City, game.ref(55 + i, 55), {});
      }

      const h2 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 500; i++) h2.tick(i);
      const clusterScore = h2.bestAtomTarget();

      // Single city score should be strictly less than the cluster score
      expect(clusterScore).not.toBeNull();
      if (singleCityScore !== null) {
        expect(singleCityScore.score).toBeLessThan(clusterScore!.score);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Hydrogen bomb
  // --------------------------------------------------------------------------
  describe("hydrogen bomb scoring", () => {
    test("finds high-value target without SAMs", () => {
      aiPlayer.addUpgrade(UpgradeType.ThermonuclearStaging);

      // 7×7 block of cities within hydrogen inner range (10)
      for (let x = 52; x <= 58; x++) {
        for (let y = 52; y <= 58; y++) {
          enemy.buildUnit(UnitType.City, game.ref(x, y), {});
        }
      }
      // 49 cities capped at 1M each → value ≈ 49M
      // HBomb = 5M, silo = 1M → score ≈ 43M

      const handler = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) handler.tick(i);

      const best = handler.bestHydrogenTarget();
      expect(best).not.toBeNull();
      // Discount-based scoring: high-value cluster should produce positive score
      expect(best!.score).toBeGreaterThan(0);
    });

    test("SAMs reduce hydrogen bomb score", () => {
      aiPlayer.addUpgrade(UpgradeType.ThermonuclearStaging);

      for (let x = 52; x <= 58; x++) {
        for (let y = 52; y <= 58; y++) {
          enemy.buildUnit(UnitType.City, game.ref(x, y), {});
        }
      }

      const h1 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) h1.tick(i);
      const noSAM = h1.bestHydrogenTarget();

      // Add 2 SAMs near the cluster
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(55, 60), {});
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(58, 55), {});

      const h2 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) h2.tick(i);
      const withSAM = h2.bestHydrogenTarget();

      expect(noSAM).not.toBeNull();
      expect(withSAM).not.toBeNull();
      expect(withSAM!.score).toBeLessThan(noSAM!.score);
    });
  });

  // --------------------------------------------------------------------------
  // calculateSAMPenalty
  // --------------------------------------------------------------------------
  describe("calculateSAMPenalty", () => {
    test("returns 0 when no SAMs exist", () => {
      const handler = createHandler();
      expect(handler.calculateSAMPenalty(game.ref(55, 55))).toBe(0);
    });

    test("counts SAM levels within range", () => {
      // dist (55,55)→(55,57) = 2 < baseRange 20
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(55, 57), {});

      const handler = createHandler();
      expect(handler.calculateSAMPenalty(game.ref(55, 55))).toBe(1);
    });

    test("ignores SAMs outside range", () => {
      // dist (55,55)→(100,100) ≈ 64 > 20
      conquerBlock(enemy, 100, 100, 3);
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(100, 100), {});

      const handler = createHandler();
      expect(handler.calculateSAMPenalty(game.ref(55, 55))).toBe(0);
    });

    test("sums stack counts from multiple SAMs", () => {
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(55, 57), {});
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(53, 55), {});

      const handler = createHandler();
      expect(handler.calculateSAMPenalty(game.ref(55, 55))).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // getSAMsInRange
  // --------------------------------------------------------------------------
  describe("getSAMsInRange", () => {
    test("returns empty array when no SAMs exist", () => {
      expect(createHandler().getSAMsInRange(game.ref(55, 55))).toHaveLength(0);
    });

    test("returns SAMs within range", () => {
      const sam = enemy.buildUnit(UnitType.SAMLauncher, game.ref(55, 57), {});
      const sams = createHandler().getSAMsInRange(game.ref(55, 55));
      expect(sams).toHaveLength(1);
      expect(sams[0]).toBe(sam);
    });

    test("excludes SAMs outside range", () => {
      conquerBlock(enemy, 100, 100, 3);
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(100, 100), {});
      expect(createHandler().getSAMsInRange(game.ref(55, 55))).toHaveLength(0);
    });

    test("returns multiple SAMs", () => {
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(55, 57), {});
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(53, 55), {});
      expect(createHandler().getSAMsInRange(game.ref(55, 55))).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // bombsNeeded
  // --------------------------------------------------------------------------
  describe("bombsNeeded", () => {
    test("returns 1 when no SAMs in range", () => {
      expect(createHandler().bombsNeeded(game.ref(55, 55))).toBe(1);
    });

    test("returns 1 + SAM levels with SAMs present", () => {
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(55, 57), {});
      enemy.buildUnit(UnitType.SAMLauncher, game.ref(53, 55), {});
      // 2 SAMs × stackCount 1 → 1 + 2 = 3
      expect(createHandler().bombsNeeded(game.ref(55, 55))).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // getPlayerSiloCapacity
  // --------------------------------------------------------------------------
  describe("getPlayerSiloCapacity", () => {
    test("returns 0 when player has no silos", () => {
      expect(createHandler().getPlayerSiloCapacity()).toBe(0);
    });

    test("returns stackCount of largest silo", () => {
      const silo = aiPlayer.buildUnit(UnitType.MissileSilo, game.ref(2, 2), {});
      expect(silo.stackCount()).toBe(1);
      expect(createHandler().getPlayerSiloCapacity()).toBe(1);
    });

    test("ignores enemy silos", () => {
      enemy.buildUnit(UnitType.MissileSilo, game.ref(55, 55), {});
      expect(createHandler().getPlayerSiloCapacity()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // getEffectiveSAMRange
  // --------------------------------------------------------------------------
  describe("getEffectiveSAMRange", () => {
    test("returns base range at tech level 1", () => {
      // TestConfig.defaultSamRange() = 20, no SAM upgrades → level 1
      expect(createHandler().getEffectiveSAMRange(enemy)).toBe(20);
    });

    test("increases with SAMLevel2 upgrade", () => {
      enemy.addUpgrade(UpgradeType.SAMLevel2);
      const range = createHandler().getEffectiveSAMRange(enemy);
      // 20 * (1 + 0.35)^(2-1) = 20 * 1.35 = 27
      expect(range).toBe(27);
    });
  });

  // --------------------------------------------------------------------------
  // resetScores
  // --------------------------------------------------------------------------
  describe("resetScores", () => {
    test("clears all cached targets", () => {
      for (let i = 0; i < 5; i++) {
        enemy.buildUnit(UnitType.City, game.ref(55 + i, 55), {});
      }

      const handler = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) handler.tick(i);

      expect(handler.bestAtomTarget()).not.toBeNull();

      handler.resetScores();

      expect(handler.bestAtomTarget()).toBeNull();
      expect(handler.bestHydrogenTarget()).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Silo cost in scoring
  // --------------------------------------------------------------------------
  describe("silo cost penalty", () => {
    test("silo does not affect fast-path score (silo cost removed from tick scoring)", () => {
      // Build a high-value target cluster
      for (let i = 0; i < 5; i++) {
        enemy.buildUnit(UnitType.City, game.ref(55 + i, 55), {});
      }

      // Without silo
      const h1 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) h1.tick(i);
      const withoutSilo = h1.bestAtomTarget();

      // With silo
      aiPlayer.buildUnit(UnitType.MissileSilo, game.ref(2, 2), {});

      const h2 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) h2.tick(i);
      const withSilo = h2.bestAtomTarget();

      expect(withoutSilo).not.toBeNull();
      expect(withSilo).not.toBeNull();
      // Silo cost is no longer included in the fast-path scoring,
      // so the scores should be equal regardless of silo ownership.
      expect(withSilo!.score).toBe(withoutSilo!.score);
    });
  });

  // --------------------------------------------------------------------------
  // Friendly damage
  // --------------------------------------------------------------------------
  describe("friendly damage weight", () => {
    test("own structures in blast radius reduce score", () => {
      // Enemy cities at (55-59, 55)
      // Enemy cities span (54-59, 55) minus (57,55) which we give to AI.
      // Any tile capturing all 5 enemy cities must also capture (57,55).
      const enemyXs = [54, 55, 56, 58, 59];
      for (const x of enemyXs) {
        enemy.conquer(game.ref(x, 55));
        enemy.buildUnit(UnitType.City, game.ref(x, 55), {});
      }

      const h1 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) h1.tick(i);
      const clean = h1.bestAtomTarget();
      expect(clean).not.toBeNull();

      // AI city at exact center — unavoidable in any tile capturing all 5
      aiPlayer.conquer(game.ref(57, 55));
      aiPlayer.buildUnit(UnitType.City, game.ref(57, 55), {});

      const h2 = new AINukeHandler(
        game,
        aiPlayer.id(),
        new PseudoRandom(42),
        params,
      );
      for (let i = 0; i < 1000; i++) h2.tick(i);
      const withFriendly = h2.bestAtomTarget();

      // The AI city must reduce the score, or make it null
      if (withFriendly !== null) {
        expect(withFriendly.score).toBeLessThan(clean!.score);
      }
    });
  });
});
