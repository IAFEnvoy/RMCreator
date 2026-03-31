import { rotatePoint } from "../utils.js";

export function getLinePoints(geometry, from, to, options = {}) {
  const flip = Boolean(options.flip);

  if (geometry === "bend90") {
    const corner = flip ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
    return [from, corner, to];
  }

  if (geometry === "bend135") {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx >= absDy) {
      if (!flip) {
        const corner = {
          x: from.x + (dx - Math.sign(dx || 1) * absDy),
          y: from.y
        };
        return [from, corner, to];
      }

      const corner = {
        x: from.x + Math.sign(dx || 1) * absDy,
        y: to.y
      };
      return [from, corner, to];
    }

    if (!flip) {
      const corner = {
        x: from.x,
        y: from.y + (dy - Math.sign(dy || 1) * absDx)
      };
      return [from, corner, to];
    }

    const corner = {
      x: to.x,
      y: from.y + Math.sign(dy || 1) * absDx
    };
    return [from, corner, to];
  }

  if (geometry === "bend90rot45") {
    const a = rotatePoint(from, -Math.PI / 4);
    const b = rotatePoint(to, -Math.PI / 4);
    const cornerRotated = flip ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
    const corner = rotatePoint(cornerRotated, Math.PI / 4);
    return [from, corner, to];
  }

  return [from, to];
}

export function buildPathD(points, cornerRadius = 0) {
  const polyline = sanitizePolyline(points);
  if (!polyline.length) {
    return "";
  }

  if (cornerRadius > 0 && polyline.length > 2) {
    return buildRoundedPathD(polyline, cornerRadius);
  }

  const head = `M ${polyline[0].x} ${polyline[0].y}`;
  const rest = polyline.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
  return `${head} ${rest}`;
}

export function applyEndpointOffsets(points, startOffset = 0, endOffset = 0) {
  const polyline = sanitizePolyline(points).map((point) => ({ ...point }));
  if (polyline.length < 2) {
    return polyline;
  }

  const startDir = {
    x: polyline[1].x - polyline[0].x,
    y: polyline[1].y - polyline[0].y
  };
  const endDir = {
    x: polyline[polyline.length - 1].x - polyline[polyline.length - 2].x,
    y: polyline[polyline.length - 1].y - polyline[polyline.length - 2].y
  };

  const startNormal = getUnitNormal(polyline[0], polyline[1]);
  const endNormal = getUnitNormal(polyline[polyline.length - 2], polyline[polyline.length - 1]);

  const startPoint = {
    x: polyline[0].x + startNormal.x * startOffset,
    y: polyline[0].y + startNormal.y * startOffset
  };
  const endPoint = {
    x: polyline[polyline.length - 1].x + endNormal.x * endOffset,
    y: polyline[polyline.length - 1].y + endNormal.y * endOffset
  };

  if (polyline.length === 2) {
    return [startPoint, endPoint];
  }

  const shiftedStartLineB = {
    x: startPoint.x + startDir.x,
    y: startPoint.y + startDir.y
  };
  const shiftedEndLineA = {
    x: endPoint.x - endDir.x,
    y: endPoint.y - endDir.y
  };

  const cross = lineIntersection(startPoint, shiftedStartLineB, shiftedEndLineA, endPoint);

  if (!cross) {
    return [startPoint, {
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2
    }, endPoint];
  }

  return [startPoint, cross, endPoint];
}

function buildRoundedPathD(points, cornerRadius) {
  const pathParts = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const lenIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenOut = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (lenIn < 1e-6 || lenOut < 1e-6) {
      continue;
    }

    const cut = Math.min(cornerRadius, lenIn / 2, lenOut / 2);
    const inPoint = {
      x: curr.x + ((prev.x - curr.x) / lenIn) * cut,
      y: curr.y + ((prev.y - curr.y) / lenIn) * cut
    };
    const outPoint = {
      x: curr.x + ((next.x - curr.x) / lenOut) * cut,
      y: curr.y + ((next.y - curr.y) / lenOut) * cut
    };

    pathParts.push(`L ${inPoint.x} ${inPoint.y}`);
    pathParts.push(`Q ${curr.x} ${curr.y} ${outPoint.x} ${outPoint.y}`);
  }

  const last = points[points.length - 1];
  pathParts.push(`L ${last.x} ${last.y}`);
  return pathParts.join(" ");
}

export function getParallelOffsets(widths, gap = 0) {
  if (!widths.length) {
    return [];
  }

  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  let cursor = -total / 2;
  const offsets = [];

  widths.forEach((width, index) => {
    cursor += width / 2;
    offsets.push(cursor);
    cursor += width / 2;
    if (index < widths.length - 1) {
      cursor += gap;
    }
  });

  return offsets;
}

export function getOffsetPolyline(points, offsetDistance) {
  const polyline = sanitizePolyline(points);
  if (polyline.length < 2 || Math.abs(offsetDistance) < 1e-6) {
    return polyline;
  }

  const shiftedSegments = [];
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const normal = getUnitNormal(a, b);
    const shift = {
      x: normal.x * offsetDistance,
      y: normal.y * offsetDistance
    };
    shiftedSegments.push({
      a: { x: a.x + shift.x, y: a.y + shift.y },
      b: { x: b.x + shift.x, y: b.y + shift.y }
    });
  }

  if (!shiftedSegments.length) {
    return polyline;
  }

  const result = [shiftedSegments[0].a];

  for (let i = 1; i < shiftedSegments.length; i += 1) {
    const prev = shiftedSegments[i - 1];
    const next = shiftedSegments[i];
    const cross = lineIntersection(prev.a, prev.b, next.a, next.b);
    if (cross) {
      result.push(cross);
      continue;
    }

    result.push({
      x: (prev.b.x + next.a.x) / 2,
      y: (prev.b.y + next.a.y) / 2
    });
  }

  result.push(shiftedSegments[shiftedSegments.length - 1].b);
  return result;
}

function sanitizePolyline(points) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }

  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1];
    const current = points[i];
    if (Math.hypot(current.x - prev.x, current.y - prev.y) > 1e-6) {
      out.push(current);
    }
  }
  return out;
}

function getUnitNormal(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: -dy / len,
    y: dx / len
  };
}

function lineIntersection(a1, a2, b1, b2) {
  const r = { x: a2.x - a1.x, y: a2.y - a1.y };
  const s = { x: b2.x - b1.x, y: b2.y - b1.y };
  const denom = cross2d(r, s);
  if (Math.abs(denom) < 1e-6) {
    return null;
  }

  const t = cross2d({ x: b1.x - a1.x, y: b1.y - a1.y }, s) / denom;
  return {
    x: a1.x + r.x * t,
    y: a1.y + r.y * t
  };
}

function cross2d(v1, v2) {
  return v1.x * v2.y - v1.y * v2.x;
}
