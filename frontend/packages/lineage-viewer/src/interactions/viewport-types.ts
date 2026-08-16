export interface ViewportTransform {
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface SceneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportFitOptions {
  readonly padding?: number;
  readonly minScale?: number;
  readonly maxScale?: number;
}
