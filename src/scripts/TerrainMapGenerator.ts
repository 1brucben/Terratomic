import sharp from "sharp";

const min_island_size = 30;
const min_lake_size = 200;

enum TerrainType {
  Land = 0,
  Water = 1,
  Barrier = 2,
}

// TypedArray structure constants
// We will use parallel arrays for the properties
// types: Uint8Array (enums 0-2 fit in 8 bits)
// magnitudes: Float32Array or Uint8Array? Magnitude seems to be float in old code (mag/2).
// Original: magnitude = mag/2 where mag is 0-60. Max 30.0.
// processDistToLand uses it for distance, which can be large integers.
// Let's use Int16Array for magnitude to be safe and efficient.
// Wait, packed byte uses Math.ceil(mag), capped at 31.
// But intermediate BFS distances can be large (width/height).
// Int16Array (32k) is enough for 4000x4000 maps.
// shoreline: Uint8Array (0/1)
// ocean: Uint8Array (0/1)

interface TerrainMap {
  width: number;
  height: number;
  types: Uint8Array;
  magnitudes: Int16Array;
  shorelines: Uint8Array;
  oceans: Uint8Array;
  cosmetics: Uint8Array;
}

function createTerrainMap(width: number, height: number): TerrainMap {
  const size = width * height;
  return {
    width,
    height,
    types: new Uint8Array(size),
    magnitudes: new Int16Array(size),
    shorelines: new Uint8Array(size),
    oceans: new Uint8Array(size),
    cosmetics: new Uint8Array(size),
  };
}

