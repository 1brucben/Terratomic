import { EventEmitter } from "events";
import { Logger } from "winston";
import WebSocket from "ws";
import {
  GameConfig,
  GameStartInfo,
  PeaceTimerDuration,
} from "../src/core/Schemas";
import { GameEnv, ServerConfig } from "../src/core/configuration/Config";
import {
  Difficulty,
  GameMapType,
  GameMode,
  GameType,
} from "../src/core/game/Game";
import { Client } from "../src/server/Client";
import { GameServer } from "../src/server/GameServer";

class MockServerConfig implements ServerConfig {
  turnIntervalMs(): number {
    return 1000;
  }
  gameCreationRate(): number {
    return 1000;
  }
  lobbyMaxPlayers(): number {
    return 100;
  }
  numWorkers(): number {
    return 1;
  }
  workerIndex(): number {
    return 0;
  }
  workerPath(): string {
    return "w0";
  }
  workerPort(): number {
    return 3000;
  }
  workerPortByIndex(): number {
    return 3000;
  }
  env(): GameEnv {
    return GameEnv.Dev;
  }
  region(): string {
    return "test";
  }
  adminToken(): string {
    return "token";
  }
  adminHeader(): string {
    return "x-admin";
  }
  gitCommit(): string {
    return "test";
  }
  r2Bucket(): string {
    return "";
  }
  r2Endpoint(): string {
    return "";
  }
  r2AccessKey(): string {
    return "";
  }
  r2SecretKey(): string {
    return "";
  }
  otelEnabled(): boolean {
    return false;
  }
  otelEndpoint(): string {
    return "";
  }
  otelUsername(): string {
    return "";
  }
  otelPassword(): string {
    return "";
  }
  jwtAudience(): string {
    return "localhost";
  }
  jwtIssuer(): string {
    return "localhost";
  }
  jwkPublicKey(): Promise<any> {
    return Promise.resolve({});
  }
}

const baseGameConfig: GameConfig = {
  gameMap: GameMapType.World,
  gameMode: GameMode.Team,
  gameType: GameType.Private,
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
};

const createLogger = (): Logger => {
  const noop = () => {};
  const logger: any = {
    info: noop,
    warn: noop,
    error: noop,
  };
  logger.child = () => logger;
  return logger as Logger;
};

class MockSocket extends EventEmitter {
  public readyState = WebSocket.OPEN;
  public send = jest.fn();
  public close = jest.fn();
}

const createClient = (clientID: string) => {
  const socket = new MockSocket();
  const client = new Client(
    clientID,
    `persistent-${clientID}`,
    null,
    undefined,
    "127.0.0.1",
    clientID,
    socket as unknown as WebSocket,
    "fr",
  );
  (client as any).__mockSocket = socket;
  return client;
};

const createServer = (overrides: Partial<GameConfig> = {}) =>
  new GameServer(
    "ABCDEFGH",
    createLogger(),
    Date.now(),
    new MockServerConfig(),
    { ...baseGameConfig, ...overrides },
  );

const setStarted = (
  server: GameServer,
  players: { username: string; clientID: string; flag?: string }[],
) => {
  (server as any)._hasStarted = true;
  const startInfo: GameStartInfo = {
    gameID: server.id,
    config: server.gameConfig,
    players: players.map((p) => ({
      username: p.username,
      clientID: p.clientID,
      flag: p.flag ?? "fr",
    })),
  };
  (server as any).gameStartInfo = startInfo;
};

describe("GameServer authorization", () => {
  it("rejects unknown clients once the game has started", () => {
    const server = createServer({
      playerTeamAssignments: {
        legit: 0,
      },
    });
    setStarted(server, [{ username: "Legit", clientID: "legit" }]);

    const intruder = createClient("intruder");
    server.addClient(intruder, 0);

    const ws = (intruder as any).__mockSocket as MockSocket;
    expect(ws.close).toHaveBeenCalledWith(1008, "Game has already started");
    expect(server.activeClients).toHaveLength(0);
  });

  it("allows original players to reconnect after the game has started", () => {
    const server = createServer({
      playerTeamAssignments: {
        legit: 0,
      },
    });
    setStarted(server, [{ username: "Legit", clientID: "legit" }]);

    const legit = createClient("legit");
    server.addClient(legit, 0);

    const ws = (legit as any).__mockSocket as MockSocket;
    expect(ws.close).not.toHaveBeenCalled();
    expect(server.activeClients).toHaveLength(1);
  });

  it("allows designated spectators to reconnect after the game has started", () => {
    const server = createServer({
      playerTeamAssignments: {
        spectator: -1,
      },
    });
    setStarted(server, []);

    const spectator = createClient("spectator");
    server.addClient(spectator, 0);

    const ws = (spectator as any).__mockSocket as MockSocket;
    expect(ws.close).not.toHaveBeenCalled();
    expect(server.activeClients).toHaveLength(1);
  });
});
