/**
 * AI Calibration Runner
 *
 * Runs AI-vs-AI matches on the world map to compare two AI profiles.
 * Players are split evenly between two profiles and spawned uniformly.
 * Reports the winner and which profile they used.
 */
import { AIBehaviorParams, AIProfile } from "../core/ai/AIBehaviorParams";
import { getConfig } from "../core/configuration/ConfigLoader";
import { AllianceExpireCheckExecution } from "../core/execution/alliance/AllianceExpireCheckExecution";
import { CapitalRecalculationExecution } from "../core/execution/CapitalRecalculationExecution";
import { Executor } from "../core/execution/ExecutionManager";
import { TradeManagerExecution } from "../core/execution/TradeManagerExecution";
import { WinCheckExecution } from "../core/execution/WinCheckExecution";
import {
  Cell,
  Difficulty,
  Game,
  GameMapType,
  GameMode,
  GameType,
  Nation,
  PlayerInfo,
  PlayerType,
} from "../core/game/Game";
import { createGame } from "../core/game/GameImpl";
import { TileRef } from "../core/game/GameMap";
import { GameUpdateType, WinUpdate } from "../core/game/GameUpdates";
import {
  loadTerrainMapFresh,
  TerrainMapData,
} from "../core/game/TerrainMapLoader";
import { UserSettings } from "../core/game/UserSettings";
import { PseudoRandom } from "../core/PseudoRandom";
import { GameConfig, GameStartInfo, PeaceTimerDuration } from "../core/Schemas";
import { generateID, simpleHash } from "../core/Util";

export interface CalibrationConfig {
  /** Number of AI players total (split evenly between profiles) */
  numPlayers: number;
  /** First AI profile */
  profileA: AIProfile;
  /** Second AI profile */
  profileB: AIProfile;
  /** Map to use */
  gameMap: GameMapType;
  /** Number of bots (simple NPCs) to add, default 0 */
  bots: number;
  /** Whether to render/watch the match */
  render: boolean;
  /** Maximum ticks before declaring a draw (default: 30000 ~= 50 min at 10 ticks/sec) */
  maxTicks: number;
}

export interface CalibrationResult {
  winnerProfile: string | null; // profile id or null for draw
  winnerPlayerName: string | null;
  winnerPlayerID: string | null;
  ticksElapsed: number;
  profileAPlayers: string[];
  profileBPlayers: string[];
}

/**
 * Callback for progress updates during calibration.
 */
export type CalibrationProgressCallback = (info: {
  tick: number;
  maxTicks: number;
  players: { name: string; profile: string; tiles: number }[];
}) => void;

/**
 * Run a headless calibration match. Returns the result when complete.
 */
