import { Unit } from "./Game";
import { TileRef } from "./GameMap";

type UnitId = number;

export interface RoadEdge {
  path: TileRef[];
  length: number;
}

export interface StructureNode {
  unit: Unit;
  connections: Map<UnitId, RoadEdge>;
}

export class StructureGraph {
  private nodes = new Map<UnitId, StructureNode>();

  public addNode(unit: Unit): void {
    if (!this.nodes.has(unit.id())) {
      this.nodes.set(unit.id(), {
        unit: unit,
        connections: new Map<UnitId, RoadEdge>(),
      });
    }
  }

  public removeNode(unit: Unit): void {
    const unitId = unit.id();
    if (this.nodes.has(unitId)) {
      this.nodes.delete(unitId);
      // Also remove connections to this node from other nodes
      for (const node of this.nodes.values()) {
        if (node.connections.has(unitId)) {
          node.connections.delete(unitId);
        }
      }
    }
  }

  public addEdge(unit1: Unit, unit2: Unit, path: TileRef[]): void {
    const node1 = this.nodes.get(unit1.id());
    const node2 = this.nodes.get(unit2.id());

    if (node1 && node2) {
      const edge: RoadEdge = { path, length: path.length };
      node1.connections.set(unit2.id(), edge);
      node2.connections.set(unit1.id(), edge);
    }
  }

  public removeEdge(unit1: Unit, unit2: Unit): void {
    const node1 = this.nodes.get(unit1.id());
    const node2 = this.nodes.get(unit2.id());

    if (node1 && node2) {
      node1.connections.delete(unit2.id());
      node2.connections.delete(unit1.id());
    }
  }

  public findPath(startUnit: Unit, endUnit: Unit): Unit[] | null {
    const startNode = this.nodes.get(startUnit.id());
    const endNode = this.nodes.get(endUnit.id());

    if (!startNode || !endNode) {
      return null;
    }

    const queue: UnitId[] = [startUnit.id()];
    const visited = new Set<UnitId>([startUnit.id()]);
    const cameFrom = new Map<UnitId, UnitId>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = this.nodes.get(currentId);

      if (currentId === endUnit.id()) {
        // Reconstruct path
        const path: Unit[] = [];
        let at = endUnit.id();
        while (at !== startUnit.id()) {
          path.unshift(this.nodes.get(at)!.unit);
          at = cameFrom.get(at)!;
        }
        path.unshift(startUnit);
        return path;
      }

      if (currentNode) {
        for (const neighborId of currentNode.connections.keys()) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            cameFrom.set(neighborId, currentId);
            queue.push(neighborId);
          }
        }
      }
    }

    return null; // No path found
  }

  public getEdge(from: Unit, to: Unit): RoadEdge | undefined {
    const fromNode = this.nodes.get(from.id());
    if (fromNode) {
      return fromNode.connections.get(to.id());
    }
    return undefined;
  }
}
