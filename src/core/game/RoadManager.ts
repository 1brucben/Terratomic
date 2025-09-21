import { Game, Player, PlayerID, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { PriorityQueue } from "./PriorityQueue";
import { RoadCache } from "./RoadCache";
import { SpatialGrid } from "./SpatialGrid";
import { StructureGraph } from "./StructureGraph";

/**
 * Represents a road connection between two points
 * @interface Road
 * @property {number} id - Unique identifier for the road
 * @property {TileRef[]} path - Array of tiles forming the road path
 */
export interface Road {
  id: number;
  path: TileRef[];
  owner: PlayerID;
}

let nextRoadId = 0;

/**
 * RoadManager handles the high-level road management in the game.
 * It coordinates between different systems to:
 * 1. Track road construction between cities and other buildings
 * 2. Manage road networks for multiple players
 * 3. Handle batched road updates efficiently
 * 4. Provide pathfinding for both road construction and unit movement
 */
export class RoadManager {
  private roads = new Map<number, Road>();
  private roadsByOwner = new Map<PlayerID, Set<number>>();
  private structureGraph = new StructureGraph();
  private nodes: Unit[] = [];
  private newNodesQueue: Unit[] = [];
  private spatialGrid: SpatialGrid;
  private pathfindingQueue: {
    from: TileRef;
    to: TileRef;
    radius?: number;
    isPriority?: boolean;
  }[] = [];
  private existingRoadSegments: Set<string> = new Set();
  // Maintain an incrementally updated set of tile-to-tile road segments
  private segmentSet = new Set<string>();
  private pendingAddedSegments: string[] = [];
  private pendingRemovedSegments: string[] = [];
  private nodeOwnerIds = new Map<number, PlayerID>();
  private nodesByOwner = new Map<PlayerID, Unit[]>();
  private roadCache: RoadCache;

  // Performance optimization caches
  private roadTilesCache = new Set<TileRef>();
  private pathCache = new Map<string, TileRef[]>();
  private tileToNode = new Map<TileRef, Unit>();
  private findingCargoPath = false;

  // Periodic consistency reconciliation for incremental segment tracking
  private lastSegmentReconcileTick = 0;
  private readonly RECONCILE_INTERVAL_TICKS = 600; // ~60s at 100ms per tick

  private readonly eligible: UnitType[] = [
    UnitType.City,
    UnitType.Port,
    UnitType.Hospital,
    UnitType.Academy,
    UnitType.Airfield,
  ];

  private hasNodesChanged(currentNodes: Unit[]): boolean {
    if (currentNodes.length !== this.nodes.length) return true;
    const currentNodeIds = new Set(currentNodes.map((n) => n.id()));
    return this.nodes.some((n) => !currentNodeIds.has(n.id()));
  }

  private updateRoadTilesCache(added: Road[], removed: Road[]) {
    removed.forEach((road) =>
      road.path.forEach((tile) => this.roadTilesCache.delete(tile)),
    );
    added.forEach((road) =>
      road.path.forEach((tile) => this.roadTilesCache.add(tile)),
    );
  }

  private updateTileToNodeIndex(currentNodes: Unit[]) {
    this.tileToNode.clear();
    for (const node of currentNodes) {
      this.tileToNode.set(node.tile(), node);
    }
  }

  private findNodeByTile(tile: TileRef): Unit | undefined {
    return this.tileToNode.get(tile);
  }

  private getCachedPath(start: TileRef, end: TileRef): TileRef[] | null {
    const key = this.getCanonicalSegment(start, end);
    if (this.pathCache.has(key)) {
      return this.pathCache.get(key)!;
    }
    const path = this.computePath(start, end);
    if (path) {
      this.pathCache.set(key, path);
    }
    return path;
  }

  private clearPathCache() {
    this.pathCache.clear();
  }

  /**
   * Creates a new RoadManager instance
   * @param game - Reference to the main game instance
   *
   * The constructor sets up:
   * 1. Spatial grid for efficient node lookups
   * 2. Road cache for rendering optimization
   * 3. Batched road network for pathfinding and connectivity
   * 4. Initial road tiles cache state
   */
  constructor(private game: Game) {
    // Increase grid chunk size to reduce number of chunks in dense areas
    const adaptiveChunkSize = Math.max(
      100,
      Math.floor(Math.sqrt(game.map().width() * game.map().height()) / 20),
    );
    this.spatialGrid = new SpatialGrid(game.map(), adaptiveChunkSize);

    // Initialize road rendering cache with proper map coordinates
    this.roadCache = new RoadCache(32, game.map().width());

    // Initialize road tiles cache for quick lookups
    this.initializeRoadTilesCache();
  }

  private initializeRoadTilesCache(): void {
    this.roadTilesCache.clear();
    for (const road of this.roads.values()) {
      for (const tile of road.path) {
        this.roadTilesCache.add(tile);
      }
    }
  }

  public hasRoadOnTile(tile: TileRef): boolean {
    return this.roadTilesCache.has(tile);
  }

  public updateLocalArea(center: TileRef, radius: number): void {
    // Queue local updates for roads within radius of the changed tile
    const nearbyNodes = this.spatialGrid.getNearby(
      { tile: () => center } as Unit,
      radius,
    );

    for (const node of nearbyNodes) {
      for (const otherNode of nearbyNodes) {
        if (node.id() !== otherNode.id()) {
          const segment = this.getCanonicalSegment(
            node.tile(),
            otherNode.tile(),
          );
          if (!this.existingRoadSegments.has(segment)) {
            this.pathfindingQueue.push({
              from: node.tile(),
              to: otherNode.tile(),
              radius: radius,
            });
          }
        }
      }
    }
  }

  public update(playersWithRoads: Player[]): {
    added: string[];
    removed: string[];
  } {
    if (playersWithRoads.length === 0) {
      if (this.pathfindingQueue.length > 0) {
        this.pathfindingQueue = [];
      }
      const added = this.pendingAddedSegments;
      const removed = this.pendingRemovedSegments;
      this.pendingAddedSegments = [];
      this.pendingRemovedSegments = [];
      return { added, removed };
    }

    const currentNodes = playersWithRoads.flatMap((p) => {
      const finished = p.units(...this.eligible).filter((u) => u.isActive());
      return [...finished];
    });

    // Synchronize nodes with the StructureGraph
    const currentNodeIds = new Set(currentNodes.map((n) => n.id()));
    const oldNodeIds = new Set(this.nodes.map((n) => n.id()));

    for (const node of currentNodes) {
      if (!oldNodeIds.has(node.id())) {
        this.structureGraph.addNode(node);
      }
    }

    for (const node of this.nodes) {
      if (!currentNodeIds.has(node.id())) {
        this.structureGraph.removeNode(node);
      }
    }

    // Only rebuild caches if nodes have changed significantly
    if (this.hasNodesChanged(currentNodes)) {
      this.spatialGrid = new SpatialGrid(this.game.map(), 100);
      for (const node of currentNodes) {
        this.spatialGrid.add(node);
      }
      this.updateTileToNodeIndex(currentNodes);
      this.clearPathCache();
    }

    const newNodeOwnerIds = new Map<number, PlayerID>();
    currentNodes.forEach((n) => newNodeOwnerIds.set(n.id(), n.owner().id()));

    const newNodes = currentNodes.filter((n) => !this.nodeOwnerIds.has(n.id()));
    const ownerChangedNodes = currentNodes.filter((n) => {
      const oldOwnerId = this.nodeOwnerIds.get(n.id());
      return oldOwnerId && oldOwnerId !== n.owner().id();
    });

    this.newNodesQueue.push(...newNodes, ...ownerChangedNodes);

    const removedNodeIds = [...this.nodeOwnerIds.keys()].filter(
      (id) => !newNodeOwnerIds.has(id),
    );
    const removedNodes = this.nodes.filter((n) =>
      removedNodeIds.includes(n.id()),
    );

    this.nodeOwnerIds = newNodeOwnerIds;

    // Process removed nodes with localized updates
    const ROAD_UPDATE_RADIUS = 10; // Tiles to recalculate around changes
    removedNodes.forEach((node) => {
      const removedNodeTile = node.tile();

      // Get roads that need to be removed
      const affectedRoads = new Set<number>();
      for (const road of this.roads.values()) {
        const startTile = road.path[0];
        const endTile = road.path[road.path.length - 1];
        if (startTile === removedNodeTile || endTile === removedNodeTile) {
          affectedRoads.add(road.id);
        }
      }

      // Remove affected roads
      affectedRoads.forEach((roadId) => {
        const road = this.roads.get(roadId);
        if (road) {
          // Remove from roadsByOwner map
          const ownerRoads = this.roadsByOwner.get(road.owner);
          if (ownerRoads) {
            ownerRoads.delete(roadId);
          }

          const startTile = road.path[0];
          const endTile = road.path[road.path.length - 1];
          // Track per-edge segment removals for UI redraw
          for (let i = 0; i < road.path.length - 1; i++) {
            const seg = this.getCanonicalSegment(
              road.path[i],
              road.path[i + 1],
            );
            if (this.segmentSet.delete(seg))
              this.pendingRemovedSegments.push(seg);
          }
          this.roads.delete(roadId);
          this.existingRoadSegments.delete(
            this.getCanonicalSegment(startTile, endTile),
          );
        }
      });

      // Queue local updates for nearby nodes
      this.updateLocalArea(removedNodeTile, ROAD_UPDATE_RADIUS);
    });

    const maxRoadDistSquared = 100 * 100;
    const updatesPerTick = this.game.config().roadUpdatesPerTick();

    for (let i = 0; i < updatesPerTick && this.newNodesQueue.length > 0; i++) {
      const newNode = this.newNodesQueue.shift()!;
      const ownerOfNewNode = this.game.owner(newNode.tile());
      if (!ownerOfNewNode.isPlayer()) continue;

      const preFilterNearbyNodes = this.spatialGrid.getNearby(
        newNode,
        Math.sqrt(maxRoadDistSquared),
      );

      const nearbyNodes = preFilterNearbyNodes
        .filter((node) => {
          if (node.id() === newNode.id()) return false;
          const nodeOwner = this.game.owner(node.tile());
          if (!nodeOwner.isPlayer()) return false;

          const owner1ID = ownerOfNewNode.id();
          const owner2ID = nodeOwner.id();
          const areSameOwner = owner1ID === owner2ID;

          return areSameOwner || ownerOfNewNode.isFriendly(nodeOwner as Player);
        })
        .sort(
          (a, b) =>
            this.game.euclideanDistSquared(newNode.tile(), a.tile()) -
            this.game.euclideanDistSquared(newNode.tile(), b.tile()),
        )
        .slice(0, 5); // Consider up to 5 closest neighbors

      for (const neighbor of nearbyNodes) {
        const existingPath = this.structureGraph.findPath(newNode, neighbor);
        const roadNetworkMaxRedundantPathLength = 5; // Making it configurable is a good idea for the future

        if (
          existingPath === null ||
          existingPath.length > roadNetworkMaxRedundantPathLength
        ) {
          const segment = this.getCanonicalSegment(
            newNode.tile(),
            neighbor.tile(),
          );
          if (!this.existingRoadSegments.has(segment)) {
            const path = this.getCachedPath(newNode.tile(), neighbor.tile());
            if (path) {
              const newRoad: Road = {
                id: nextRoadId++,
                path,
                owner: ownerOfNewNode.id(),
              };
              this.roads.set(newRoad.id, newRoad);

              // Add to the new roadsByOwner map
              if (!this.roadsByOwner.has(newRoad.owner)) {
                this.roadsByOwner.set(newRoad.owner, new Set());
              }
              this.roadsByOwner.get(newRoad.owner)!.add(newRoad.id);
              this.existingRoadSegments.add(segment);
              this.updateRoadTilesCache([newRoad], []);

              const startNode = this.findNodeByTile(path[0]);
              const endNode = this.findNodeByTile(path[path.length - 1]);
              if (startNode && endNode) {
                this.structureGraph.addEdge(startNode, endNode, path);
              }

              // Update road network for renderer
              for (let i = 0; i < path.length - 1; i++) {
                const a = path[i];
                const b = path[i + 1];
                const seg = this.getCanonicalSegment(a, b);
                if (!this.segmentSet.has(seg)) {
                  this.segmentSet.add(seg);
                  this.pendingAddedSegments.push(seg);
                }
              }
            }
          }
        }
      }
    }

    this.nodes = currentNodes;

    // Rebuild quick index by owner once per update call
    this.nodesByOwner.clear();
    for (const node of this.nodes) {
      const pid = node.owner().id();
      const arr = this.nodesByOwner.get(pid);
      if (arr) arr.push(node);
      else this.nodesByOwner.set(pid, [node]);
    }

    // Process pathfinding queue in chunks for better performance
    const startTime = performance.now();
    const MAX_PROCESSING_TIME = 16; // Max 16ms per frame to prevent stuttering
    const isBulkOperation = this.pathfindingQueue.length > 100;

    // Sort queue to process priority connections first in bulk operations
    if (isBulkOperation) {
      this.pathfindingQueue.sort((a, b) => {
        if (a.isPriority === b.isPriority) return 0;
        return a.isPriority ? -1 : 1;
      });
    }

    let processedThisTick = 0;
    const MAX_PER_TICK = isBulkOperation ? 50 : 20; // Process fewer connections per tick in bulk mode

    while (
      this.pathfindingQueue.length > 0 &&
      processedThisTick < MAX_PER_TICK
    ) {
      const { from, to, radius, isPriority } = this.pathfindingQueue[0];

      // Skip if outside local update radius, but only for road updates
      // Don't skip for cargo path finding or priority connections
      if (radius !== undefined && !this.findingCargoPath && !isPriority) {
        const dist = Math.sqrt(this.game.euclideanDistSquared(from, to));
        if (dist > radius) {
          this.pathfindingQueue.shift();
          continue;
        }
      }

      const canonicalSegment = this.getCanonicalSegment(from, to);

      // Check processing time limit
      if (performance.now() - startTime > MAX_PROCESSING_TIME) {
        break; // Continue next frame if we're taking too long
      }

      processedThisTick++;
      this.pathfindingQueue.shift(); // Only remove if we're actually processing it

      if (!this.existingRoadSegments.has(canonicalSegment)) {
        const path = this.getCachedPath(from, to);
        if (path) {
          const owner = this.game.owner(from);
          if (owner.isPlayer()) {
            const newRoad: Road = { id: nextRoadId++, path, owner: owner.id() };
            this.roads.set(newRoad.id, newRoad);

            // Add to the new roadsByOwner map
            if (!this.roadsByOwner.has(newRoad.owner)) {
              this.roadsByOwner.set(newRoad.owner, new Set());
            }
            this.roadsByOwner.get(newRoad.owner)!.add(newRoad.id);
            this.existingRoadSegments.add(canonicalSegment);
            this.updateRoadTilesCache([newRoad], []);

            const startNode = this.findNodeByTile(path[0]);
            const endNode = this.findNodeByTile(path[path.length - 1]);
            if (startNode && endNode) {
              this.structureGraph.addEdge(startNode, endNode, path);
            }

            // Update road network for renderer
            for (let i = 0; i < path.length - 1; i++) {
              const a = path[i];
              const b = path[i + 1];
              const seg = this.getCanonicalSegment(a, b);
              if (!this.segmentSet.has(seg)) {
                this.segmentSet.add(seg);
                this.pendingAddedSegments.push(seg);
              }
            }
          }
        }
      }
    }

    // Periodically reconcile the incremental segment set with authoritative roads
    this.maybeReconcileSegments();

    // Produce incremental updates for the renderer
    const added = this.pendingAddedSegments;
    const removed = this.pendingRemovedSegments;
    this.pendingAddedSegments = [];
    this.pendingRemovedSegments = [];

    return { added, removed };
  }

  private maybeReconcileSegments(force: boolean = false): void {
    const nowTick = this.game.ticks();
    if (
      !force && // Check force parameter
      nowTick - this.lastSegmentReconcileTick < this.RECONCILE_INTERVAL_TICKS
    ) {
      return;
    }
    this.lastSegmentReconcileTick = nowTick;

    // Build current authoritative set from roads
    const current = new Set<string>();
    for (const road of this.roads.values()) {
      for (let i = 0; i < road.path.length - 1; i++) {
        current.add(this.getCanonicalSegment(road.path[i], road.path[i + 1]));
      }
    }

    // Compute differences
    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const seg of current) {
      if (!this.segmentSet.has(seg)) toAdd.push(seg);
    }
    for (const seg of this.segmentSet) {
      if (!current.has(seg)) toRemove.push(seg);
    }

    if (toAdd.length === 0 && toRemove.length === 0) return;

    // Apply reconciliation to internal state and queue for renderer
    for (const seg of toAdd) this.segmentSet.add(seg);
    for (const seg of toRemove) this.segmentSet.delete(seg);
    this.pendingAddedSegments.push(...toAdd);
    this.pendingRemovedSegments.push(...toRemove);
  }

  private getCanonicalSegment(tile1: TileRef, tile2: TileRef): string {
    return tile1 < tile2 ? `${tile1}-${tile2}` : `${tile2}-${tile1}`;
  }

  private computePath(start: TileRef, goal: TileRef): TileRef[] | null {
    return this.shortestPathOverFriendlyLand(start, goal);
  }

  private shortestPathOverFriendlyLand(
    start: TileRef,
    goal: TileRef,
  ): TileRef[] | null {
    if (start === goal) return [start];

    const startOwner = this.game.owner(start);
    if (!startOwner.isPlayer()) return null;

    const maxRoadLength = this.game.config().maxRoadLength();

    // Check maximum road distance (as the crow flies)
    if (
      this.game.euclideanDistSquared(start, goal) >
      maxRoadLength * maxRoadLength
    ) {
      return null;
    }

    const ok = (r: TileRef) => {
      if (!this.game.isLand(r)) return false;
      const owner = this.game.owner(r);
      if (!owner.isPlayer()) return false;
      if (owner.id() === startOwner.id()) return true;
      return startOwner.isFriendly(owner as Player);
    };

    if (!ok(start) || !ok(goal)) return null;

    // Fallback to regular A* search if no road path found
    const costs = new Map<TileRef, number>();
    const prev = new Map<TileRef, TileRef | null>();
    const pq = new PriorityQueue<TileRef>();

    costs.set(start, 0);
    pq.enqueue(0, start);

    while (pq.size > 0) {
      const current = pq.dequeue();
      if (!current) break;

      if (current === goal) break;

      const currentCost = costs.get(current) ?? Infinity;

      for (const neighbor of this.game.neighbors(current)) {
        if (!ok(neighbor)) continue;

        const cost = this.roadTilesCache.has(neighbor) ? 1 : 2;
        const newCost = currentCost + cost;

        // Stop exploring paths that are already too long
        if (newCost > maxRoadLength) {
          continue;
        }

        if (newCost < (costs.get(neighbor) ?? Infinity)) {
          costs.set(neighbor, newCost);
          prev.set(neighbor, current);
          pq.enqueue(newCost, neighbor);
        }
      }
    }

    if (!costs.has(goal)) return null;

    const path: TileRef[] = [];
    for (
      let at: TileRef | null = goal;
      at !== null;
      at = prev.get(at) ?? null
    ) {
      path.push(at);
    }
    path.reverse();

    return path.length > 0 ? path : null;
  }

  public findCompleteStructurePath(
    startUnit: Unit,
    endUnit: Unit,
  ): TileRef[] | null {
    const structurePath = this.structureGraph.findPath(startUnit, endUnit);
    if (!structurePath || structurePath.length < 2) {
      return null;
    }

    const completePath: TileRef[] = [];
    for (let i = 0; i < structurePath.length - 1; i++) {
      const from = structurePath[i];
      const to = structurePath[i + 1];
      const edge = this.structureGraph.getEdge(from, to);

      if (edge) {
        const segmentPath = [...edge.path];
        if (segmentPath[0] !== from.tile()) {
          segmentPath.reverse();
        }
        // On the first segment, add the whole path.
        // On subsequent segments, slice(1) to avoid duplicating the connection node.
        completePath.push(...(i === 0 ? segmentPath : segmentPath.slice(1)));
      }
    }
    return completePath;
  }

  public getConnectedNodes(player: Player): Unit[] {
    return this.nodesByOwner.get(player.id()) ?? [];
  }

  public destroyPlayerRoads(player: Player): void {
    const roadIdsToDestroy = this.roadsByOwner.get(player.id());
    if (!roadIdsToDestroy) {
      return;
    }

    for (const roadId of roadIdsToDestroy) {
      const road = this.roads.get(roadId);
      if (road) {
        for (const tile of road.path) {
          this.roadTilesCache.delete(tile);
        }

        const startNode = this.findNodeByTile(road.path[0]);
        const endNode = this.findNodeByTile(road.path[road.path.length - 1]);

        // Clean up all state related to this road
        if (startNode && endNode) {
          this.structureGraph.removeEdge(startNode, endNode);
          const segment = this.getCanonicalSegment(
            startNode.tile(),
            endNode.tile(),
          );
          this.existingRoadSegments.delete(segment);
        }

        this.roads.delete(roadId);

        // Explicitly remove segments from segmentSet for renderer
        for (let i = 0; i < road.path.length - 1; i++) {
          const seg = this.getCanonicalSegment(road.path[i], road.path[i + 1]);
          if (this.segmentSet.delete(seg)) {
            this.pendingRemovedSegments.push(seg); // Ensure these are also queued for renderer
          }
        }
      }
    }

    this.roadsByOwner.delete(player.id());

    // Clear path cache as roads have been destroyed
    this.clearPathCache();

    this.maybeReconcileSegments(true);
  }

  public markPlayerNodesForReconnection(player: Player): void {
    const playerNodes = player
      .units(...this.eligible)
      .filter((u) => u.isActive());
    for (const node of playerNodes) {
      // Only remove from nodeOwnerIds to make them appear as newNodes in the next update
      this.nodeOwnerIds.delete(node.id());
    }
  }

  // Expose current roads for external consumers (e.g., GameImpl/tests)
  public getRoads(): Road[] {
    return Array.from(this.roads.values());
  }
}
