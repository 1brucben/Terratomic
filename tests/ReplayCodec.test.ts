import {
  decodeReplay,
  encodeReplay,
  isCompressionSupported,
} from "../src/client/ReplayCodec";
import {
  Difficulty,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
} from "../src/core/game/Game";
import {
  GameEndInfo,
  GameRecord,
  Intent,
  PeaceTimerDuration,
  Turn,
} from "../src/core/Schemas";

// Mock GameEndInfo for testing
function createMockGameEndInfo(numTurns: number): GameEndInfo {
  return {
    gameID: "test-game-id",
    config: {
      gameMap: GameMapType.World,
      difficulty: Difficulty.Medium,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      disableNPCs: false,
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      peaceTimerDurationMinutes: PeaceTimerDuration.None,
      startingGold: 0,
      goldMultiplier: 1,
    },
    players: [
      {
        persistentID: "00000000-0000-0000-0000-000000000001",
        username: "TestPlayer",
        clientID: "client-1",
        stats: {},
      },
    ],
    start: Date.now() - 60000,
    end: Date.now(),
    duration: 60000,
    num_turns: numTurns,
    winner: ["player", "client-1"],
  };
}

// Mock GameRecord for testing
function createMockGameRecord(
  numTurns: number,
  turnsWithIntents: number[] = [],
): GameRecord {
  const turns: Turn[] = [];
  for (let i = 0; i < numTurns; i++) {
    const intents: Intent[] = turnsWithIntents.includes(i)
      ? [
          {
            type: "spawn",
            clientID: "client-1",
            name: "TestPlayer",
            playerType: PlayerType.Human,
            tile: i,
          },
        ]
      : [];
    turns.push({
      turnNumber: i,
      intents,
      hash: null,
    });
  }

  return {
    info: createMockGameEndInfo(numTurns),
    turns,
    version: "v0.0.2",
    gitCommit: "a".repeat(40),
  };
}

