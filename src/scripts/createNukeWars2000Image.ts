import path from "path";
import sharp from "sharp";

const width = 2000;
const height = 1000;

// RGBA
const buffer = Buffer.alloc(width * height * 4);

// Colors
const WATER = [0, 0, 106, 255];
const LAND = [0, 0, 140, 255];
const BARRIER = [0, 0, 0, 255];

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

// Draw Barrier FIRST (vertical strip in the center)
for (let y = 0; y < height; y++) {
  for (let x = 995; x < 1005; x++) {
    setPixel(x, y, BARRIER);
  }
}

// Draw Left Island - Taller and narrower, more rectangular
// Position: x: 100-700 (600 wide), y: 50-950 (900 tall)
// More water between island and barrier (700 to 995 = 295 pixels of water)
drawRoundedRect(100, 50, 600, 900, 80, LAND);

// Draw Right Island - Taller and narrower, more rectangular
// Position: x: 1300-1900 (600 wide), y: 50-950 (900 tall)
// More water between barrier and island (1005 to 1300 = 295 pixels of water)
drawRoundedRect(1300, 50, 600, 900, 80, LAND);

const outputPath = path.resolve(
  process.cwd(),
  "resources",
  "maps",
  "NukeWars2000.png",
);

sharp(buffer, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(outputPath)
  .then(() => console.log(`Map generated at ${outputPath}`))
  .catch((err) => console.error(err));
