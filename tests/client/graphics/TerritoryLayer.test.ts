/**
 * @jest-environment jsdom
 */
import { Colord } from "colord";
import { TerritoryLayer } from "../../../src/client/graphics/layers/TerritoryLayer";
import { Theme } from "../../../src/core/configuration/Config";
import { TileRef } from "../../../src/core/game/GameMap";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { GameView, PlayerView } from "../../../src/core/game/GameView";

describe("TerritoryLayer", () => {
  let game: GameView;
  let eventBus: any;
  let transformHandler: any;
  let mockTheme: Theme;

  beforeEach(() => {
    const player1: PlayerView = {
      id: jest.fn(() => 1),
      borderTiles: jest.fn(() =>
        Promise.resolve({ borderTiles: new Set<TileRef>() }),
      ),
    } as any;
    const player2: PlayerView = {
      id: jest.fn(() => 2),
      borderTiles: jest.fn(() =>
        Promise.resolve({ borderTiles: new Set<TileRef>() }),
      ),
    } as any;

    mockTheme = {
      teamColor: jest.fn(() => new Colord("#000000")),
      specialBuildingColor: jest.fn(() => new Colord("#000000")),
      terrainColor: jest.fn(() => new Colord("#000000")),
      backgroundColor: jest.fn(() => new Colord("#000000")),
      falloutColor: jest.fn(() => new Colord("#000000")),
      font: jest.fn(() => ""),
      textColor: jest.fn(() => ""),
      selfColor: jest.fn(() => new Colord("#000000")),
      territoryColor: jest.fn(() => new Colord("#FFFFFF")),
      borderColor: jest.fn(() => new Colord("#CCCCCC")),
      focusedBorderColor: jest.fn(() => new Colord("#AAAAAA")),
      defendedBorderColors: jest.fn(() => ({
        light: new Colord("#BBBBBB"),
        dark: new Colord("#999999"),
      })),
      allyColor: jest.fn(() => new Colord("#00FF00")),
      enemyColor: jest.fn(() => new Colord("#FF0000")),
      spawnHighlightColor: jest.fn(() => new Colord("#FFFF00")),
      hotBorderColorRed: jest.fn(() => new Colord("#FF0000")),
      hotBorderColorBlack: jest.fn(() => new Colord("#000000")),
    };

    game = {
      config: jest.fn(() => ({
        theme: jest.fn(() => mockTheme),
      })) as any,
      owner: jest.fn(),
      isBorder: jest.fn(),
      recentlyUpdatedTiles: jest.fn(),
      neighbors: jest.fn((tileRef: TileRef) => {
        const x = tileRef % 10;
        const y = Math.floor(tileRef / 10);
        const neighbors: TileRef[] = [];
        // Assuming a 10x10 grid for simplicity
        if (x > 0) neighbors.push(tileRef - 1); // Left
        if (x < 9) neighbors.push(tileRef + 1); // Right
        if (y > 0) neighbors.push(tileRef - 10); // Up
        if (y < 9) neighbors.push(tileRef + 10); // Down
        return neighbors;
      }),
      ticks: jest.fn(() => 0),
      focusedPlayer: jest.fn(() => player1),
      updatesSinceLastTick: jest.fn(() => {
        const updates: any = [];
        for (let i = 0; i <= GameUpdateType.BomberExplosion; i++) {
          updates[i] = [];
        }
        return updates;
      }),
      x: jest.fn((tileRef: TileRef) => tileRef % 10), // Assuming a 10x10 grid
      y: jest.fn((tileRef: TileRef) => Math.floor(tileRef / 10)), // Assuming a 10x10 grid
      width: jest.fn(() => 10), // Assuming a 10x10 grid
      hasUnitNearby: jest.fn(),
      unitInfo: jest.fn(),
      myPlayer: jest.fn(() => player1), // Directly return player1
      // Public methods from GameView that TerritoryLayer might call
      isOnEdgeOfMap: jest.fn(),
      update: jest.fn(),
      alliances: jest.fn(() => []),
      nearbyUnits: jest.fn(() => []),
      myClientID: jest.fn(() => "mockClientID"),
      player: jest.fn((id: string) =>
        id === player1.id() ? player1 : player2,
      ), // Return player1 or player2 based on ID
      players: jest.fn(() => [player1, player2]),
      playerBySmallID: jest.fn((id: number) =>
        id.toString() === player1.id() ? player1 : player2,
      ), // Return player1 or player2 based on ID
      playerByClientID: jest.fn((id: string) =>
        id === "mockClientID" ? player1 : null,
      ), // Return player1 if clientID matches
      hasPlayer: jest.fn(() => true),
      playerViews: jest.fn(() => [player1, player2]),
      inSpawnPhase: jest.fn(() => false),
      units: jest.fn(() => []),
      unit: jest.fn(),
      ref: jest.fn(),
      cell: jest.fn(),
      height: jest.fn(() => 10),
      numLandTiles: jest.fn(() => 0),
      isValidCoord: jest.fn(() => true),
      isLand: jest.fn(() => false),
      isOceanShore: jest.fn(() => false),
      isOcean: jest.fn(() => false),
      isShoreline: jest.fn(() => false),
      magnitude: jest.fn(() => 0),
      ownerID: jest.fn(() => 0),
      hasOwner: jest.fn(() => false),
      setOwnerID: jest.fn(),
      hasFallout: jest.fn(() => false),
      setFallout: jest.fn(),
      isWater: jest.fn(() => false),
      isLake: jest.fn(() => false),
      isShore: jest.fn(() => false),
      cost: jest.fn(() => 0),
      terrainType: jest.fn(),
      forEachTile: jest.fn(),
      manhattanDist: jest.fn(() => 0),
      euclideanDistSquared: jest.fn(() => 0),
      bfs: jest.fn(() => new Set()),
      toTileUpdate: jest.fn(() => BigInt(0)),
      updateTile: jest.fn(() => 0),
      numTilesWithFallout: jest.fn(() => 0),
      gameID: jest.fn(() => "mockGameID"),
      setFocusedPlayer: jest.fn(),
    } as unknown as GameView;
    eventBus = { on: jest.fn() };
    transformHandler = {};
  });

  it("should initialize without errors", () => {
    const layer = new TerritoryLayer(game, eventBus, transformHandler);
    expect(layer).toBeDefined();
  });

  it("should add and remove hot border tiles based on changes", () => {
    const layer = new TerritoryLayer(game, eventBus, transformHandler);
    const tile1: TileRef = 0;
    const player1: PlayerView = {
      id: jest.fn(() => 1),
      borderTiles: jest.fn(() =>
        Promise.resolve({ borderTiles: new Set<TileRef>() }),
      ),
    } as any;

    // Mock initial state
    (game.focusedPlayer as jest.Mock).mockReturnValue(player1);
    (game.owner as jest.Mock).mockReturnValue(player1);
    (game.isBorder as jest.Mock).mockReturnValue(false);
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([]);
    (game.neighbors as jest.Mock).mockReturnValue([]);
    (game.ticks as jest.Mock).mockReturnValue(1);

    // Simulate tile becoming a border (expansion)
    (game.isBorder as jest.Mock).mockImplementation(
      (tile: TileRef) => tile === tile1,
    );
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([tile1]);
    layer.tick();

    // Check if tile1 is a hot border (black for expansion)
    // Accessing private property for testing purposes
    expect((layer as any).hotBorderTiles.has(tile1)).toBe(true);
    expect((layer as any).hotBorderTiles.get(tile1).color.toHex()).toBe(
      mockTheme.hotBorderColorBlack().toHex(),
    );

    // Simulate time passing and tile no longer being a border
    (game.ticks as jest.Mock).mockReturnValue(100); // Advance ticks for cleanup
    (game.isBorder as jest.Mock).mockReturnValue(false); // No longer a border
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([]); // No recent updates
    layer.tick();

    // Check if tile1 is removed from hot borders after cleanup and no longer a border
    expect((layer as any).hotBorderTiles.has(tile1)).toBe(false);
  });

  it("should apply red color for contracting borders", () => {
    const layer = new TerritoryLayer(game, eventBus, transformHandler);
    const tile1: TileRef = 0;
    const tile2: TileRef = 1; // Neighbor
    const player1: PlayerView = {
      id: jest.fn(() => 1),
      borderTiles: jest.fn(() =>
        Promise.resolve({ borderTiles: new Set<TileRef>() }),
      ),
    } as any;

    // Initial state: tile1 is a border, tile2 is its neighbor and recently updated
    (game.focusedPlayer as jest.Mock).mockReturnValue(player1);
    (game.owner as jest.Mock).mockReturnValue(player1);
    (game.isBorder as jest.Mock).mockImplementation(
      (tile: TileRef) => tile === tile1,
    );
    (game.neighbors as jest.Mock).mockImplementation((tile: TileRef) => {
      if (tile === tile1) return [tile2];
      if (tile === tile2) return [tile1];
      return [];
    });
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([tile2]); // Neighbor updated, implies contraction
    (game.ticks as jest.Mock).mockReturnValue(1);

    layer.tick();

    // Check if tile1 is a hot border (red for contraction)
    expect((layer as any).hotBorderTiles.has(tile1)).toBe(true);
    expect((layer as any).hotBorderTiles.get(tile1).color.toHex()).toBe(
      mockTheme.hotBorderColorRed().toHex(),
    );
  });

  it("should apply black color for expanding borders", () => {
    const layer = new TerritoryLayer(game, eventBus, transformHandler);
    const tile1: TileRef = 0;
    const player1: PlayerView = {
      id: jest.fn(() => 1),
      borderTiles: jest.fn(() =>
        Promise.resolve({ borderTiles: new Set<TileRef>() }),
      ),
    } as any;

    // Initial state: tile1 is a border and recently updated
    (game.focusedPlayer as jest.Mock).mockReturnValue(player1);
    (game.owner as jest.Mock).mockReturnValue(player1);
    (game.isBorder as jest.Mock).mockImplementation(
      (tile: TileRef) => tile === tile1,
    );
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([tile1]); // Tile itself updated, implies expansion
    (game.neighbors as jest.Mock).mockReturnValue([]);
    (game.ticks as jest.Mock).mockReturnValue(1);

    layer.tick();

    // Check if tile1 is a hot border (black for expansion)
    expect((layer as any).hotBorderTiles.has(tile1)).toBe(true);
    expect((layer as any).hotBorderTiles.get(tile1).color.toHex()).toBe(
      mockTheme.hotBorderColorBlack().toHex(),
    );
  });

  it("should clear hot borders when focused player changes", () => {
    const layer = new TerritoryLayer(game, eventBus, transformHandler);
    const tile1: TileRef = 0;
    const player1: PlayerView = {
      id: jest.fn(() => 1),
      borderTiles: jest.fn(() =>
        Promise.resolve({ borderTiles: new Set<TileRef>() }),
      ),
    } as any;
    const player2: PlayerView = { id: jest.fn(() => 2) } as any;

    // Simulate tile becoming a hot border for player1
    (game.focusedPlayer as jest.Mock).mockReturnValue(player1);
    (game.owner as jest.Mock).mockReturnValue(player1);
    (game.isBorder as jest.Mock).mockImplementation(
      (tile: TileRef) => tile === tile1,
    );
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([tile1]);
    (game.ticks as jest.Mock).mockReturnValue(1);
    layer.tick();
    expect((layer as any).hotBorderTiles.has(tile1)).toBe(true);

    // Change focused player
    (game.focusedPlayer as jest.Mock).mockReturnValue(player2);
    (game.ticks as jest.Mock).mockReturnValue(2);
    layer.tick();

    // Hot borders should be cleared
    expect((layer as any).hotBorderTiles.size).toBe(0);
  });

  it("should clear hot borders when focused player becomes null", () => {
    const layer = new TerritoryLayer(game, eventBus, transformHandler);
    const tile1: TileRef = 0;
    const player1: PlayerView = {
      id: jest.fn(() => 1),
      borderTiles: jest.fn(() =>
        Promise.resolve({ borderTiles: new Set<TileRef>() }),
      ),
    } as any;

    // Simulate tile becoming a hot border for player1
    (game.focusedPlayer as jest.Mock).mockReturnValue(player1);
    (game.owner as jest.Mock).mockReturnValue(player1);
    (game.isBorder as jest.Mock).mockImplementation(
      (tile: TileRef) => tile === tile1,
    );
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([tile1]);
    (game.ticks as jest.Mock).mockReturnValue(1);
    layer.tick();
    expect((layer as any).hotBorderTiles.has(tile1)).toBe(true);

    // Set focused player to null
    (game.focusedPlayer as jest.Mock).mockReturnValue(null);
    (game.ticks as jest.Mock).mockReturnValue(2);
    layer.tick();

    // Hot borders should be cleared
    expect((layer as any).hotBorderTiles.size).toBe(0);
  });

  it("should update previousBorderStatus correctly", () => {
    const layer = new TerritoryLayer(game, eventBus, transformHandler);
    const tile1: TileRef = 0;
    const player1: PlayerView = {
      id: jest.fn(() => 1),
      borderTiles: jest.fn(() =>
        Promise.resolve({ borderTiles: new Set<TileRef>() }),
      ),
    } as any;

    // Initial state: tile1 is not a border
    (game.focusedPlayer as jest.Mock).mockReturnValue(player1);
    (game.owner as jest.Mock).mockReturnValue(player1);
    (game.isBorder as jest.Mock).mockReturnValue(false);
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([]);
    (game.ticks as jest.Mock).mockReturnValue(1);
    layer.tick();
    expect((layer as any).previousBorderStatus.get(tile1)).toBeUndefined();

    // Simulate tile1 becoming a border
    (game.isBorder as jest.Mock).mockImplementation(
      (tile: TileRef) => tile === tile1,
    );
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([tile1]);
    (game.ticks as jest.Mock).mockReturnValue(2);
    layer.tick();
    expect((layer as any).previousBorderStatus.get(tile1)).toBe(true);

    // Simulate tile1 no longer being a border
    (game.isBorder as jest.Mock).mockReturnValue(false);
    (game.recentlyUpdatedTiles as jest.Mock).mockReturnValue([]);
    (game.ticks as jest.Mock).mockReturnValue(3);
    layer.tick();
    expect((layer as any).previousBorderStatus.get(tile1)).toBe(false);
  });
});
