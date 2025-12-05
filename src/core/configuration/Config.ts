import { Colord } from "colord";
import { JWK } from "jose";
import {
  GameConfig,
  GameID,
  PlayerTeamAssignments,
  TeamCountConfig,
} from "../Schemas";
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
  startingGold(): number;
  numSpawnPhaseTurns(): number;
  userSettings(): UserSettings;
  playerTeams(): TeamCountConfig;
  playerTeamAssignments(): PlayerTeamAssignments | undefined;

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
  // Multiplier used to compute a player's Industrial Production as: industrialProductionFactor * maxPopulation(player)
  industrialProductionFactor(): number;
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
  scorchedEarthActivationCost(player: Player | PlayerView): Gold;
  tradeShipGold(dist: number): Gold;
  tradeShipSpawnRate(numberOfPorts: number): number;
  // Trade rework: gravity-based demand and port-supplied ships
  tradeGravityK(): number; // Coefficient K in K * ip_i * ip_j / distance / world_industrial_production
  tradeDemandTickInterval(): number; // Ticks between gravity accumulation (default 10)
  tradeShipPerPortSupply(): number; // Number of trade ships each port supplies (default 1)
  tradeIncomeFixed(): Gold; // Fixed income per completed trade (default 10k)
  tradeShipReplacementDelayTicks(): number; // Ticks to generate a new/replacement trade ship (default 600 ~= 60s)
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

  // Structure upgrade cost multiplier per structure type (e.g., 0.8 for 80%)
  structureUpgradeCostMultiplier(type: UnitType): number;
  // Hardcoded unit upgrade cost: cost to upgrade from current level to next level
  unitUpgradeStepCost(type: UnitType, fromLevel: number): Gold;
  // Hardcoded unit upgrade cost: total cost to build unit at targetLevel
  unitUpgradeTotalCost(type: UnitType, targetLevel: number): Gold;

  cargoPlaneGold(dist: number): Gold;
  cargoPlaneSpawnRate(numberOfAirplanes: number): number;
  cargoPlaneMaxNumber(): number;
  cargoPlanesEnabled(): boolean;
  bombersEnabled(): boolean;
  bomberDropCadence(): number;
  bomberPayload(): number;
  bomberSpawnInterval(): number;
  bomberLaunchGapTicks(): number;
  bomberTakeoffHealthThreshold(): number;
  bomberTargetRange(level?: number): number;
  bomberExplosionRadius(): number;
  bomberSpeed(level?: number): number;
  bomberMaxHealth(level?: number): number;
  bomberDamage(level?: number): number;
  bomberCooldownTicks(): number;
  safeFromPiratesCooldownMax(): number;
  defensePostRange(): number;
  citySamLaunchRange(): number;
  citySamCooldown(): number;
  cityAARange(): number;
  cityAAFireRate(): number;
  cityAABulletDamage(): number;
  cityAABulletSpeed(): number;
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
  // Fighter Jet: per-level max health
  fighterJetLevelMaxHealth(level: number): number;
  // Fighter Jet: per-level damage range (inclusive)
  fighterJetDamageRange(level: number): { min: number; max: number };
  // Warship: per-level max health
  warshipLevelMaxHealth(level: number): number;
  // Warship: per-level damage range
  warshipDamageRange(level: number): { min: number; max: number };
  // Submarine: per-level max health
  submarineLevelMaxHealth(level: number): number;
  // Submarine: per-level damage range
  submarineDamageRange(level: number): { min: number; max: number };
  warshipAARange(): number;
  warshipAACooldown(): number;
  warshipAAScanInterval(): number;
  warshipAAHittingChance(): number;
  // Submarine stealth parameters
  submarineDetectionLingerTicks(): number;
  submarineGhostLingerTicks(): number;
  // 0-1
  traitorDefenseDebuff(): number;
  traitorDuration(): number;
  maxInvestmentRate(): number;
  // Default investment rates for new players (0-1)
  defaultResearchInvestment(): number;
  defaultRoadInvestment(): number;
  nukeMagnitudes(unitType: UnitType): NukeMagnitude;
  // Number of tiles destroyed to break an alliance
  nukeAllianceBreakThreshold(): number;
  defaultNukeSpeed(): number;
  defaultNukeTargetableRange(): number;
  defaultSamMissileSpeed(): number;
  defaultSamRange(): number;
  // Percentage (0..1) increase applied per SAM level beyond 1
  samRangeUpgradePercent(): number;
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
