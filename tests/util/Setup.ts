import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import {
  Difficulty,
  Game,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig, PeaceTimerDuration } from "../../src/core/Schemas";
import { generateMap } from "../../src/scripts/TerrainMapGenerator";
import { TestConfig } from "./TestConfig";
import { TestServerConfig } from "./TestServerConfig";

export async function setup(
  mapName: string,
  _gameConfig: Partial<GameConfig> = {},
  humans: PlayerInfo[] = [],
): Promise<Game> {
  // Suppress console.debug for tests.
  console.debug = () => {};

  // Try binary map format first (tests/testdata/maps/{mapName}/)
  const binMapDir = path.join(__dirname, "..", "testdata", "maps", mapName);
  const mapBinPath = path.join(binMapDir, "map.bin");
  const miniMapBinPath = path.join(binMapDir, "map4x.bin");
  const manifestPath = path.join(binMapDir, "manifest.json");

  let gameMap, miniGameMap;

  if (fsSync.existsSync(mapBinPath) && fsSync.existsSync(miniMapBinPath)) {
    // Binary map format — test data files lack the 4-byte width/height header
    // that genTerrainFromBin expects, so prepend it from the manifest.
    const manifest = JSON.parse(fsSync.readFileSync(manifestPath, "utf-8"));

    const mapBinBuffer = fsSync.readFileSync(mapBinPath);
    const miniMapBinBuffer = fsSync.readFileSync(miniMapBinPath);

    const mapWithHeader = prependDimensionHeader(
      new Uint8Array(mapBinBuffer),
      manifest.map.width,
      manifest.map.height,
    );
    const miniMapWithHeader = prependDimensionHeader(
      new Uint8Array(miniMapBinBuffer),
      manifest.map4x.width,
      manifest.map4x.height,
    );

    gameMap = await genTerrainFromBin(uint8ArrayToBinaryString(mapWithHeader));
    miniGameMap = await genTerrainFromBin(
      uint8ArrayToBinaryString(miniMapWithHeader),
    );
  } else {
    // Legacy PNG map format
    const mapPath = path.join(__dirname, "..", "testdata", `${mapName}.png`);
    const imageBuffer = await fs.readFile(mapPath);
    const { map, miniMap } = await generateMap(imageBuffer, false);
    gameMap = await genTerrainFromBin(uint8ArrayToBinaryString(map));
    miniGameMap = await genTerrainFromBin(uint8ArrayToBinaryString(miniMap));
  }

  // Configure the game
  const serverConfig = new TestServerConfig();
  const gameConfig: GameConfig = {
    gameMap: GameMapType.Asia,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    disableNPCs: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    peaceTimerDurationMinutes: PeaceTimerDuration.None,
    startingGold: 0,
    goldMultiplier: 1,
    chatEnabled: false,
    ..._gameConfig,
  };
  const config = new TestConfig(
    serverConfig,
    gameConfig,
    new UserSettings(),
    false,
  );

  return createGame(humans, [], gameMap, miniGameMap, config);
}

/**
 * Prepend a 4-byte little-endian width/height header to raw terrain data,
 * matching the format that genTerrainFromBin expects.
 */
function prependDimensionHeader(
  rawData: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = width & 0xff;
  header[1] = (width >> 8) & 0xff;
  header[2] = height & 0xff;
  header[3] = (height >> 8) & 0xff;
  const result = new Uint8Array(4 + rawData.length);
  result.set(header);
  result.set(rawData, 4);
  return result;
}

/**
 * Convert a Uint8Array to a binary string without exceeding the call stack.
 * Using spread or .apply on large arrays blows the stack limit.
 */
function uint8ArrayToBinaryString(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let result = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
    );
  }
  return result;
}

export function playerInfo(name: string, type: PlayerType): PlayerInfo {
  return new PlayerInfo("fr", name, type, null, name);
}
