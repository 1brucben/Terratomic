import { placeName } from "../client/graphics/NameBoxCalculator";
import { getConfig } from "./configuration/ConfigLoader";
import { AllianceExpireCheckExecution } from "./execution/alliance/AllianceExpireCheckExecution";
import { CapitalRecalculationExecution } from "./execution/CapitalRecalculationExecution";
import { Executor } from "./execution/ExecutionManager";
import { TradeManagerExecution } from "./execution/TradeManagerExecution";
import { WinCheckExecution } from "./execution/WinCheckExecution";
import { AllianceImpl } from "./game/AllianceImpl";
import {
  AllPlayers,
  Attack,
  Cell,
  Game,
  GameUpdates,
  NameViewData,
  Nation,
  Player,
  PlayerActions,
  PlayerBorderTiles,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  UnitType,
} from "./game/Game";
import { createGame } from "./game/GameImpl";
import { TileRef } from "./game/GameMap";
import {
  AllianceViewData,
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
} from "./game/GameUpdates";
import { loadTerrainMap as loadGameMap } from "./game/TerrainMapLoader";
import { PseudoRandom } from "./PseudoRandom";
import { ClientID, GameStartInfo, Turn } from "./Schemas";
import { getTechNodes } from "./tech/ResearchTree";
import { sanitize, simpleHash } from "./Util";
import { fixProfaneUsername } from "./validations/username";

export async function createGameRunner(
  gameStart: GameStartInfo,
  clientID: ClientID,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
): Promise<GameRunner> {
  const config = await getConfig(gameStart.config, null);
  const gameMap = await loadGameMap(gameStart.config.gameMap);
  const random = new PseudoRandom(simpleHash(gameStart.gameID));

  const humans = gameStart.players.map(
    (p) =>
      new PlayerInfo(
        p.flag,
        p.clientID === clientID
          ? sanitize(p.username)
          : fixProfaneUsername(sanitize(p.username)),
        PlayerType.Human,
        p.clientID,
        random.nextID(),
      ),
  );

  const nations = gameStart.config.disableNPCs
    ? []
    : gameMap.nationMap.nations.map(
        (n) =>
          new Nation(
            new Cell(n.coordinates[0], n.coordinates[1]),
            n.strength,
            new PlayerInfo(
              n.flag || "",
              n.name,
              PlayerType.FakeHuman,
              null,
              random.nextID(),
            ),
          ),
      );

  const game: Game = createGame(
    humans,
    nations,
    gameMap.gameMap,
    gameMap.miniGameMap,
    config,
  );

  const gr = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, clientID),
    callBack,
    clientID,
  );
  gr.init();
  return gr;
}

function toAllianceViewData(
  alliance: AllianceImpl,
  me: Player,
): AllianceViewData {
  return {
    requestorID: alliance.requestor().smallID(),
    recipientID: alliance.recipient().smallID(),
    createdAt: alliance.createdAt(),
    extensionRequestedByMe: alliance.extensionRequestedBy(me),
    extensionRequestedByOther: alliance.extensionRequestedBy(
      alliance.otherPlayer(me),
    ),
  };
}

export class GameRunner {
  private turns: Turn[] = [];
  private currTurn = 0;
  private isExecuting = false;

  private playerViewData: Record<PlayerID, NameViewData> = {};
  private clientID: ClientID;
  // Per-client submarine visibility state
  private lastVisibleBySub: Map<number, boolean> = new Map();
  private lastRevealTickBySub: Map<number, number> = new Map();
  private lastKnownPosBySub: Map<number, TileRef> = new Map();
  private ghostActiveUntilBySub: Map<number, number> = new Map();

  constructor(
    public game: Game,
    private execManager: Executor,
    private callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
    clientID: ClientID,
  ) {
    this.clientID = clientID;
  }