export async function generateMap(
  imageBuffer: Buffer,
  removeSmall = true,
  name: string = "",
): Promise<{ map: Uint8Array; miniMap: Uint8Array; thumb: sharp.Sharp }> {
  const image = sharp(imageBuffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;

  console.debug(`Processing Map: ${name}, dimensions: ${width}x${height}`);

  const tm = createTerrainMap(width, height);

  // Iterate pixels
  for (let idx = 0; idx < data.length; idx += 4) {
    const i = idx / 4;
    // idx is standard RGBA buffer order: row by row
    // i corresponds to y * width + x

    // Original loop:
    // for let x=0; x<width; x++
    //   for let y=0; y<height; y++
    //     ...
    // The pureimage getPixelRGBA(x, y) accessed buffer.
    // Sharp raw buffer is row-major: line 0 (y=0), then line 1 (y=1).
    // So i = y * width + x.

    // However, our internal representation (and original logic) created Arrays as:
    // const terrain = Array(width).fill... .map(() => Array(height))
    // Access was terrain[x][y].
    // This is "column-major" in memory layout conceptually if we map it to 2D array.
    // But for 1D arrays, we can choose.
    // Let's stick to standard (y * width + x) row-major index for TypedArrays to match image buffer iteration nicely.
    // Index = y * width + x
    // x = i % width
    // y = Math.floor(i / width)

    // Careful: neighbors() functions need to respect this layout.

    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    // Water Colors (Blue Channel)
    // 106: Standard (#00006A)
    // 160: L1 (#0000A0) -> Cosmetic 1
    // 122: L2 (#00007A) -> Cosmetic 2
    // 102: L3 (#000066) -> Cosmetic 3
    // 81:  L4 (#000051) -> Cosmetic 4
    // 63:  L5 (#00003F) -> Cosmetic 5
    // 51:  L6 (#000033) -> Cosmetic 6
    // 41:  L7 (#000029) -> Cosmetic 7
    // 29:  L8 (#00001D) -> Cosmetic 8
    // 17:  L9 (#000011) -> Cosmetic 9
    // 5:   L10(#000005) -> Cosmetic 10

    const bVal = b; // Aliasing for clarity
    const isBlueWater =
      r === 0 &&
      g === 0 &&
      (bVal === 106 ||
        bVal === 160 || // Cosmetic 1 (Restored)
        bVal === 122 ||
        bVal === 102 ||
        bVal === 81 ||
        bVal === 63 ||
        bVal === 51 ||
        bVal === 41 ||
        bVal === 29 ||
        bVal === 17 ||
        bVal === 5);

    const isWater = a < 20 || isBlueWater;

    if (isWater) {
      // transparent or specific blue
      tm.types[i] = TerrainType.Water;
      if (bVal === 160) tm.cosmetics[i] = 1;
      else if (bVal === 122) tm.cosmetics[i] = 2;
      else if (bVal === 102) tm.cosmetics[i] = 3;
      else if (bVal === 81) tm.cosmetics[i] = 4;
      else if (bVal === 63) tm.cosmetics[i] = 5;
      else if (bVal === 51) tm.cosmetics[i] = 6;
      else if (bVal === 41) tm.cosmetics[i] = 7;
      else if (bVal === 29) tm.cosmetics[i] = 8;
      else if (bVal === 17) tm.cosmetics[i] = 9;
      else if (bVal === 5) tm.cosmetics[i] = 10;
    } else if (r === 0 && g === 0 && b === 0 && a === 255) {
      // Black = Barrier
      tm.types[i] = TerrainType.Barrier;
      tm.magnitudes[i] = 31;
    } else {
      tm.types[i] = TerrainType.Land;
      tm.magnitudes[i] = 0;
      // 140 -> 200 = 60
      const mag = Math.min(200, Math.max(140, b)) - 140;
      tm.magnitudes[i] = Math.ceil(mag / 2); // Discretize early or keep as float? TypedArray is Int16. logic used mag/2.
      // Original: terrain[x][y].magnitude = mag / 2;
      // Later packed: Math.min(Math.ceil(tile.magnitude), 31)
      // I'll store it multiplied maybe? Or just integer. mag/2 is 0-30. Int is fine.
    }
  }

  removeSmallIslands(tm, removeSmall);
  processWater(tm, removeSmall);

  const miniTm = await createMiniMap(tm);
  const thumb = await createMapThumbnail(miniTm);

  return {
    map: packTerrain(tm),
    miniMap: packTerrain(miniTm),
    thumb: thumb,
  };
}

async function createMiniMap(tm: TerrainMap): Promise<TerrainMap> {
  const miniW = Math.floor(tm.width / 2);
  const miniH = Math.floor(tm.height / 2);
  const miniTm = createTerrainMap(miniW, miniH);

  // Original Logic:
  // for x in source
  //   for y in source
  //     miniX = floor(x/2), miniY = floor(y/2)
  //     if mini is null or not water:
  //       mini = source

  // This logic means "if ANY source tile in the 2x2 block is Water, the mini tile becomes Water?"
  // Wait: original Code:
  // if (miniMap[miniX][miniY] === null || miniMap[miniX][miniY].type !== TerrainType.Water)
  //   miniMap[miniX][miniY] = tm[x][y]

  // If tm[x][y] IS water, it overwrites whatever was there (unless it was already water? No).
  // Implicitly: Water overrides Land.
  // Because if current mini is Land (type 0), and new source is Water (type 1), we overwrite.
  // If current mini is Water, we don't enter the block (condition fail).
  // So: Priority: Water > Land?
  // Let's iterate source pixels.

  for (let y = 0; y < tm.height; y++) {
    for (let x = 0; x < tm.width; x++) {
      const srcI = y * tm.width + x;
      const miniX = Math.floor(x / 2);
      const miniY = Math.floor(y / 2);

      if (miniX >= miniW || miniY >= miniH) continue;

      const dstI = miniY * miniW + miniX;

      // Initialize if "null" (we check if we processed this tile yet? No, arrays init to 0/Land)
      // We need a way to track if we touched this tile?
      // Actually init whole array to Land (0) is default.
      // But Water is 1. Barrier is 2.
      // Original code relied on `null` initialization.
      // TypedArrays init to 0 (Land).
      // We assume Land is default.
      // If source is Water, we want mini to be Water.

      // Replicating logic strictly:
      // "If mini tile is not Water, take the source tile".
      // This means if we encounter specified source tile, we copy it to mini, UNLESS mini is already Water.
      // So Water is "sticky". Once a mini tile becomes Water, it stays Water.

      if (miniTm.types[dstI] !== TerrainType.Water) {
        miniTm.types[dstI] = tm.types[srcI];
        miniTm.magnitudes[dstI] = tm.magnitudes[srcI];
        miniTm.shorelines[dstI] = tm.shorelines[srcI];
        miniTm.oceans[dstI] = tm.oceans[srcI];
        miniTm.cosmetics[dstI] = tm.cosmetics[srcI];
      }
    }
  }
  return miniTm;
}

function getNeighbors(i: number, tm: TerrainMap): number[] {
  const x = i % tm.width;
  const y = Math.floor(i / tm.width);
  const ns: number[] = [];

  if (x > 0) ns.push(i - 1);
  if (x < tm.width - 1) ns.push(i + 1);
  if (y > 0) ns.push(i - tm.width);
  if (y < tm.height - 1) ns.push(i + tm.width);

  return ns;
}

function processShore(tm: TerrainMap): number[] {
  console.debug("Identifying shorelines");
  const shorelineWaters: number[] = []; // Indices
  const size = tm.width * tm.height;

  for (let i = 0; i < size; i++) {
    const type = tm.types[i];
    const ns = getNeighbors(i, tm);

    if (type === TerrainType.Land) {
      // Land is shoreline if it has water neighbors
      if (ns.some((n) => tm.types[n] === TerrainType.Water)) {
        tm.shorelines[i] = 1;
      }
    } else if (type === TerrainType.Water) {
      // Water is shoreline if it has land neighbors
      if (ns.some((n) => tm.types[n] === TerrainType.Land)) {
        tm.shorelines[i] = 1;
        shorelineWaters.push(i);
      }
    }
  }
  return shorelineWaters;
}

function processDistToLand(shorelineWaters: number[], tm: TerrainMap) {
  console.debug(
    "Setting Water tiles magnitude = Manhattan distance from nearest land",
  );

  const visited = new Uint8Array(tm.width * tm.height); // 0=false, 1=true
  // Queue for BFS. Using huge array or simple JS array? JS array of numbers (indices) is fine for efficiency.
  // Actually, we store {index, dist}
  // To avoid object alloc in queue, we could use two arrays or one interleaved array.
  const queue: number[] = []; // [index, dist, index, dist...]

  for (const idx of shorelineWaters) {
    queue.push(idx, 0);
    visited[idx] = 1;
    tm.magnitudes[idx] = 0; // distance 0
  }

  let head = 0;
  while (head < queue.length) {
    const currI = queue[head++];
    const dist = queue[head++];

    const cx = currI % tm.width;
    const cy = Math.floor(currI / tm.width);

    // Check neighbors manually to calculate next indices efficiently
    // Directions: right, left, down, up
    const neighbors: number[] = [];
    if (cx < tm.width - 1) neighbors.push(currI + 1);
    if (cx > 0) neighbors.push(currI - 1);
    if (cy < tm.height - 1) neighbors.push(currI + tm.width);
    if (cy > 0) neighbors.push(currI - tm.width);

    for (const ni of neighbors) {
      if (visited[ni] === 0 && tm.types[ni] === TerrainType.Water) {
        visited[ni] = 1;
        const newDist = dist + 1;
        tm.magnitudes[ni] = newDist;
        queue.push(ni, newDist);
      }
    }
  }
}

function getAreaIndices(
  startI: number,
  tm: TerrainMap,
  visited: Uint8Array, // Pass global visited array
): number[] {
  const targetType = tm.types[startI];
  const area: number[] = [];
  const queue: number[] = [startI];

  // Mark start immediately? Caller should check visited before calling.
  // But we need to mark as we enqueue/dequeue.
  // To be safe, caller marks start.

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    area.push(curr);

    const ns = getNeighbors(curr, tm);
    for (const n of ns) {
      if (visited[n] === 0 && tm.types[n] === targetType) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  return area;
}

function processWater(tm: TerrainMap, removeSmall: boolean) {
  console.debug("Processing water bodies");
  const visited = new Uint8Array(tm.width * tm.height);
  const waterBodies: { indices: number[]; size: number }[] = [];

  for (let i = 0; i < tm.types.length; i++) {
    if (tm.types[i] === TerrainType.Water && visited[i] === 0) {
      visited[i] = 1;
      const body = getAreaIndices(i, tm, visited);
      waterBodies.push({ indices: body, size: body.length });
    }
  }

  // Sort large to small
  waterBodies.sort((a, b) => b.size - a.size);

  let smallLakes = 0;
  let oceanCount = 0;

  if (waterBodies.length > 0) {
    for (let w = 0; w < waterBodies.length; w++) {
      if (w === 0 || waterBodies[w].size >= min_lake_size) {
        oceanCount++;
        const indices = waterBodies[w].indices;
        for (let k = 0; k < indices.length; k++) {
          tm.oceans[indices[k]] = 1;
        }
      }
    }
    console.debug(`Identified ${oceanCount} ocean bodies`);

    if (removeSmall) {
      console.debug("Searching for small water bodies for removal");
      for (let w = 0; w < waterBodies.length; w++) {
        if (waterBodies[w].size < min_lake_size) {
          smallLakes++;
          const indices = waterBodies[w].indices;
          for (let k = 0; k < indices.length; k++) {
            const idx = indices[k];
            tm.types[idx] = TerrainType.Land;
            tm.magnitudes[idx] = 0;
          }
        }
      }
      console.debug(`Removed ${smallLakes} small water bodies`);
    }

    const shorelineWaters = processShore(tm);
    processDistToLand(shorelineWaters, tm);
  } else {
    console.debug("No water bodies found");
  }
}

function removeSmallIslands(tm: TerrainMap, removeSmall: boolean) {
  if (!removeSmall) return;
  const visited = new Uint8Array(tm.width * tm.height);
  const landBodies: { indices: number[]; size: number }[] = [];

  for (let i = 0; i < tm.types.length; i++) {
    if (tm.types[i] === TerrainType.Land && visited[i] === 0) {
      visited[i] = 1;
      const body = getAreaIndices(i, tm, visited);
      landBodies.push({ indices: body, size: body.length });
    }
  }

  let smallIslands = 0;
  for (let b = 0; b < landBodies.length; b++) {
    if (landBodies[b].size < min_island_size) {
      smallIslands++;
      const indices = landBodies[b].indices;
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k];
        tm.types[idx] = TerrainType.Water;
        tm.magnitudes[idx] = 0;
        tm.cosmetics[idx] = 0;
      }
    }
  }
  console.debug(`Removed ${smallIslands} small islands`);
}

