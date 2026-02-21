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

  let gameMap, miniGameMap;

  if (fsSync.existsSync(mapBinPath) && fsSync.existsSync(miniMapBinPath)) {
    // Binary map format
    const mapBinBuffer = fsSync.readFileSync(mapBinPath);
    const miniMapBinBuffer = fsSync.readFileSync(miniMapBinPath);
    const mapBinString = String.fromCharCode(...new Uint8Array(mapBinBuffer));
    const miniMapBinString = String.fromCharCode(
      ...new Uint8Array(miniMapBinBuffer),
    );
    gameMap = await genTerrainFromBin(mapBinString);
    miniGameMap = await genTerrainFromBin(miniMapBinString);
  } else {
    // Legacy PNG map format
    const mapPath = path.join(__dirname, "..", "testdata", `${mapName}.png`);
    const imageBuffer = await fs.readFile(mapPath);
    const { map, miniMap } = await generateMap(imageBuffer, false);
    gameMap = await genTerrainFromBin(String.fromCharCode.apply(null, map));
    miniGameMap = await genTerrainFromBin(
      String.fromCharCode.apply(null, miniMap),
    );
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

export function playerInfo(name: string, type: PlayerType): PlayerInfo {
  return new PlayerInfo("fr", name, type, null, name);
}
