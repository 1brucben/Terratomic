import mapData from "../../../resources/maps/maps.json" with { type: "json" };
import { GameMapType } from "../../core/game/Game";

// Use require.context to load all thumbnails dynamically
// This is a specific feature of Webpack

// @ts-expect-error: require.context is a Webpack-specific feature
const thumbContext = require.context(
  "../../../resources/maps",
  true,
  /Thumb\.webp$/,
);

const mapImages: Record<string, string> = {};

thumbContext.keys().forEach((key: string) => {
  // key is like "./Africa/AfricaThumb.webp"
  // We want to extract "Africa" from the filename
  const fileNameMatch = key.match(/\/([^/]+)Thumb\.webp$/);
  if (fileNameMatch) {
    const fileName = fileNameMatch[1];
    mapImages[fileName] = thumbContext(key) as string;
  }
});

// Map from GameMapType (which corresponds to displayName) to actual image URL
const typeToImageMap: Record<string, string> = {};

mapData.forEach((map) => {
  // map.displayName matches the GameMapType enum value e.g "World"
  const image = mapImages[map.fileName];
  if (image) {
    typeToImageMap[map.displayName] = image;
  }
});

export function getMapsImage(map: GameMapType | string): string {
  return typeToImageMap[map] || "";
}