function packTerrain(tm: TerrainMap): Uint8Array {
  const size = tm.width * tm.height;
  const packedData = new Uint8Array(4 + size);

  packedData[0] = tm.width & 0xff;
  packedData[1] = (tm.width >> 8) & 0xff;
  packedData[2] = tm.height & 0xff;
  packedData[3] = (tm.height >> 8) & 0xff;

  for (let i = 0; i < size; i++) {
    let byte = 0;
    const type = tm.types[i];

    // Bits: 7=Land?, 6=Shore, 5=Ocean, 0-4=Mag
    if (type === TerrainType.Land || type === TerrainType.Barrier) {
      byte |= 0b10000000;
    }
    if (tm.shorelines[i] === 1) {
      byte |= 0b01000000;
    }
    if (tm.oceans[i] === 1) {
      byte |= 0b00100000;
    }

    if (type === TerrainType.Land) {
      byte |= Math.min(Math.ceil(tm.magnitudes[i]), 31);
    } else if (type === TerrainType.Barrier) {
      byte |= 31;
    } else {
      // Water
      let mag = Math.min(Math.ceil(tm.magnitudes[i] / 2), 31);
      // Clamp standard water to 20 to reserve 21+ for cosmetics
      // Using 20 as max standard water depth
      if (mag > 20) mag = 20;

      // Apply cosmetics (mag 21-30)
      if (tm.cosmetics[i] > 0) {
        // Map cosmetic ID 1..10 to 21..30
        // Override standard magnitude completely
        mag = 20 + tm.cosmetics[i];
      }

      byte |= mag;
    }

    // We are iterating row-major (y*width+x), which is what packTerrain expects.
    packedData[4 + i] = byte;
  }
  return packedData;
}

