import { Colord } from "colord";
import { JWK } from "jose";
import { GameConfig, GameID, TeamCountConfig } from "../Schemas";
import {
  Difficulty,
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
  UpgradeType,
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
    numPlayerTeams: TeamCountConfig | undefined,
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

export interface UpgradeInfo {
  cost: (player: Player | PlayerView) => Gold;
}

export interface Config {
  samNukeHittingChance(): number;
  samPlaneHittingChance(): number;
  samWarheadHittingChance(): number;
  spawnImmunityDuration(): Tick;
  serverConfig(): ServerConfig;
  gameConfig(): GameConfig;
  peaceTimerDuration(): number;
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
  playerTeams(): TeamCountConfig;

  startManpower(playerInfo: PlayerInfo): number;
  populationIncreaseRate(player: Player | PlayerView): number;
  // Gross gold per tick BEFORE any investments are subtracted (number, not bigint)
  grossGoldAdditionRate(player: Player | PlayerView): number;
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
  paratrooperAttackAmount(
    attacker: Player,
    defender: Player | TerraNullius,
  ): number;
  paratrooperMaxNumber(): number;
  paratrooperSpeed(): number;
  paratrooperMaxRange(): number;
  paratrooperTroopCostPercentage(): number;
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
  upgradeInfo(type: UpgradeType): UpgradeInfo;
  tradeShipGold(dist: number): Gold;
  tradeShipSpawnRate(numberOfPorts: number): number;
  cargoTruckSpawnRate(numberOfStructures: number): number;
  cargoTruckGold(distance: number): Gold;
  roadUpdatesPerTick(): number;
  maxRoadLength(): number;
  // Roads: base gold cost per pixel (before productivity scaling)
  roadConstructionBaseCost(): number;
  // Roads: per-tile maintenance multiplier applied to base cost
  roadMaintenanceMultiplier(): number;
  // Road quality dynamics
  roadQualityMin(): number;
  roadQualityMax(): number;
  roadQualityAdjustmentRate(): number;

  // International Cargo Trucks
  internationalCargoTrucksEnabled(): boolean;
  internationalCargoTruckSpawnChance(): number;
  internationalCargoTruckGoldMultiplier(): number;
  internationalCargoTruckGoldSplitRatio(): number;
  urbanPlanningPopulationBonusNum(): number;
  urbanPlanningPopulationBonusDen(): number;
  structureInsuranceRefundNum(): number;
  structureInsuranceRefundDen(): number;
  automationTradeIncomeMultiplierNum(): number;
  automationTradeIncomeMultiplierDen(): number;
  automationTroopRegenMultiplierNum(): number;
  automationTroopRegenMultiplierDen(): number;

  cargoPlaneGold(dist: number): Gold;
  cargoPlaneSpawnRate(numberOfAirplanes: number): number;
  cargoPlaneMaxNumber(): number;
  cargoPlanesEnabled(): boolean;
  bombersEnabled(): boolean;
  bomberDropCadence(): number;
  bomberPayload(): number;
  bomberSpawnInterval(): number;
  bomberTargetRange(): number;
  bomberExplosionRadius(): number;
  bomberSpeed(): number;
  safeFromPiratesCooldownMax(): number;
  defensePostRange(): number;
  citySamLaunchRange(): number;
  citySamCooldown(): number;
  SAMNukeCooldown(): number;
  SAMPlaneCooldown(): number;
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
  fighterJetPatrolRange(): number;
  fighterJetTargettingRange(): number;
  fighterJetAttackRate(): number;
  fighterJetSpeed(): number;
  fighterJetHealingAmount(): number;
  fighterJetTargetReachedDistance(): number;
  fighterJetDogfightDistance(): number;
  fighterJetMinDogfightDistance(): number;
  warshipAARange(): number;
  warshipAACooldown(): number;
  warshipAAScanInterval(): number;
  warshipAAHittingChance(): number;
  // 0-1
  traitorDefenseDebuff(): number;
  traitorDuration(): number;
  maxInvestmentRate(): number;
  nukeMagnitudes(unitType: UnitType): NukeMagnitude;
  // Number of tiles destroyed to break an alliance
  nukeAllianceBreakThreshold(): number;
  defaultNukeSpeed(): number;
  defaultNukeTargetableRange(): number;
  defaultSamRange(): number;
  nukeDeathFactor(humans: number, tilesOwned: number): number;
  structureMinDist(): number;
  isReplay(): boolean;
  allianceExtensionPromptOffset(): number;
  maxProductivity(): number;

  // Research system parameters
  researchAlpha(): number; // A in A * investment^B
  researchBeta(): number; // B in A * investment^B
  researchK(): number; // k in 1 - exp(-k * x)
  researchBeakerMin(): number; // inclusive
  researchBeakerMax(): number; // inclusive
  // Server-side cadence for research innovation calculation (ticks)
  researchIntervalTicks(): number;
  forceCanBuildBomberInTests?(): boolean; // Change to optional method
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
