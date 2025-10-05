import { JWK } from "jose";
import { z } from "zod";
import {
  Difficulty,
  Duos,
  Game,
  GameMapType,
  GameMode,
  GameType,
  Gold,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  Quads,
  TerrainType,
  TerraNullius,
  Tick,
  Trios,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";
import {
  GameConfig,
  GameID,
  PeaceTimerDuration,
  TeamCountConfig,
} from "../Schemas";
import { assertNever, simpleHash, within } from "../Util";
import { Config, GameEnv, NukeMagnitude, ServerConfig, Theme } from "./Config";
import { PastelTheme } from "./PastelTheme";
import { PastelThemeDark } from "./PastelThemeDark";

const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

const numPlayersConfig = {
  [GameMapType.GatewayToTheAtlantic]: [80, 60, 40],
  [GameMapType.SouthAmerica]: [70, 50, 40],
  [GameMapType.NorthAmerica]: [80, 60, 50],
  [GameMapType.Africa]: [100, 80, 50],
  [GameMapType.Europe]: [80, 50, 30],
  [GameMapType.Australia]: [50, 40, 30],
  [GameMapType.Iceland]: [50, 40, 30],
  [GameMapType.Britannia]: [50, 40, 30],
  [GameMapType.Asia]: [60, 50, 30],
  [GameMapType.FalklandIslands]: [80, 50, 30],
  [GameMapType.Baikal]: [60, 50, 40],
  [GameMapType.Mena]: [60, 50, 30],
  [GameMapType.Mars]: [50, 40, 30],
  [GameMapType.Oceania]: [30, 20, 10],
  [GameMapType.EastAsia]: [50, 40, 30],
  [GameMapType.FaroeIslands]: [50, 40, 30],
  [GameMapType.DeglaciatedAntarctica]: [50, 40, 30],
  [GameMapType.EuropeClassic]: [80, 30, 50],
  [GameMapType.BetweenTwoSeas]: [40, 50, 30],
  [GameMapType.BlackSea]: [40, 50, 30],
  [GameMapType.Pangaea]: [40, 20, 30],
  [GameMapType.World]: [150, 80, 50],
  [GameMapType.GiantWorldMap]: [150, 100, 60],
  [GameMapType.Halkidiki]: [50, 40, 30],
  [GameMapType.StraitOfGibraltar]: [50, 40, 30],
  [GameMapType.Italia]: [50, 40, 30],
} as const satisfies Record<GameMapType, [number, number, number]>;

const TERRAIN_EFFECTS = {
  [TerrainType.Plains]: { mag: 1, speed: 0.8 }, // higher speed, lower damage
  [TerrainType.Highland]: { mag: 1.1, speed: 1 },
  [TerrainType.Mountain]: { mag: 1.2, speed: 1.2 },
} as const;

export abstract class DefaultServerConfig implements ServerConfig {
  private publicKey: JWK;
  abstract jwtAudience(): string;
  jwtIssuer(): string {
    const audience = this.jwtAudience();
    return audience === "localhost"
      ? "http://localhost:8787"
      : `https://api.${audience}`;
  }
  async jwkPublicKey(): Promise<JWK> {
    if (this.publicKey) return this.publicKey;
    const jwksUrl = this.jwtIssuer() + "/.well-known/jwks.json";
    console.log(`Fetching JWKS from ${jwksUrl}`);
    const response = await fetch(jwksUrl);
    const result = JwksSchema.safeParse(await response.json());
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing JWKS", error);
      throw new Error("Invalid JWKS");
    }
    this.publicKey = result.data.keys[0];
    return this.publicKey;
  }
  otelEnabled(): boolean {
    return (
      Boolean(this.otelEndpoint()) &&
      Boolean(this.otelUsername()) &&
      Boolean(this.otelPassword())
    );
  }
  otelEndpoint(): string {
    return process.env.OTEL_ENDPOINT ?? "";
  }
  otelUsername(): string {
    return process.env.OTEL_USERNAME ?? "";
  }
  otelPassword(): string {
    return process.env.OTEL_PASSWORD ?? "";
  }
  region(): string {
    if (this.env() === GameEnv.Dev) {
      return "dev";
    }
    return process.env.REGION ?? "";
  }
  gitCommit(): string {
    return process.env.GIT_COMMIT ?? "";
  }
  r2Endpoint(): string {
    return `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  r2AccessKey(): string {
    return process.env.R2_ACCESS_KEY ?? "";
  }
  r2SecretKey(): string {
    return process.env.R2_SECRET_KEY ?? "";
  }

  r2Bucket(): string {
    return process.env.R2_BUCKET ?? "";
  }

  adminHeader(): string {
    return "x-admin-key";
  }
  adminToken(): string {
    return process.env.ADMIN_TOKEN ?? "dummy-admin-token";
  }
  abstract numWorkers(): number;
  abstract env(): GameEnv;
  turnIntervalMs(): number {
    return 100;
  }
  gameCreationRate(): number {
    return 60 * 1000;
  }

  lobbyMaxPlayers(
    map: GameMapType,
    mode: GameMode,
    numPlayerTeams: TeamCountConfig | undefined,
  ): number {
    const [l, m, s] = numPlayersConfig[map] ?? [50, 30, 20];
    const r = Math.random();
    const base = r < 0.3 ? l : r < 0.6 ? m : s;
    let p = Math.min(mode === GameMode.Team ? Math.ceil(base * 1.5) : base, l);
    if (numPlayerTeams === undefined) return p;
    switch (numPlayerTeams) {
      case Duos:
        p -= p % 2;
        break;
      case Trios:
        p -= p % 3;
        break;
      case Quads:
        p -= p % 4;
        break;
      default:
        p -= p % numPlayerTeams;
        break;
    }
    return p;
  }

  workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % this.numWorkers();
  }
  workerPath(gameID: GameID): string {
    return `w${this.workerIndex(gameID)}`;
  }
  workerPort(gameID: GameID): number {
    return this.workerPortByIndex(this.workerIndex(gameID));
  }
  workerPortByIndex(index: number): number {
    return 3001 + index;
  }
}

export class DefaultConfig implements Config {
  private pastelTheme: PastelTheme = new PastelTheme();
  private pastelThemeDark: PastelThemeDark = new PastelThemeDark();
  constructor(
    private _serverConfig: ServerConfig,
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
    private _isReplay: boolean,
  ) {}
  isReplay(): boolean {
    return this._isReplay;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorDuration(): number {
    return 60 * 10; // 1 min
  }
  spawnImmunityDuration(): Tick {
    return 5 * 10;
  }

  peaceTimerDuration(): number {
    return (
      this._gameConfig.peaceTimerDurationMinutes ?? PeaceTimerDuration.None
    );
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  serverConfig(): ServerConfig {
    return this._serverConfig;
  }

  userSettings(): UserSettings {
    if (this._userSettings === null) {
      throw new Error("userSettings is null");
    }
    return this._userSettings;
  }

  difficultyModifier(difficulty: Difficulty): number {
    switch (difficulty) {
      case Difficulty.Easy:
        return 1;
      case Difficulty.Medium:
        return 3;
      case Difficulty.Hard:
        return 9;
      case Difficulty.Impossible:
        return 18;
    }
  }

  cityPopulationIncrease(): number {
    return 250_000;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [3, 1]
    return 2 - 0.9 * falloutRatio;
  }

  //SAMs
  samNukeHittingChance(): number {
    return 1;
  }
  samPlaneHittingChance(): number {
    return 0.8;
  }
  samWarheadHittingChance(): number {
    return 0.5;
  }
  SAMNukeCooldown(): number {
    return 75;
  }
  SAMPlaneCooldown(): number {
    return 40;
  }

  SiloCooldown(): number {
    return 75;
  }

  defensePostRange(): number {
    return 40;
  }
  defensePostLossMultiplier(): number {
    return 8;
  }
  defensePostSpeedMultiplier(): number {
    return 4;
  }
  playerTeams(): TeamCountConfig {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNPCs(): boolean {
    return !this._gameConfig.disableNPCs;
  }

  isUnitDisabled(unitType: UnitType): boolean {
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }

  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  tradeShipGold(dist: number): Gold {
    return BigInt(Math.floor(10000 + 150 * Math.pow(dist, 1.1)));
  }
  tradeShipSpawnRate(numberOfPorts: number): number {
    return Math.round(10 * Math.pow(numberOfPorts, 0.37));
  }

  // Cargoplanes (Turned off for now)
  cargoPlanesEnabled(): boolean {
    return false;
  }
  cargoPlaneGold(distance: number): Gold {
    const tradeShipGold = this.tradeShipGold(distance);
    return BigInt(Math.floor(Number(tradeShipGold) * 0.6));
  }
  cargoPlaneSpawnRate(numberOfAirfields: number): number {
    return Math.min(50, Math.round(10 * Math.pow(numberOfAirfields, 0.6)));
  }
  cargoPlaneMaxNumber(): number {
    return 3;
  }

  // Bomber planes
  bombersEnabled(): boolean {
    return true;
  }
  bomberSpawnInterval(): number {
    return 20;
  }
  bomberPayload(): number {
    return 1;
  }
  bomberDropCadence(): number {
    return 1;
  }
  bomberTargetRange(): number {
    return 250;
  }
  bomberExplosionRadius(): number {
    return 4;
  }
  bomberSpeed(): number {
    return 2;
  }

  // Fighter Jets
  fighterJetPatrolRange(): number {
    return 75;
  }
  fighterJetTargettingRange(): number {
    return 130;
  }
  fighterJetAttackRate(): number {
    return 15;
  }
  fighterJetSpeed(): number {
    return 2;
  }
  fighterJetHealingAmount(): number {
    return 1;
  }
  fighterJetTargetReachedDistance(): number {
    return 10;
  }
  fighterJetDogfightDistance(): number {
    return 40;
  }
  fighterJetMinDogfightDistance(): number {
    return 10;
  }

  unitInfo(type: UnitType): UnitInfo {
    switch (type) {
      case UnitType.TransportShip:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.Warship:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    1_000_000,
                    (p.unitsOwned(UnitType.Warship) + 1) * 250_000,
                  ),
                ),
          territoryBound: false,
          maxHealth: 1000,
        };
      case UnitType.Shell:
        return {
          cost: () => 0n,
          territoryBound: false,
          damage: 250,
        };
      case UnitType.SAMMissile:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.Port:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    1_000_000,
                    Math.pow(2, p.unitsOwned(UnitType.Port)) * 125_000,
                  ),
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          maxHealth: 750,
        };
      case UnitType.AtomBomb:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : 750_000n,
          territoryBound: false,
        };
      case UnitType.HydrogenBomb:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : 5_000_000n,
          territoryBound: false,
        };
      case UnitType.MIRV:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : 35_000_000n,
          territoryBound: false,
        };
      case UnitType.MIRVWarhead:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.TradeShip:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.MissileSilo:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : 1_000_000n,
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          maxHealth: 750,
        };
      case UnitType.DefensePost:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    250_000,
                    (p.unitsOwned(UnitType.DefensePost) + 1) * 50_000,
                  ),
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          maxHealth: 750,
        };
      case UnitType.SAMLauncher:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    3_000_000,
                    (p.unitsOwned(UnitType.SAMLauncher) + 1) * 1_500_000,
                  ),
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 30 * 10,
          maxHealth: 750,
        };
      case UnitType.City:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    1_000_000,
                    Math.pow(2, p.unitsOwned(UnitType.City)) * 125_000,
                  ),
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          maxHealth: 750,
        };
      case UnitType.Construction:
        return {
          cost: () => 0n,
          territoryBound: true,
        };
      case UnitType.Hospital:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    3_000_000,
                    Math.pow(2, p.unitsOwned(UnitType.Hospital)) * 1_500_000,
                  ),
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          maxHealth: 750,
        };
      case UnitType.Academy:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    3_000_000,
                    Math.pow(2, p.unitsOwned(UnitType.Academy)) * 1_500_000,
                  ),
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          maxHealth: 750,
        };
      case UnitType.Airfield:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    2_000_000,
                    Math.pow(2, p.unitsOwned(UnitType.Airfield)) * 400_000,
                  ),
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 20,
          maxHealth: 750,
        };
      case UnitType.CargoPlane:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.Bomber:
        return {
          cost: () => 0n,
          territoryBound: false,
          maxHealth: 500,
        };
      case UnitType.FighterJet:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0n
              : BigInt(
                  Math.min(
                    1_000_000,
                    (p.unitsOwned(UnitType.FighterJet) + 1) * 250_000,
                  ),
                ),
          territoryBound: false,
          maxHealth: 750,
        };
      default:
        assertNever(type);
    }
  }
  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    return 600 * 10; // 10 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }

  percentageTilesOwnedToWin(): number {
    if (this._gameConfig.gameMode === GameMode.Team) {
      return 95;
    }
    return 80;
  }
  boatMaxNumber(): number {
    return 3;
  }
  numSpawnPhaseTurns(): number {
    return this._gameConfig.gameType === GameType.Singleplayer ? 100 : 300;
  }
  numBots(): number {
    return this.bots();
  }
  theme(): Theme {
    return this.userSettings()?.darkMode()
      ? this.pastelThemeDark
      : this.pastelTheme;
  }

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
  } {
    // Check if peace timer is active
    const isPeaceTimerActive =
      gm.peaceTimerEndsAtTick !== null && gm.ticks() < gm.peaceTimerEndsAtTick;

    if (isPeaceTimerActive) {
      const attackerType = attacker.type();
      const defenderType = defender.isPlayer() ? defender.type() : null;

      // If both attacker and defender are Human or FakeHuman, block the attack
      if (
        (attackerType === PlayerType.Human ||
          attackerType === PlayerType.FakeHuman) &&
        (defenderType === PlayerType.Human ||
          defenderType === PlayerType.FakeHuman)
      ) {
        // Display a message to the players
        gm.displayMessage(
          `Attack blocked: Peace timer is active.`,
          MessageType.PEACE_TIMER_BLOCKED,
          attacker.id(),
        );
        // Return zero losses and zero tiles conquered to effectively block the attack
        return {
          attackerTroopLoss: 0,
          defenderTroopLoss: 0,
          tilesPerTickUsed: 0,
        };
      }
    }

    const type = gm.terrainType(tileToConquer);
    const mod = TERRAIN_EFFECTS[type];
    if (!mod) {
      throw new Error(`terrain type ${type} not supported`);
    }
    let mag = mod.mag;
    let speed = mod.speed;

    const attackerType = attacker.type();
    const defenderIsPlayer = defender.isPlayer();
    const defenderType = defenderIsPlayer ? defender.type() : null;

    if (defenderIsPlayer) {
      let maxDefensePostHealthRatio = 0;
      for (const dp of gm.nearbyUnits(
        tileToConquer,
        gm.config().defensePostRange(),
        UnitType.DefensePost,
        ({ unit }) => unit.owner() === defender,
      )) {
        const ratio = dp.unit.hasHealth()
          ? Number(dp.unit.health()) / (dp.unit.info().maxHealth ?? 1)
          : 1;
        if (ratio > maxDefensePostHealthRatio) {
          maxDefensePostHealthRatio = ratio;
        }
      }
      if (maxDefensePostHealthRatio > 0) {
        mag *= this.defensePostLossMultiplier() * maxDefensePostHealthRatio;
        speed /= this.defensePostSpeedMultiplier() * maxDefensePostHealthRatio;
      }
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numLandTiles();
      mag *= this.falloutDefenseModifier(falloutRatio);
      speed *= this.falloutDefenseModifier(falloutRatio);
    }

    if (attacker.isPlayer() && defenderIsPlayer) {
      if (
        (attackerType === PlayerType.Human ||
          attackerType === PlayerType.FakeHuman) &&
        defenderType === PlayerType.Bot
      ) {
        mag *= 0.6;
        speed *= 0.6;
      }
    }
    if (attackerType === PlayerType.Bot) {
      speed *= 10; // slow bot attacks
    }
    if (defenderIsPlayer) {
      const defenderTroops = defender.troops();
      const defenderTiles = defender.numTilesOwned();
      const defenderDensity = defenderTroops / defenderTiles;
      const attackRatio = defenderTroops / attackTroops;
      const traitorDebuff = defender.isTraitor()
        ? this.traitorDefenseDebuff()
        : 1;
      const baseTroopLoss = 10;
      const attackLossModifier = 1.35;
      const academyAttackModifier =
        1.2 - 0.2 * 0.5 ** defender.effectiveUnits(UnitType.Academy);
      const academyDefenseModifier =
        1.2 - 0.2 * 0.5 ** attacker.effectiveUnits(UnitType.Academy);
      const baseTileCost = 45;
      const attackStandardSize = 10_000;
      return {
        attackerTroopLoss:
          mag *
          academyAttackModifier *
          (baseTroopLoss +
            attackLossModifier * defenderDensity * traitorDebuff),
        defenderTroopLoss: defenderDensity * academyDefenseModifier,
        tilesPerTickUsed:
          (baseTileCost / academyDefenseModifier) *
          within(defenderDensity, 3, 50) ** 0.2 *
          (attackStandardSize / attackTroops) ** 0.225 *
          speed *
          within(attackRatio, 0.1, 20) ** 0.37,
      };
    } else {
      return {
        attackerTroopLoss: 12 * mag,
        defenderTroopLoss: 0,
        tilesPerTickUsed: 492 * speed * within(attackTroops, 1, 10000) ** -0.3,
      };
    }
  }

  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    if (defender.isPlayer()) {
      return 10 * numAdjacentTilesWithEnemy;
    } else {
      return 12 * numAdjacentTilesWithEnemy;
    }
  }

  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number {
    return Math.floor(attacker.troops() / 5);
  }

  warshipShellLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusPortSpawn() {
    return 20;
  }

  proximityBonusPortsNb(totalPorts: number) {
    return within(totalPorts / 3, 4, totalPorts);
  }

  proximityBonusAirfieldsNumber(totalAirfields: number) {
    return within(totalAirfields / 3, 4, totalAirfields);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() === PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 6_000;
    }
    if (playerInfo.playerType === PlayerType.FakeHuman) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 2_500 + 1000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Medium:
          return 5_000 + 2000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Hard:
          return 18_000 + 4000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Impossible:
          return 45_000 + 8000 * (playerInfo?.nation?.strength ?? 1);
      }
    }
    return this.infiniteTroops() ? 1_000_000 : 20_000;
  }

  maxPopulation(player: Player | PlayerView): number {
    const maxPop =
      player.type() === PlayerType.Human && this.infiniteTroops()
        ? 1_000_000_000
        : 1 * (player.numTilesOwned() * 30 + 50000) +
          player.effectiveUnits(UnitType.City) * this.cityPopulationIncrease();

    if (player.type() === PlayerType.Bot) {
      return maxPop / 2;
    }

    if (player.type() === PlayerType.Human) {
      return maxPop;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxPop * 0.4;
      case Difficulty.Medium:
        return maxPop * 0.7;
      case Difficulty.Hard:
        return maxPop * 1.4;
      case Difficulty.Impossible:
        return maxPop * 1.8;
    }
  }

  populationIncreaseRate(player: Player): number {
    const max = this.maxPopulation(player);
    //population grows proportional to current population with growth decreasing as it approaches max
    // smaller countries recieve a boost to pop growth to speed up early game
    const baseAdditionRate = 10;
    const basePopGrowthRate = 1200 / max + 1 / 200;
    const reproductionPop = player.troops() + 1.15 * player.workers();
    let toAdd = baseAdditionRate + basePopGrowthRate * reproductionPop;
    const totalPop = player.totalPopulation();
    const ratio = Math.max(1 - totalPop / max, 0);
    toAdd *= ratio ** 1.222;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.7;
    }

    if (player.type() === PlayerType.FakeHuman) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.7;
          break;
        case Difficulty.Medium:
          toAdd *= 0.8;
          break;
        case Difficulty.Hard:
          toAdd *= 1.0;
          break;
        case Difficulty.Impossible:
          toAdd *= 1.2;
          break;
      }
    }

    return Math.min(totalPop + toAdd, max) - totalPop;
  }

  goldAdditionRate(player: Player): bigint {
    const base = 0.06 * player.workers() ** 0.65;
    const productivity = player.productivity();
    const investmentRate = player.investmentRate();
    const grossGold = base * productivity;
    const netGold = grossGold * (1 - investmentRate);

    if (!Number.isFinite(netGold)) {
      console.warn("[goldAdditionRate] netGold is NaN or invalid", {
        workers: player.workers(),
        productivity,
        investmentRate,
        base,
        grossGold,
        netGold,
      });
      return 0n;
    }

    return BigInt(Math.floor(netGold));
  }

  troopAdjustmentRate(player: Player): number {
    const maxDiff = this.maxPopulation(player) / 600;
    const target = player.population() * player.targetTroopRatio();
    const diff = target - player.troops();
    if (Math.abs(diff) < maxDiff) {
      return diff;
    }
    const adjustment = maxDiff * Math.sign(diff);
    // Can ramp down troops much faster
    if (adjustment < 0) {
      return adjustment * 5;
    }
    return adjustment;
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 12, outer: 18 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  nukeAllianceBreakThreshold(): number {
    return 100;
  }

  defaultNukeSpeed(): number {
    return 6;
  }

  defaultNukeTargetableRange(): number {
    return 120;
  }

  defaultSamRange(): number {
    return 80;
  }

  // Humans can be population, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(humans: number, tilesOwned: number): number {
    return (5 * humans) / Math.max(1, tilesOwned);
  }

  structureMinDist(): number {
    // TODO: Increase this to ~15 once upgradable structures are implemented.
    return 1;
  }

  shellLifetime(): number {
    return 50;
  }

  warshipPatrolRange(): number {
    return 100;
  }

  warshipTargettingRange(): number {
    return 130;
  }

  warshipShellAttackRate(): number {
    return 20;
  }

  defensePostShellAttackRate(): number {
    return 100;
  }

  safeFromPiratesCooldownMax(): number {
    return 20;
  }

  defensePostTargettingRange(): number {
    return 75;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }

  maxProductivity(): number {
    return 5; // 500%
  }

  maxInvestmentRate(): number {
    return 0.5; // 50%
  }
}