async function createMapThumbnail(
  tm: TerrainMap,
  quality: number = 0.5,
): Promise<sharp.Sharp> {
  console.debug("creating thumbnail");

  const targetWidth = Math.max(1, Math.floor(tm.width * quality));
  const targetHeight = Math.max(1, Math.floor(tm.height * quality));

  const pixelData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor(x / quality);
      const srcY = Math.floor(y / quality);

      const srcI =
        Math.min(srcY, tm.height - 1) * tm.width + Math.min(srcX, tm.width - 1);

      const rgba = getThumbnailColor(srcI, tm);

      const idx = (y * targetWidth + x) * 4;
      pixelData[idx] = rgba.r;
      pixelData[idx + 1] = rgba.g;
      pixelData[idx + 2] = rgba.b;
      pixelData[idx + 3] = rgba.a;
    }
  }

  return sharp(pixelData, {
    raw: {
      width: targetWidth,
      height: targetHeight,
      channels: 4,
    },
  });
}

function getThumbnailColor(
  i: number,
  tm: TerrainMap,
): { r: number; g: number; b: number; a: number } {
  const type = tm.types[i];
  const shore = tm.shorelines[i] === 1;
  const mag = tm.magnitudes[i];

  if (type === TerrainType.Water) {
    if (shore) return { r: 100, g: 143, b: 255, a: 255 };
    const waterAdjRGB = 11 - Math.min(mag / 2, 10) - 10;
    return {
      r: Math.max(70 + waterAdjRGB, 0),
      g: Math.max(132 + waterAdjRGB, 0),
      b: Math.max(180 + waterAdjRGB, 0),
      a: 0,
    };
  }

  if (shore) {
    return { r: 204, g: 203, b: 158, a: 255 };
  }

  if (type === TerrainType.Barrier) {
    return { r: 0, g: 0, b: 0, a: 255 };
  }

  let adjRGB: number;
  if (mag < 10) {
    adjRGB = 220 - 2 * mag;
    return { r: 190, g: adjRGB, b: 138, a: 255 };
  } else if (mag < 20) {
    adjRGB = 2 * mag;
    return { r: 200 + adjRGB, g: 183 + adjRGB, b: 138 + adjRGB, a: 255 };
  } else {
    // Mountain (20-30)
    // Scale 20->30 to 0->1
    const t = Math.max(0, Math.min(1, (mag - 20) / 10));
    // Lerp from Grey (150) to White (255)
    // 150 = 20 magnitude
    // 255 = 30 magnitude
    const val = Math.floor(150 + t * 105);
    return { r: val, g: val, b: val, a: 255 };
  }
}
