import fs from "fs";
import path from "path";
import { encodePNGToStream, make } from "pureimage";
import { PseudoRandom } from "../core/PseudoRandom.js";

const WIDTH = 1024;
const HEIGHT = 1024;
const SEED = 12345;

async function generate() {
  const p = new PseudoRandom(SEED);
  const img = make(WIDTH, HEIGHT);
  const ctx = img.getContext("2d");

  // COLORS
  // Water: Blue = 106
  const WATER_COLOR = "rgba(0, 0, 106, 1.0)";
  // Land: Blue >= 140. Let's use 150 for base land.
  // We can vary it for texture.
  const LAND_BASE_R = 34;
  const LAND_BASE_G = 139;
  const LAND_BASE_B = 150;

  // Fill background with water
  ctx.fillStyle = WATER_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Define Island Zones
  // 40% Left, 20% Gap, 40% Right
  const splitWidth = Math.floor(WIDTH * 0.4); // ~409
  const gapStart = splitWidth;
  const gapEnd = WIDTH - splitWidth; // ~615

  // Margins to make them "islands"
  const margin = 30;

  // Left Island Bounds
  const leftX1 = margin;
  const leftX2 = splitWidth - margin;
  const leftY1 = margin;
  const leftY2 = HEIGHT - margin;

  // Right Island Bounds
  const rightX1 = gapEnd + margin;
  const rightX2 = WIDTH - margin;
  const rightY1 = margin;
  const rightY2 = HEIGHT - margin;

  // Function to draw land with noise
  function drawIsland(x1, x2, y1, y2) {
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        // Base Land
        let b = LAND_BASE_B;

        // Add some noise to magnitude (Blue channel)
        // varying between 140 and 180
        const noise = p.next();
        if (noise > 0.7) {
          b += 10; // Highland
        } else if (noise > 0.9) {
          b += 30; // Mountain
        }

        // Set pixel
        // setPixelRGBA_i(x, y, r, g, b, a)
        img.setPixelRGBA_i(x, y, LAND_BASE_R, LAND_BASE_G, b, 255);
      }
    }
  }

  console.log("Drawing Left Island...");
  drawIsland(leftX1, leftX2, leftY1, leftY2);

  console.log("Drawing Right Island...");
  drawIsland(rightX1, rightX2, rightY1, rightY2);

  const outPath = path.resolve(
    process.cwd(),
    "resources",
    "maps",
    "Nukewars1024.png",
  );
  const stream = fs.createWriteStream(outPath);
  await encodePNGToStream(img, stream);
  console.log(`Generated ${outPath}`);
}

generate().catch(console.error);
