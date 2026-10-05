export interface Point2D {
  x: number;
  z: number;
}

export interface Rect2D extends Point2D {
  w: number;
  d: number;
}

export interface Bounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const rectOf = (rect: Rect2D): Bounds2D => ({
  minX: rect.x - rect.w / 2,
  maxX: rect.x + rect.w / 2,
  minZ: rect.z - rect.d / 2,
  maxZ: rect.z + rect.d / 2,
});

export const areaOf = (rect: Pick<Rect2D, "w" | "d">): number => rect.w * rect.d;

export const distance = (a: Point2D, b: Point2D): number => Math.hypot(a.x - b.x, a.z - b.z);

export function overlapArea(a: Rect2D, b: Rect2D): number {
  const boundsA = rectOf(a);
  const boundsB = rectOf(b);
  const width = Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX);
  const depth = Math.min(boundsA.maxZ, boundsB.maxZ) - Math.max(boundsA.minZ, boundsB.minZ);
  return width > 0 && depth > 0 ? width * depth : 0;
}

export function containsRect(outer: Rect2D, inner: Rect2D, tolerance = 1e-6): boolean {
  const outerBounds = rectOf(outer);
  const innerBounds = rectOf(inner);
  return (
    innerBounds.minX >= outerBounds.minX - tolerance &&
    innerBounds.maxX <= outerBounds.maxX + tolerance &&
    innerBounds.minZ >= outerBounds.minZ - tolerance &&
    innerBounds.maxZ <= outerBounds.maxZ + tolerance
  );
}

export function polylineLength(points: readonly Point2D[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += distance(points[index - 1], points[index]);
  return total;
}

export function dedupePoints(points: readonly Point2D[], epsilon = 1e-6): Point2D[] {
  const unique: Point2D[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (!previous || distance(previous, point) > epsilon) unique.push(point);
  }
  return unique;
}

export const round = (value: number, digits = 1): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};