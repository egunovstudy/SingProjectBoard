import type { Layout, MatrixBounds } from "./types.ts";

// These are world coordinates, independent of the current outer boundaries.
export const AXIS = { x: 550, y: 450 };
export const DEFAULT_MATRIX: MatrixBounds = {
  left: 0,
  top: 0,
  right: 1100,
  bottom: 900,
};
export const MATRIX_LIMIT = 110000;
export type MatrixSide = keyof MatrixBounds;
export function validMatrix(value: unknown): value is MatrixBounds {
  const b = value as MatrixBounds;
  return (
    !!b &&
    typeof b === "object" &&
    Object.keys(b).length === 4 &&
    ["left", "top", "right", "bottom"].every(
      (k) =>
        typeof b[k as MatrixSide] === "number" &&
        Number.isFinite(b[k as MatrixSide]) &&
        Math.abs(b[k as MatrixSide]) <= MATRIX_LIMIT
    ) &&
    b.left <= 0 &&
    b.top <= 0 &&
    b.right >= 1100 &&
    b.bottom >= 900
  );
}
export const sameMatrix = (a: MatrixBounds, b: MatrixBounds) =>
  a.left === b.left &&
  a.top === b.top &&
  a.right === b.right &&
  a.bottom === b.bottom;
const placed = (l: Layout) =>
  !l.hidden && Number.isFinite(l.x) && Number.isFinite(l.y);

// Grow only when a card approaches an edge. The reserve is roughly one card.
export function expandMatrix(
  bounds: MatrixBounds,
  layouts: Layout[]
): MatrixBounds {
  const next = { ...bounds };
  for (const l of layouts) {
    if (!placed(l)) continue;
    const x = l.x!,
      y = l.y!,
      right = x + (l.width || 250),
      bottom = y + (l.height || 100);
    if (x < next.left + 64)
      next.left -= Math.ceil((next.left + 280 - x) / 280) * 280;
    if (right > next.right - 64)
      next.right += Math.ceil((right + 280 - next.right) / 280) * 280;
    if (y < next.top + 64)
      next.top -= Math.ceil((next.top + 160 - y) / 160) * 160;
    if (bottom > next.bottom - 64)
      next.bottom += Math.ceil((bottom + 160 - next.bottom) / 160) * 160;
  }
  return {
    left: Math.max(-MATRIX_LIMIT, next.left),
    top: Math.max(-MATRIX_LIMIT, next.top),
    right: Math.min(MATRIX_LIMIT, next.right),
    bottom: Math.min(MATRIX_LIMIT, next.bottom),
  };
}
export const fitMatrix = (layouts: Layout[]) =>
  expandMatrix(DEFAULT_MATRIX, layouts);
export function resizeMatrix(
  bounds: MatrixBounds,
  side: MatrixSide,
  value: number,
  layouts: Layout[]
): MatrixBounds {
  const next = {
    ...bounds,
    [side]: Math.round(Math.max(-MATRIX_LIMIT, Math.min(MATRIX_LIMIT, value))),
  };
  next.left = Math.min(next.left, 0);
  next.top = Math.min(next.top, 0);
  next.right = Math.max(next.right, 1100);
  next.bottom = Math.max(next.bottom, 900);
  return expandMatrix(next, layouts);
}
export function quadrantRect(bounds: MatrixBounds, index: number) {
  const x = index % 2 === 0 ? bounds.left : AXIS.x,
    y = index < 2 ? bounds.top : AXIS.y;
  return {
    x,
    y,
    width: (index % 2 === 0 ? AXIS.x : bounds.right) - x,
    height: (index < 2 ? AXIS.y : bounds.bottom) - y,
  };
}
export function matrixFrame(bounds: MatrixBounds) {
  return {
    position: { x: bounds.left - 180, y: bounds.top - 164 },
    width: bounds.right - bounds.left + 180,
    height: bounds.bottom - bounds.top + 164,
  };
}
function overlaps(
  x: number,
  y: number,
  width: number,
  height: number,
  l: Layout
) {
  return (
    placed(l) &&
    x < l.x! + (l.width || 250) + 24 &&
    x + width + 24 > l.x! &&
    y < l.y! + (l.height || 100) + 24 &&
    y + height + 24 > l.y!
  );
}
export function placeInQuadrant(
  index: number,
  bounds: MatrixBounds,
  occupied: Layout[],
  size = { width: 250, height: 100 }
): Required<Pick<Layout, "x" | "y" | "width" | "height">> {
  if (!Number.isInteger(index) || index < 0 || index > 3)
    throw new Error("Выберите один из четырёх квадрантов");
  const rect = quadrantRect(bounds, index),
    gap = 24;
  const columns = Math.max(1, Math.floor(rect.width / (size.width + gap)));
  const rows = Math.max(1, Math.floor(rect.height / (size.height + gap)));
  const live = occupied.filter(placed);
  // Fill compact rings around the axes; reserve space must not produce a single long row.
  const slot = (row: number, col: number) => {
    const x =
      index % 2 === 0
        ? AXIS.x - gap - size.width - col * (size.width + gap)
        : AXIS.x + gap + col * (size.width + gap);
    const y =
      index < 2
        ? AXIS.y - gap - size.height - row * (size.height + gap)
        : AXIS.y + 80 + row * (size.height + gap);
    if (Math.abs(x) > 100000 || Math.abs(y) > 100000) return;
    if (live.every((l) => !overlaps(x, y, size.width, size.height, l)))
      return { x, y, ...size };
  };
  for (let phase = 0; phase < 2; phase++) {
    const rings = Math.max(rows, columns) + (phase === 0 ? 0 : 200);
    for (let ring = 0; ring < rings; ring++) {
      const candidates: [number, number][] = [];
      for (let col = 0; col <= ring; col++) candidates.push([ring, col]);
      for (let row = 0; row < ring; row++) candidates.push([row, ring]);
      for (const [row, col] of candidates) {
        const inside = row < rows && col < columns;
        if (inside !== (phase === 0)) continue;
        const found = slot(row, col);
        if (found) return found;
      }
    }
  }
  throw new Error(
    "Не удалось найти свободное место. Расширьте матрицу вручную"
  );
}
