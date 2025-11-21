import fs from "fs";
import path from "path";
import { encodePNGToStream, make } from "pureimage";
import { PseudoRandom } from "../core/PseudoRandom.js";

const WIDTH = 1024;
const HEIGHT = 1024;
const SEED = 67890;

async function generate() {
  const p = new PseudoRandom(SEED);
  const img = make(WIDTH, HEIGHT);
  const ctx = img.getContext("2d");

  // COLORS
  const WATER_COLOR = "rgba(0, 0, 106, 1.0)";
  const LAND_BASE_R = 34;
  const LAND_BASE_G = 139;
  const LAND_BASE_B = 150;

  // Fill background with water
  ctx.fillStyle = WATER_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Define 4 Quadrants
  const margin = 30;
  const gap = 40; // Half gap (channel width = 80)
  const midX = WIDTH / 2;
  const midY = HEIGHT / 2;

  // Function to draw a rounded rectangle island with noise
  function drawRoundedIsland(x1, y1, x2, y2, cornerRadius) {
    const w = x2 - x1;
    const h = y2 - y1;

    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        // Check rounded corners
        // Normalize coordinates relative to rect
        let inCorner = false;
        let dx = 0;
        let dy = 0;

        // Top-Left Corner
        if (x < x1 + cornerRadius && y < y1 + cornerRadius) {
          dx = x - (x1 + cornerRadius);
          dy = y - (y1 + cornerRadius);
          if (dx * dx + dy * dy > cornerRadius * cornerRadius) inCorner = true;
        }
        // Top-Right Corner
        else if (x > x2 - cornerRadius && y < y1 + cornerRadius) {
          dx = x - (x2 - cornerRadius);
          dy = y - (y1 + cornerRadius);
          if (dx * dx + dy * dy > cornerRadius * cornerRadius) inCorner = true;
        }
        // Bottom-Left Corner
        else if (x < x1 + cornerRadius && y > y2 - cornerRadius) {
          dx = x - (x1 + cornerRadius);
          dy = y - (y2 - cornerRadius);
          if (dx * dx + dy * dy > cornerRadius * cornerRadius) inCorner = true;
        }
        // Bottom-Right Corner
        else if (x > x2 - cornerRadius && y > y2 - cornerRadius) {
          dx = x - (x2 - cornerRadius);
          dy = y - (y2 - cornerRadius);
          if (dx * dx + dy * dy > cornerRadius * cornerRadius) inCorner = true;
        }

        if (!inCorner) {
          // Base Land
          let b = LAND_BASE_B;

          // Add noise
          const noise = p.next();
          if (noise > 0.7) {
            b += 10;
          } else if (noise > 0.9) {
            b += 30;
          }

          img.setPixelRGBA_i(x, y, LAND_BASE_R, LAND_BASE_G, b, 255);
        }
      }
    }
  }

  const cornerRadius = 60;

  console.log("Drawing Top-Left Island...");
  drawRoundedIsland(margin, margin, midX - gap, midY - gap, cornerRadius);

  console.log("Drawing Top-Right Island...");
  drawRoundedIsland(
    midX + gap,
    margin,
    WIDTH - margin,
    midY - gap,
    cornerRadius,
  );

  console.log("Drawing Bottom-Left Island...");
  drawRoundedIsland(
    margin,
    midY + gap,
    midX - gap,
    HEIGHT - margin,
    cornerRadius,
  );

  console.log("Drawing Bottom-Right Island...");
  drawRoundedIsland(
    midX + gap,
    midY + gap,
    WIDTH - margin,
    HEIGHT - margin,
    cornerRadius,
  );

  const outPath = path.resolve(
    process.cwd(),
    "resources",
    "maps",
    "NukeWars2.png",
  );
  const stream = fs.createWriteStream(outPath);
  await encodePNGToStream(img, stream);
  console.log(`Generated ${outPath}`);
}

generate().catch(console.error);
