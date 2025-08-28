class OffscreenCanvasMock {
  constructor(width: number, height: number) {}

  getContext(contextId: string, options?: any): any {
    return {
      clearRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(0) }),
    };
  }
}

(global as any).OffscreenCanvas = OffscreenCanvasMock;
