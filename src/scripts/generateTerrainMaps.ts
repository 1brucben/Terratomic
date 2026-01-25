import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { generateMap } from "./TerrainMapGenerator.js";

const removeSmall = true;

interface MapConfig {
  fileName: string;
  displayName: string;
  category: string;
  frequency: number;
  playerCounts: number[];
  generatorScript?: string;
  notes?: string;
}

async function loadTerrainMaps() {
  const configPath = path.resolve(
    process.cwd(),
    "resources",
    "maps",
    "maps.json",
  );
  const configContent = await fs.readFile(configPath, "utf-8");
  const maps: MapConfig[] = JSON.parse(configContent);

  console.log(`Loaded ${maps.length} map definitions from maps.json`);

  await Promise.all(
    maps.map(async (mapConfig) => {
      const mapName = mapConfig.fileName;
      // Look for the map image in the SUBFOLDER: resources/maps/[mapName]/[mapName].png
      const mapDir = path.join(process.cwd(), "resources", "maps", mapName);
      const mapPath = path.join(mapDir, mapName + ".png");

      // Check if PNG exists
      if (!existsSync(mapPath)) {
        console.warn(`Skipping ${mapName}: Source PNG not found at ${mapPath}`);
        return;
      }

      console.log(`Generating map: ${mapName} (${mapConfig.displayName})...`);

      try {
        const imageBuffer = await fs.readFile(mapPath);
        const {
          map: mainMap,
          miniMap,
          thumb,
        } = await generateMap(imageBuffer, removeSmall, mapName);

        const outputPath = path.join(mapDir, mapName + ".bin");
        const miniOutputPath = path.join(mapDir, mapName + "Mini.bin");
        const thumbOutputPath = path.join(mapDir, mapName + "Thumb.webp");

        await Promise.all([
          fs.writeFile(outputPath, mainMap),
          fs.writeFile(miniOutputPath, miniMap),
          thumb.webp({ quality: 45 }).toFile(thumbOutputPath),
        ]);
        console.log(`Finished ${mapName}`);
      } catch (err) {
        console.error(`Error generating ${mapName}:`, err);
      }
    }),
  );
}

async function main() {
  try {
    await loadTerrainMaps();
    console.log("Terrain maps generated successfully");
  } catch (error) {
    console.error("Error generating terrain maps:", error);
    process.exit(1);
  }
}

main();
