import { GameMapName, GameMapType } from "./Game";
import { NationMap } from "./TerrainMapLoader";

interface MapData {
  mapBin: string;
  miniMapBin: string;
  nationMap: NationMap;
}

interface MapCache {
  bin?: string;
  miniMapBin?: string;
  nationMap?: NationMap;
}

interface BinModule {
  default: string;
}

interface NationMapModule {
  default: NationMap;
}

import mapData from "../../../resources/maps/maps.json" with { type: "json" };

// Mapping from GameMap enum values to file names
const MAP_FILE_NAMES: Record<GameMapType, string> = {} as any;
mapData.forEach((map) => {
  if (map.fileName in GameMapType) {
    const mapType = GameMapType[map.fileName as GameMapName];
    MAP_FILE_NAMES[mapType] = map.fileName;
  }
});

class GameMapLoader {
  private maps: Map<GameMapType, MapCache>;
  private loadingPromises: Map<GameMapType, Promise<MapData>>;

  constructor() {
    this.maps = new Map<GameMapType, MapCache>();
    this.loadingPromises = new Map<GameMapType, Promise<MapData>>();
  }

  public async getMapData(map: GameMapType): Promise<MapData> {
    const cachedMap = this.maps.get(map);
    if (cachedMap?.bin && cachedMap?.nationMap) {
      return cachedMap as MapData;
    }

    if (!this.loadingPromises.has(map)) {
      this.loadingPromises.set(map, this.loadMapData(map));
    }

    const data = await this.loadingPromises.get(map)!;
    this.maps.set(map, data);
    return data;
  }

  private async loadMapData(map: GameMapType): Promise<MapData> {
    const fileName = MAP_FILE_NAMES[map];
    if (!fileName) {
      throw new Error(`No file name mapping found for map: ${map}`);
    }

    const [binModule, miniBinModule, infoModule] = await Promise.all([
      import(
        `!!binary-loader!../../../resources/maps/${fileName}/${fileName}.bin`
      ) as Promise<BinModule>,
      import(
        `!!binary-loader!../../../resources/maps/${fileName}/${fileName}Mini.bin`
      ) as Promise<BinModule>,
      import(`../../../resources/maps/${fileName}/${fileName}.json`, {
        with: { type: "json" },
      }) as Promise<NationMapModule>,
    ]);

    return {
      mapBin: binModule.default,
      miniMapBin: miniBinModule.default,
      nationMap: infoModule.default,
    };
  }

  public isMapLoaded(map: GameMapType): boolean {
    const mapData = this.maps.get(map);
    return !!mapData?.bin && !!mapData?.nationMap;
  }

  public getLoadedMaps(): GameMapType[] {
    return Array.from(this.maps.keys()).filter((map) => this.isMapLoaded(map));
  }
}

export const terrainMapFileLoader = new GameMapLoader();