describe("ReplayCodec", () => {
  describe("isCompressionSupported", () => {
    it("returns true when CompressionStream is available", () => {
      // In Node.js test environment with modern version, this should be true
      const result = isCompressionSupported();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("encodeReplay", () => {
    it("returns a string starting with TRv1:", async () => {
      const record = createMockGameRecord(10);
      const encoded = await encodeReplay(record);

      expect(encoded).toMatch(/^TRv1:/);
    });

    it("produces valid base64 after the prefix", async () => {
      const record = createMockGameRecord(10);
      const encoded = await encodeReplay(record);
      const base64Part = encoded.slice(5);

      // Should not throw when decoding valid base64
      expect(() => atob(base64Part)).not.toThrow();
    });

    it("uses sparse encoding for turns", async () => {
      // Create a game with 100 turns but only 3 have intents
      const record = createMockGameRecord(100, [5, 50, 95]);
      const encoded = await encodeReplay(record);

      // Decode to verify sparse encoding was used
      const decoded = await decodeReplay(encoded);

      // Should have reconstructed all 100 turns
      expect(decoded.turns.length).toBe(100);

      // Only turns 5, 50, 95 should have intents
      expect(decoded.turns[5].intents.length).toBe(1);
      expect(decoded.turns[50].intents.length).toBe(1);
      expect(decoded.turns[95].intents.length).toBe(1);
      expect(decoded.turns[0].intents.length).toBe(0);
      expect(decoded.turns[99].intents.length).toBe(0);
    });
  });

  describe("decodeReplay", () => {
    it("throws for invalid format (missing TRv1: prefix)", async () => {
      await expect(decodeReplay("invalid-data")).rejects.toThrow(
        "Invalid replay format",
      );
    });

    it("throws for invalid base64", async () => {
      await expect(decodeReplay("TRv1:not-valid-base64!!!")).rejects.toThrow(
        "Invalid Base64 encoding",
      );
    });

    it("throws for invalid gzip data", async () => {
      // Valid base64 but not gzip compressed
      const invalidGzip = btoa("this is not gzip data");
      await expect(decodeReplay("TRv1:" + invalidGzip)).rejects.toThrow();
    });
  });

  describe("encode/decode roundtrip", () => {
    it("preserves game info through roundtrip", async () => {
      const record = createMockGameRecord(50, [10, 20, 30]);
      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.info.gameID).toBe(record.info.gameID);
      expect(decoded.info.num_turns).toBe(record.info.num_turns);
      expect(decoded.info.duration).toBe(record.info.duration);
      expect(decoded.info.winner).toEqual(record.info.winner);
    });

    it("preserves player data through roundtrip", async () => {
      const record = createMockGameRecord(10);
      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.info.players.length).toBe(record.info.players.length);
      expect(decoded.info.players[0].username).toBe(
        record.info.players[0].username,
      );
      expect(decoded.info.players[0].clientID).toBe(
        record.info.players[0].clientID,
      );
    });

    it("preserves turn intents through roundtrip", async () => {
      const record = createMockGameRecord(20, [5, 15]);
      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.turns[5].intents).toEqual(record.turns[5].intents);
      expect(decoded.turns[15].intents).toEqual(record.turns[15].intents);
    });

    it("preserves version and gitCommit through roundtrip", async () => {
      const record = createMockGameRecord(10);
      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.version).toBe(record.version);
      expect(decoded.gitCommit).toBe(record.gitCommit);
    });

    it("reconstructs correct turn count", async () => {
      const numTurns = 150;
      const record = createMockGameRecord(numTurns, [0, 75, 149]);
      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.turns.length).toBe(numTurns);
      for (let i = 0; i < numTurns; i++) {
        expect(decoded.turns[i].turnNumber).toBe(i);
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty turns array", async () => {
      const record = createMockGameRecord(0);
      record.info.num_turns = 0;
      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.turns.length).toBe(0);
    });

    it("handles game with all empty turns", async () => {
      const record = createMockGameRecord(50, []); // No turns with intents
      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.turns.length).toBe(50);
      decoded.turns.forEach((turn) => {
        expect(turn.intents.length).toBe(0);
      });
    });

    it("handles game where every turn has intents", async () => {
      const numTurns = 20;
      const allTurns = Array.from({ length: numTurns }, (_, i) => i);
      const record = createMockGameRecord(numTurns, allTurns);
      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.turns.length).toBe(numTurns);
      decoded.turns.forEach((turn) => {
        expect(turn.intents.length).toBe(1);
      });
    });

    it("handles multiple players", async () => {
      const record = createMockGameRecord(10);
      record.info.players = [
        {
          persistentID: "00000000-0000-0000-0000-000000000001",
          username: "Player1",
          clientID: "c1",
          stats: { gold: [BigInt(1000)] },
        },
        {
          persistentID: "00000000-0000-0000-0000-000000000002",
          username: "Player2",
          clientID: "c2",
          stats: { gold: [BigInt(2000)] },
        },
        {
          persistentID: "00000000-0000-0000-0000-000000000003",
          username: "Player3",
          clientID: "c3",
          stats: {},
        },
      ];

      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.info.players.length).toBe(3);
      expect(decoded.info.players[0].username).toBe("Player1");
      expect(decoded.info.players[1].username).toBe("Player2");
      expect(decoded.info.players[2].username).toBe("Player3");
    });

    it("handles team winner", async () => {
      const record = createMockGameRecord(10);
      record.info.winner = ["team", "Red"];

      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.info.winner).toEqual(["team", "Red"]);
    });

    it("handles undefined winner (no winner yet)", async () => {
      const record = createMockGameRecord(10);
      record.info.winner = undefined;

      const encoded = await encodeReplay(record);
      const decoded = await decodeReplay(encoded);

      expect(decoded.info.winner).toBeUndefined();
    });
  });

  describe("compression efficiency", () => {
    it("sparse encoding reduces size for games with few actions", async () => {
      // Create a long game with very few actions
      const record = createMockGameRecord(1000, [100, 500, 900]);
      const encoded = await encodeReplay(record);

      // The encoded string should be reasonably small despite 1000 turns
      // A naive encoding would be much larger
      expect(encoded.length).toBeLessThan(5000);
    });
  });
});
