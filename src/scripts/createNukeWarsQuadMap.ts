import path from "path";
import sharp from "sharp";

const width = 1500;
const height = 1500;

// RGBA colors - matching NukeWars2000 format
const WATER = [0, 0, 106, 255];
const LAND = [0, 0, 140, 255];
const BARRIER = [0, 0, 0, 255];

// Create buffer
const buffer = Buffer.alloc(width * height * 4);

function setPixel(x: number, y: number, color: number[]) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const idx = (y * width + x) * 4;
  buffer[idx] = color[0];
  buffer[idx + 1] = color[1];
  buffer[idx + 2] = color[2];
  buffer[idx + 3] = color[3];
}

// Fill with water
for (let i = 0; i < width * height; i++) {
  const idx = i * 4;
  buffer[idx] = WATER[0];
  buffer[idx + 1] = WATER[1];
  buffer[idx + 2] = WATER[2];
  buffer[idx + 3] = WATER[3];
}

// Helper for rounded rect
function drawRoundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: number[],
) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      // Check if inside rounded rect
      let inside = true;
      // Corners
      if (px < x + r && py < y + r) {
        // Top-left
        if ((px - (x + r)) ** 2 + (py - (y + r)) ** 2 > r ** 2) inside = false;
      } else if (px > x + w - r && py < y + r) {
        // Top-right
        if ((px - (x + w - r)) ** 2 + (py - (y + r)) ** 2 > r ** 2)
          inside = false;
      } else if (px < x + r && py > y + h - r) {
        // Bottom-left
        if ((px - (x + r)) ** 2 + (py - (y + h - r)) ** 2 > r ** 2)
          inside = false;
      } else if (px > x + w - r && py > y + h - r) {
        // Bottom-right
        if ((px - (x + w - r)) ** 2 + (py - (y + h - r)) ** 2 > r ** 2)
          inside = false;
      }

      if (inside) {
        setPixel(px, py, color);
      }
    }
  }
}

// Draw barriers FIRST (cross in center)
// Vertical barrier
for (let y = 0; y < height; y++) {
  for (let x = 748; x < 752; x++) {
    // 4px wide centered at 750
    setPixel(x, y, BARRIER);
  }
}
// Horizontal barrier
for (let x = 0; x < width; x++) {
  for (let y = 748; y < 752; y++) {
    // 4px wide centered at 750
    setPixel(x, y, BARRIER);
  }
}

// Draw 4 corner islands
const islandSize = 500;
const cornerMargin = 50;
const cornerRadius = 60;

// Top-left island
drawRoundedRect(
  cornerMargin,
  cornerMargin,
  islandSize,
  islandSize,
  cornerRadius,
  LAND,
);

// Top-right island
drawRoundedRect(
  width - islandSize - cornerMargin,
  cornerMargin,
  islandSize,
  islandSize,
  cornerRadius,
  LAND,
);

// Bottom-left island
drawRoundedRect(
  cornerMargin,
  height - islandSize - cornerMargin,
  islandSize,
  islandSize,
  cornerRadius,
  LAND,
);

// Bottom-right island
drawRoundedRect(
  width - islandSize - cornerMargin,
  height - islandSize - cornerMargin,
  islandSize,
  islandSize,
  cornerRadius,
  LAND,
);

const outputPath = path.resolve(
  process.cwd(),
  "resources",
  "maps",
  "NukeWarsQuad.png",
);

sharp(buffer, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(outputPath)
  .then(() =>
    console.log(`NukeWarsQuad map generated at ${outputPath} (1500x1500)`),
  )
  .catch((err) => console.error(err));
