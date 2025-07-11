const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Reads a Uint8Array .bin file, assuming first 4 bytes = width/height (16-bit LE)
async function loadBinTerrain(url) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const width = bytes[0] | (bytes[1] << 8);
  const height = bytes[2] | (bytes[3] << 8);
  const data = bytes.slice(4);

  if (data.length !== width * height) {
    throw new Error("Wrong .bin dimensions");
  }

  return { width, height, data };
}

function getTerrainColor(byte) {
  const IS_LAND_BIT = 1 << 7;
  const SHORELINE_BIT = 1 << 6;
  const OCEAN_BIT = 1 << 5;
  const MAGNITUDE_MASK = 0b00011111;

  const isLand = (byte & IS_LAND_BIT) !== 0;
  const isShoreline = (byte & SHORELINE_BIT) !== 0;
  const isOcean = (byte & OCEAN_BIT) !== 0;
  const magnitude = byte & MAGNITUDE_MASK;

  if (isLand && isShoreline) {
    return { r: 204, g: 203, b: 158, a: 255 }; // Shore
  }

  if (!isLand) {
    if (isShoreline && isOcean) {
      return { r: 100, g: 143, b: 255, a: 255 }; // Shoreline Water
    }

    const base = { r: 70, g: 132, b: 180 };
    return {
      r: Math.max(base.r - 10 + (11 - Math.min(magnitude, 10)), 0),
      g: Math.max(base.g - 10 + (11 - Math.min(magnitude, 10)), 0),
      b: Math.max(base.b - 10 + (11 - Math.min(magnitude, 10)), 0),
      a: 255,
    };
  }

  if (magnitude < 10) {
    return { r: 190, g: 220 - 2 * magnitude, b: 138, a: 255 }; // Plains
  } else if (magnitude < 20) {
    return {
      r: Math.min(255, 200 + 2 * magnitude),
      g: Math.min(255, 183 + 2 * magnitude),
      b: Math.min(255, 138 + 2 * magnitude),
      a: 255,
    };
  } else {
    const v = Math.min(255, 230 + magnitude / 2);
    return { r: v, g: v, b: v, a: 255 };
  }
}

function drawTerrain({ width, height, data }) {
  canvas.width = width;
  canvas.height = height;

  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < data.length; i++) {
    const color = getTerrainColor(data[i]);
    const offset = i * 4;
    imageData.data[offset] = color.r;
    imageData.data[offset + 1] = color.g;
    imageData.data[offset + 2] = color.b;
    imageData.data[offset + 3] = color.a;
  }

  ctx.putImageData(imageData, 0, 0);
}

// 🔁 Entry point
loadBinTerrain("Europe.bin")
  .then(drawTerrain)
  .catch((err) => console.error("Failed to load terrain:", err));