export async function runCalibrationMatch(
  calibrationConfig: CalibrationConfig,
  progressCallback?: CalibrationProgressCallback,
): Promise<CalibrationResult> {
  const gameID = generateID();
  const spectatorClientID = generateID();
  const random = new PseudoRandom(simpleHash(gameID));

  // Load a fresh (uncached) map so each run starts clean
  const mapData = await loadTerrainMapFresh(calibrationConfig.gameMap);

  // Create game config
  const gameConfig: GameConfig = {
    gameMap: calibrationConfig.gameMap,
    difficulty: Difficulty.Medium,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    disableNPCs: true, // We'll create our own AI nations
    bots: calibrationConfig.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    peaceTimerDurationMinutes: PeaceTimerDuration.None,
    startingGold: 0,
    goldMultiplier: 1,
    chatEnabled: false,
  };

  const config = await getConfig(gameConfig, new UserSettings());

  // Generate uniformly distributed spawn points on land
  const spawnPoints = generateUniformSpawnPoints(
    mapData,
    calibrationConfig.numPlayers,
    random,
  );

  // Create nations - half with profile A, half with profile B
  const nations: Nation[] = [];
  const profileMap = new Map<string, AIBehaviorParams>();
  const profileAPlayers: string[] = [];
  const profileBPlayers: string[] = [];
  const playerProfileMap = new Map<string, string>(); // playerID -> profileID

  const half = Math.floor(calibrationConfig.numPlayers / 2);

  for (let i = 0; i < calibrationConfig.numPlayers; i++) {
    const isProfileA = i < half;
    const profile = isProfileA
      ? calibrationConfig.profileA
      : calibrationConfig.profileB;
    const playerName = `${profile.name} #${isProfileA ? i + 1 : i - half + 1}`;
    const playerID = random.nextID();

    const playerInfo = new PlayerInfo(
      "", // flag
      playerName,
      PlayerType.AI,
      null,
      playerID,
    );

    const nation = new Nation(
      new Cell(
        mapData.gameMap.x(spawnPoints[i]),
        mapData.gameMap.y(spawnPoints[i]),
      ),
      1, // Equal strength for all
      playerInfo,
    );

    nations.push(nation);
    profileMap.set(playerID, profile.params);
    playerProfileMap.set(playerID, profile.id);

    if (isProfileA) {
      profileAPlayers.push(playerName);
    } else {
      profileBPlayers.push(playerName);
    }
  }

  // Create a dummy human player entry (spectator - never spawns)
  const spectatorInfo = new PlayerInfo(
    "",
    "Spectator",
    PlayerType.Human,
    spectatorClientID,
    random.nextID(),
  );

  // Create the game
  const game: Game = createGame(
    [spectatorInfo],
    nations,
    mapData.gameMap,
    mapData.miniGameMap,
    config,
  );

  // Set up executions
  const executor = new Executor(game, gameID, spectatorClientID);

  // Spawn bots if configured
  if (calibrationConfig.bots > 0) {
    game.addExecution(...executor.spawnBots(calibrationConfig.bots));
  }

  // Add AI player executions with profile map
  game.addExecution(...executor.aiPlayerExecutions(profileMap));

  // Add standard game executions
  game.addExecution(new WinCheckExecution());
  game.addExecution(new AllianceExpireCheckExecution());
  game.addExecution(new CapitalRecalculationExecution());
  game.addExecution(new TradeManagerExecution());

  // Run the game tick loop
  let tick = 0;
  let winUpdate: WinUpdate | null = null;

  while (tick < calibrationConfig.maxTicks) {
    // Execute tick (AI executions run automatically each tick)
    const updates = game.executeNextTick();

    tick++;

    // Check for win
    const winUpdates = updates[GameUpdateType.Win];
    if (winUpdates && winUpdates.length > 0) {
      winUpdate = winUpdates[0] as WinUpdate;
      break;
    }

    // Report progress every 100 ticks
    if (progressCallback && tick % 100 === 0) {
      const playerStats = game
        .players()
        .filter((p) => p.type() === PlayerType.AI)
        .map((p) => ({
          name: p.name(),
          profile: playerProfileMap.get(p.id()) ?? "unknown",
          tiles: p.numTilesOwned(),
        }));

      progressCallback({
        tick,
        maxTicks: calibrationConfig.maxTicks,
        players: playerStats,
      });
    }

    // Yield to the event loop periodically to prevent UI freeze
    if (tick % 500 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Determine the winner
  let winnerProfile: string | null = null;
  let winnerPlayerName: string | null = null;
  let winnerPlayerID: string | null = null;

  if (winUpdate?.winner) {
    const [winType, winnerId] = winUpdate.winner;
    if (winType === "player") {
      // Find the player by clientID or playerID
      const winningPlayer = game
        .players()
        .find((p) => p.clientID() === winnerId || p.id() === winnerId);

      if (winningPlayer) {
        winnerPlayerName = winningPlayer.name();
        winnerPlayerID = winningPlayer.id();
        winnerProfile = playerProfileMap.get(winningPlayer.id()) ?? null;
      }
    }
  }

  return {
    winnerProfile,
    winnerPlayerName,
    winnerPlayerID,
    ticksElapsed: tick,
    profileAPlayers,
    profileBPlayers,
  };
}

/**
 * Creates a GameStartInfo for a calibration match that can be used with the
 * normal rendering pipeline (LocalServer + ClientGameRunner).
 */
export function createCalibrationGameStartInfo(
  calibrationConfig: CalibrationConfig,
): {
  gameStartInfo: GameStartInfo;
  clientID: string;
  gameID: string;
  nations: Nation[];
  profileMap: Map<string, AIBehaviorParams>;
  playerProfileMap: Map<string, string>;
  profileAPlayers: string[];
  profileBPlayers: string[];
} {
  const gameID = generateID();
  const spectatorClientID = generateID();
  const random = new PseudoRandom(simpleHash(gameID));

  const gameConfig: GameConfig = {
    gameMap: calibrationConfig.gameMap,
    difficulty: Difficulty.Medium,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    disableNPCs: true,
    bots: calibrationConfig.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    peaceTimerDurationMinutes: PeaceTimerDuration.None,
    startingGold: 0,
    goldMultiplier: 1,
    chatEnabled: false,
  };

  const profileMap = new Map<string, AIBehaviorParams>();
  const playerProfileMap = new Map<string, string>();
  const profileAPlayers: string[] = [];
  const profileBPlayers: string[] = [];
  const half = Math.floor(calibrationConfig.numPlayers / 2);

  // We'll create the nations later when map is loaded
  // For the GameStartInfo, we just need the spectator player
  const gameStartInfo: GameStartInfo = {
    gameID,
    config: gameConfig,
    players: [
      {
        clientID: spectatorClientID,
        username: "Spectator",
        flag: "",
      },
    ],
  };

  return {
    gameStartInfo,
    clientID: spectatorClientID,
    gameID,
    nations: [], // will be populated when map loads
    profileMap,
    playerProfileMap,
    profileAPlayers,
    profileBPlayers,
  };
}

/**
 * Generate N uniformly distributed spawn points on land tiles.
 * Uses a grid-based approach to ensure uniform distribution.
 */
function generateUniformSpawnPoints(
  mapData: TerrainMapData,
  numPlayers: number,
  random: PseudoRandom,
): TileRef[] {
  const gameMap = mapData.gameMap;
  const width = gameMap.width();
  const height = gameMap.height();

  // Collect all land tiles
  const landTiles: TileRef[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ref = gameMap.ref(x, y);
      if (gameMap.isLand(ref)) {
        landTiles.push(ref);
      }
    }
  }

  if (landTiles.length < numPlayers) {
    throw new Error(
      `Not enough land tiles (${landTiles.length}) for ${numPlayers} players`,
    );
  }

  // Use a greedy farthest-point sampling approach for uniform distribution
  const selected: TileRef[] = [];
  const minDistances = new Float32Array(landTiles.length).fill(Infinity);

  // Start with a random land tile
  const firstIndex = random.nextInt(0, landTiles.length);
  selected.push(landTiles[firstIndex]);

  // Update distances from the first point
  for (let i = 0; i < landTiles.length; i++) {
    const dist = gameMap.manhattanDist(landTiles[i], landTiles[firstIndex]);
    if (dist < minDistances[i]) {
      minDistances[i] = dist;
    }
  }

  // Greedily select the farthest point from all selected points
  while (selected.length < numPlayers) {
    let bestIndex = -1;
    let bestDist = -1;

    for (let i = 0; i < landTiles.length; i++) {
      if (minDistances[i] > bestDist) {
        bestDist = minDistances[i];
        bestIndex = i;
      }
    }

    if (bestIndex === -1) break;

    selected.push(landTiles[bestIndex]);
    minDistances[bestIndex] = 0; // Mark as selected

    // Update min distances
    for (let i = 0; i < landTiles.length; i++) {
      if (minDistances[i] > 0) {
        const dist = gameMap.manhattanDist(landTiles[i], landTiles[bestIndex]);
        if (dist < minDistances[i]) {
          minDistances[i] = dist;
        }
      }
    }
  }

  return selected;
}