  /**
   * Filter and augment Unit updates for this specific client to enforce submarine stealth rules.
   * Exported for tests to validate visibility behavior without needing to spin the runner loop.
   */
  public filterUpdatesForClient(updates: GameUpdates): GameUpdates {
    // Start from a shallow copy to preserve all non-Unit update arrays
    const filtered = { ...(updates as any) } as GameUpdates;
    const newUnits: (typeof updates)[GameUpdateType.Unit] = [];

    const me = this.game.playerByClientID(this.clientID);
    const tickNow = this.game.ticks();
    const linger = this.game.config().submarineDetectionLingerTicks?.() ?? 20;
    const ghostLinger = this.game.config().submarineGhostLingerTicks?.() ?? 300;

    for (const u of updates[GameUpdateType.Unit]) {
      // Only filter submarines; pass-through everything else
      if (u.unitType !== UnitType.Submarine) {
        newUnits.push(u);
        continue;
      }

      // Owner always sees their own submarine
      const owner = this.game.playerBySmallID(u.ownerID);
      if (me && owner.isPlayer() && me.smallID() === owner.smallID()) {
        this.lastVisibleBySub.set(u.id, true);
        this.lastRevealTickBySub.set(u.id, tickNow);
        this.lastKnownPosBySub.set(u.id, u.pos);
        this.ghostActiveUntilBySub.delete(u.id);
        newUnits.push(u);
        continue;
      }

      // Compute visibility for this viewer
      const isAttacking = (u as any).isAttacking === true;
      const endsAt = (u as any).cooldownEndsAt as number | undefined;
      const ticksLeft = (u as any).ticksLeftInCooldown as number | undefined;
      const isOnCooldown =
        endsAt !== undefined ? tickNow < endsAt : (ticksLeft ?? 0) > 0;

      // Detection is per-viewer: only if viewer has their own naval unit nearby
      let detectedByViewer = false;
      if (me && owner.isPlayer() && me.smallID() !== owner.smallID()) {
        const range = this.game.config().warshipTargettingRange();
        const nearby = this.game.nearbyUnits(u.pos, range, [
          UnitType.Warship,
          UnitType.Submarine,
        ]);
        detectedByViewer = nearby.some(({ unit }) => unit.owner() === me);
      }

      const baseVisible = isAttacking || isOnCooldown || detectedByViewer;
      const lastReveal = this.lastRevealTickBySub.get(u.id);
      const lingerVisible =
        lastReveal !== undefined ? tickNow - lastReveal < linger : false;
      const visibleNow = baseVisible || lingerVisible;

      if (visibleNow) {
        this.lastVisibleBySub.set(u.id, true);
        if (baseVisible) this.lastRevealTickBySub.set(u.id, tickNow);
        this.lastKnownPosBySub.set(u.id, u.pos);
        this.ghostActiveUntilBySub.delete(u.id);
        newUnits.push(u);
        continue;
      }

      // Hidden now; maybe emit a one-time ghost update when transitioning from visible
      const wasVisible = this.lastVisibleBySub.get(u.id) === true;
      this.lastVisibleBySub.set(u.id, false);
      if (wasVisible) {
        const until = tickNow + ghostLinger;
        this.ghostActiveUntilBySub.set(u.id, until);
        const ghostUpdate = {
          ...u,
          isActive: false,
          targetable: false,
          retreating: false,
          reachedTarget: false,
          troops: 0,
          pos: this.lastKnownPosBySub.get(u.id) ?? u.pos,
          lastPos: this.lastKnownPosBySub.get(u.id) ?? u.lastPos,
          ghost: true,
          ghostExpiresAt: until,
        } as any;
        newUnits.push(ghostUpdate);
        continue;
      }

      // If ghost is still active, do not send repeats; otherwise drop completely
      const ghostUntil = this.ghostActiveUntilBySub.get(u.id);
      if (ghostUntil && tickNow < ghostUntil) {
        // No-op: keep hidden without resending
      } else if (ghostUntil && tickNow >= ghostUntil) {
        this.ghostActiveUntilBySub.delete(u.id);
      }
      // Drop this update for the viewer
    }

    filtered[GameUpdateType.Unit] = newUnits;
    return filtered;
  }

  init() {
    // Optionally grant all techs to all players at game start
    if (this.game.config().gameConfig().researchAllTechs) {
      const nodes = getTechNodes();
      const techIds = nodes.map((n) => n.id);
      // Use allPlayers() so we include unspawned players at game start
      this.game
        .allPlayers()
        .forEach((p) =>
          techIds.forEach((id) => (p as any).addResearchedTech?.(id)),
        );
    }
    if (this.game.config().bots() > 0) {
      this.game.addExecution(
        ...this.execManager.spawnBots(this.game.config().numBots()),
      );
    }
    if (this.game.config().spawnNPCs()) {
      this.game.addExecution(...this.execManager.fakeHumanExecutions());
    }
    this.game.addExecution(new WinCheckExecution());
    this.game.addExecution(new AllianceExpireCheckExecution());
    // Background: periodically compute player capitals (geographic centers)
    this.game.addExecution(new CapitalRecalculationExecution());
    // Trade rework: central trade manager for demand/supply/assignment
    this.game.addExecution(new TradeManagerExecution());
  }

