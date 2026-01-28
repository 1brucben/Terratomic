import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

export class SatelliteLayer implements Layer {
  layerName = "SatelliteLayer";
  private image: HTMLImageElement | null = null;
  private isLoaded = false;

  constructor(
    private game: GameView,
    private uiState: { satelliteLayerEnabled: boolean },
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init() {
    const mapName = this.game.config().gameConfig().gameMap;
    const url = `maps/${mapName}/${mapName}_Terrain.png`;

    this.image = new Image();
    this.image.crossOrigin = "anonymous";
    this.image.src = url;
    this.image.onload = () => {
      this.isLoaded = true;
      console.log(`Satellite layer loaded: ${url}`);
    };
    this.image.onerror = () => {
      console.warn(`Failed to load satellite layer: ${url}`);
      this.isLoaded = false;
      this.image = null;
    };
  }

  tick() {}

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.uiState.satelliteLayerEnabled || !this.isLoaded || !this.image) {
      return;
    }

    // Render covering the entire map
    // Coordinates in world space are centered at 0,0?
    // Usually game width/height are used.
    // GameRenderer centers using transformHandler.
    // Standard drawing in other layers:
    // context.drawImage(..., -width/2, -height/2, width, height)

    const w = this.game.width();
    const h = this.game.height();

    context.drawImage(this.image, -w / 2, -h / 2, w, h);
  }
}
