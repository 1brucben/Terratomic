import { Colord } from "colord";
import { JWK } from "jose";
import { GameConfig, GameID } from "../Schemas";
import {
  Difficulty,
  Duos,
  Game,
  GameMapType,
  GameMode,
  Gold,
  Player,
  PlayerInfo,
  Team,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export interface ServerConfig {
  turnIntervalMs(): number;
  gameCreationRate(): number;
  lobbyMaxPlayers(
    map: GameMapType,
    mode: GameMode,
    numPlayerTeams: number | undefined,
  ): number;
  numWorkers(): number;
  workerIndex(gameID: GameID): number;
  workerPath(gameID: GameID): string;
  workerPort(gameID: GameID): number;
  workerPortByIndex(workerID: number): number;
  env(): GameEnv;
  region(): string;
  adminToken(): string;
  adminHeader(): string;
  // Only available on the server
  gitCommit(): string;
  r2Bucket(): string;
  r2Endpoint(): string;
  r2AccessKey(): string;
  r2SecretKey(): string;
  otelEndpoint(): string;
  otelUsername(): string;
  otelPassword(): string;
  otelEnabled(): boolean;
  jwtAudience(): string;
  jwtIssuer(): string;
  jwkPublicKey(): Promise<JWK>;
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

export interface Config {
  samHittingChance(): number;
  samWarheadHittingChance(): number;
  spawnImmunityDuration(): Tick;
  serverConfig(): ServerConfig;
  gameConfig(): GameConfig;
  theme(): Theme;
  percentageTilesOwnedToWin(): number;
  numBots(): number;
  spawnNPCs(): boolean;
  isUnitDisabled(unitType: UnitType): boolean;
  bots(): number;
  infiniteGold(): boolean;
  infiniteTroops(): boolean;
  instantBuild(): boolean;
  numSpawnPhaseTurns(): number;
  userSettings(): UserSettings;
  playerTeams(): number | typeof Duos;

  startManpower(playerInfo: PlayerInfo): number;
  populationIncreaseRate(player: Player | PlayerView): number;
  goldAdditionRate(player: Player | PlayerView): Gold;
  troopAdjustmentRate(player: Player): number;
  attackTilesPerTick(
    attckTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number;
  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  };
  attackAmount(attacker: Player, defender: Player | TerraNullius): number;
  radiusPortSpawn(): number;
  // When computing likelihood of trading for any given port, the X closest port
  // are twice more likely to be selected. X is determined below.
  proximityBonusPortsNb(totalPorts: number): number;
  proximityBonusAirfieldsNumber(totalAirfields: number): number;
  maxPopulation(player: Player | PlayerView): number;
  cityPopulationIncrease(): number;
  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number;
  shellLifetime(): number;
  boatMaxNumber(): number;
  allianceDuration(): Tick;
  allianceRequestCooldown(): Tick;
  temporaryEmbargoDuration(): Tick;
  targetDuration(): Tick;
  targetCooldown(): Tick;
  emojiMessageCooldown(): Tick;
  emojiMessageDuration(): Tick;
  donateCooldown(): Tick;
  defaultDonationAmount(sender: Player): number;
  unitInfo(type: UnitType): UnitInfo;
  tradeShipGold(dist: number): Gold;
  tradeShipSpawnRate(numberOfPorts: number): number;
  /**
   * Calculates the gold earned from a Cargo Plane trade based on distance.
   * @param dist The distance traveled by the Cargo Plane.
   */
  /**
   * Calculates the gold earned from a Cargo Plane trade based on distance.
   * @param dist The distance traveled by the Cargo Plane.
   */
  cargoPlaneGold(dist: number): Gold;
  /**
   * Determines the spawn rate of Cargo Planes based on the number of airfields.
   * @param numberOfAirplanes The total number of airfields owned by the player.
   */
  /**
   * Determines the spawn rate of Cargo Planes based on the number of airfields.
   * @param numberOfAirplanes The total number of airfields owned by the player.
   */
  cargoPlaneSpawnRate(numberOfAirplanes: number): number;
  /**
   * The maximum number of Cargo Planes a player can have active at one time.
   */
  /**
   * The maximum number of Cargo Planes a player can have active at one time.
   */
  cargoPlaneMaxNumber(): number;
  /**
   * The rate (in ticks) at which a Bomber drops its payload.
   */
  bomberDropCadence(): number;
  /**
   * The number of bombs a Bomber can carry.
   */
  bomberPayload(): number;
  /**
   * The interval (in ticks) at which airfields attempt to spawn new Bombers.
   */
  bomberSpawnInterval(): number;
  /**
   * The maximum range (in tiles) a Bomber can target.
   */
  bomberTargetRange(): number;
  /**
   * The radius of the explosion caused by a Bomber's bomb.
   */
  bomberExplosionRadius(): number;
  safeFromPiratesCooldownMax(): number;
  defensePostRange(): number;
  SAMCooldown(): number;
  SiloCooldown(): number;
  defensePostLossMultiplier(): number;
  defensePostSpeedMultiplier(): number;
  falloutDefenseModifier(percentOfFallout: number): number;
  difficultyModifier(difficulty: Difficulty): number;
  warshipPatrolRange(): number;
  warshipShellAttackRate(): number;
  warshipTargettingRange(): number;
  defensePostShellAttackRate(): number;
  defensePostTargettingRange(): number;
  /**
   * The maximum range (in tiles) a Fighter Jet will patrol from its assigned patrol tile.
   */
  fighterJetPatrolRange(): number;
  /**
   * The maximum range (in tiles) a Fighter Jet will search for targets.
   */
  fighterJetTargettingRange(): number;
  /**
   * The rate (in ticks) at which a Fighter Jet will attack its target.
   */
  fighterJetAttackRate(): number;
  /**
   * The movement speed of a Fighter Jet (number of tiles per tick).
   */
  fighterJetSpeed(): number;
  /**
   * The amount of health a Fighter Jet heals per tick when at an airfield.
   */
  fighterJetHealingAmount(): number;
  /**
   * The distance at which a Fighter Jet is considered to have reached its target.
   */
  fighterJetTargetReachedDistance(): number;
  /**
   * The distance at which a Fighter Jet will start circling its target instead of moving directly towards it.
   */
  fighterJetDogfightDistance(): number;
  /**
   * The minimum distance a Fighter Jet will maintain from its target when dogfighting.
   */
  fighterJetMinDogfightDistance(): number;
  /**
   * The minimum distance a Fighter Jet will maintain from its target when dogfighting.
   */
  fighterJetMinDogfightDistance(): number;
  /**
   * The minimum distance a Fighter Jet will maintain from its target when dogfighting.
   */
  fighterJetMinDogfightDistance(): number;
  // 0-1
  traitorDefenseDebuff(): number;
  traitorDuration(): number;
  nukeMagnitudes(unitType: UnitType): NukeMagnitude;
  defaultNukeSpeed(): number;
  defaultNukeTargetableRange(): number;
  defaultSamRange(): number;
  nukeDeathFactor(humans: number, tilesOwned: number): number;
  structureMinDist(): number;
  isReplay(): boolean;
  allianceExtensionPromptOffset(): number;
}

export interface Theme {
  teamColor(team: Team): Colord;
  territoryColor(playerInfo: PlayerView): Colord;
  specialBuildingColor(playerInfo: PlayerView): Colord;
  borderColor(playerInfo: PlayerView): Colord;
  defendedBorderColors(playerInfo: PlayerView): { light: Colord; dark: Colord };
  focusedBorderColor(): Colord;
  terrainColor(gm: GameMap, tile: TileRef): Colord;
  backgroundColor(): Colord;
  falloutColor(): Colord;
  font(): string;
  textColor(playerInfo: PlayerView): string;
  // unit color for alternate view
  selfColor(): Colord;
  allyColor(): Colord;
  enemyColor(): Colord;
  spawnHighlightColor(): Colord;
}