  public addTurn(turn: Turn): void {
    this.turns.push(turn);
  }

  public executeNextTick() {
    if (this.isExecuting) {
      return;
    }
    if (this.currTurn >= this.turns.length) {
      return;
    }
    this.isExecuting = true;

    this.game.addExecution(
      ...this.execManager.createExecs(this.turns[this.currTurn]),
    );
    this.currTurn++;

    let updates: GameUpdates;

    try {
      updates = this.game.executeNextTick();
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Game tick error:", error.message);
        this.callBack({
          errMsg: error.message,
          stack: error.stack,
        } as ErrorUpdate);
      } else {
        console.error("Game tick error:", error);
      }
      return;
    }

    if (this.game.inSpawnPhase() && this.game.ticks() % 2 === 0) {
      this.game
        .players()
        .filter(
          (p) =>
            p.type() === PlayerType.Human || p.type() === PlayerType.FakeHuman,
        )
        .forEach(
          (p) => (this.playerViewData[p.id()] = placeName(this.game, p)),
        );
    }

    if (this.game.ticks() < 3 || this.game.ticks() % 30 === 0) {
      this.game.players().forEach((p) => {
        this.playerViewData[p.id()] = placeName(this.game, p);
      });
    }

    // Submarine periodic visibility ping disabled: removing automatic reveal blips

    // Apply per-client submarine filtering before sending
    updates = this.filterUpdatesForClient(updates);

    // Many tiles are updated to pack it into an array
    const packedTileUpdates = updates[GameUpdateType.Tile].map((u) => u.update);
    updates[GameUpdateType.Tile] = [];
    const me = this.game.playerByClientID(this.clientID);
    const alliances = me
      ? this.game
          .alliances()
          .filter((a) =>
            [a.requestor().smallID(), a.recipient().smallID()].includes(
              me.smallID(),
            ),
          )
          .map((a) => toAllianceViewData(a as AllianceImpl, me))
      : [];
    this.callBack({
      tick: this.game.ticks(),
      packedTileUpdates: new BigUint64Array(packedTileUpdates),
      updates: updates,
      playerNameViewData: this.playerViewData,
      alliances: alliances,
      peaceTimerEndsAtTick: this.game.peaceTimerEndsAtTick,
    });
    this.isExecuting = false;
  }

  public playerActions(
    playerID: PlayerID,
    x: number,
    y: number,
  ): PlayerActions {
    const player = this.game.player(playerID);
    const tile = this.game.ref(x, y);
    const actions = {
      canAttack: player.canAttack(tile),
      buildableUnits: player.buildableUnits(tile),
      canSendEmojiAllPlayers: player.canSendEmoji(AllPlayers),
    } as PlayerActions;

    if (this.game.hasOwner(tile)) {
      const other = this.game.owner(tile) as Player;
      actions.interaction = {
        sharedBorder: player.sharesBorderWith(other),
        canSendEmoji: player.canSendEmoji(other),
        canTarget: player.canTarget(other),
        canSendAllianceRequest: player.canSendAllianceRequest(other),
        canBreakAlliance: player.isAlliedWith(other),
        // Only show Peace when at war
        canRequestPeace: player.isAtWarWith(other),
        canDonate: player.canDonate(other),
        canEmbargo: !player.hasEmbargoAgainst(other),
      };
      const alliance = player.allianceWith(other as Player);
      if (alliance) {
        actions.interaction.allianceCreatedAtTick = alliance.createdAt();
      }
    }

    return actions;
  }
  public playerProfile(playerID: number): PlayerProfile {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.playerProfile();
  }
  public playerBorderTiles(playerID: PlayerID): PlayerBorderTiles {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return {
      borderTiles: player.borderTiles(),
    } as PlayerBorderTiles;
  }

  public attackAveragePosition(
    playerID: number,
    attackID: string,
  ): Cell | null {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }

    const condition = (a: Attack) => a.id() === attackID;
    const attack =
      player.outgoingAttacks().find(condition) ??
      player.incomingAttacks().find(condition);
    if (attack === undefined) {
      return null;
    }

    return attack.averagePosition();
  }

  public bestTransportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): TileRef | false {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.bestTransportShipSpawn(targetTile);
  }
}
