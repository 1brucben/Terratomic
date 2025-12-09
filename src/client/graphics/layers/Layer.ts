export interface Layer {
  init?: () => void;
  tick?: () => void;
  renderLayer?: (context: CanvasRenderingContext2D) => void;
  shouldTransform?: () => boolean;
  redraw?: () => void;
  layerName?: string; // Optional explicit name for perf tracking
}
