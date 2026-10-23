export const T = { FLOOR: 0, WALL: 1 };

// Grid world. `cell` is the world-unit size of one grid cell. For tile-authored
// levels cell = 1; for mask-imported levels cell = mask pixel block (e.g. 16).
export class World {
  constructor(cols, rows, cell, grid) {
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.grid = grid; // Uint8Array length cols*rows
    this.w = cols * cell; // world width in units
    this.h = rows * cell;
    // Native MBN linesA wall contours. Kept separate from the colour-derived
    // grid so audits can tell authored geometry from the rendered floor mask.
    this.segments = [];
    this.segmentCells = new Set();
  }

  setCollisionSegments(segments = []) {
    this.segments = [];
    this.segmentCells.clear();
    for (const s of segments) {
      const ax = Array.isArray(s) ? s[0] : s.ax;
      const ay = Array.isArray(s) ? s[1] : s.ay;
      const bx = Array.isArray(s) ? s[2] : s.bx;
      const by = Array.isArray(s) ? s[3] : s.by;
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      if (Math.hypot(bx - ax, by - ay) < 0.01) continue;
      this.segments.push({
        ax, ay, bx, by,
        minX: Math.min(ax, bx), maxX: Math.max(ax, bx),
        minY: Math.min(ay, by), maxY: Math.max(ay, by),
      });
    }
    // The colour mask is only an approximation of the floor. Rasterise the
    // authored contours into the navigation grid as well, otherwise BFS can
    // route straight through a native wall that the mask misclassified as rug
    // or floor (map11's red room divider is the regression case).
    const markRadius = this.cell * 0.2;
    for (const s of this.segments) {
      const minTx = Math.max(0, Math.floor(s.minX / this.cell) - 1);
      const maxTx = Math.min(this.cols - 1, Math.ceil(s.maxX / this.cell) + 1);
      const minTy = Math.max(0, Math.floor(s.minY / this.cell) - 1);
      const maxTy = Math.min(this.rows - 1, Math.ceil(s.maxY / this.cell) + 1);
      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const cx = (tx + 0.5) * this.cell;
          const cy = (ty + 0.5) * this.cell;
          if (this.segmentDistanceSq(cx, cy, s) <= markRadius * markRadius) {
            this.segmentCells.add(ty * this.cols + tx);
          }
        }
      }
    }
    return this.segments.length;
  }

  segmentDistanceSq(x, y, s) {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / (dx * dx + dy * dy || 1)));
    const px = s.ax + t * dx;
    const py = s.ay + t * dy;
    const ex = x - px;
    const ey = y - py;
    return ex * ex + ey * ey;
  }

  segmentNear(x, y, radius = 0) {
    const r2 = radius * radius;
    for (const s of this.segments) {
      if (x < s.minX - radius || x > s.maxX + radius || y < s.minY - radius || y > s.maxY + radius) continue;
      if (this.segmentDistanceSq(x, y, s) <= r2) return true;
    }
    return false;
  }

  static fromRows(rows, cell = 1) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const grid = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x] ?? "#";
        grid[y * w + x] = ch === "#" ? T.WALL : T.FLOOR;
      }
    }
    return new World(w, h, cell, grid);
  }

  static fromMask(mask) {
    const { cols, rows, cell } = mask;
    const grid = new Uint8Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
      grid[i] = mask.data[i] === "1" ? T.FLOOR : T.WALL;
    }
    return new World(cols, rows, cell, grid);
  }

  tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return T.WALL;
    return this.grid[ty * this.cols + tx];
  }

  isWall(tx, ty) {
    return this.tileAt(tx, ty) === T.WALL;
  }

  isWallAt(x, y) {
    return this.isWall(Math.floor(x / this.cell), Math.floor(y / this.cell));
  }

  isNavWall(tx, ty) {
    if (this.isWall(tx, ty)) return true;
    return this.segmentCells.has(ty * this.cols + tx);
  }

  gridCircleHitsWall(x, y, r) {
    const c = this.cell;
    const minx = Math.floor((x - r) / c);
    const maxx = Math.floor((x + r) / c);
    const miny = Math.floor((y - r) / c);
    const maxy = Math.floor((y + r) / c);
    for (let ty = miny; ty <= maxy; ty++) {
      for (let tx = minx; tx <= maxx; tx++) {
        if (!this.isWall(tx, ty)) continue;
        const rx = tx * c, ry = ty * c;
        const cx = Math.max(rx, Math.min(x, rx + c));
        const cy = Math.max(ry, Math.min(y, ry + c));
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  circleHitsWall(x, y, r) {
    return this.gridCircleHitsWall(x, y, r) || this.segmentNear(x, y, r);
  }

  lineClear(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.4)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      if (this.isWallAt(px, py) || this.segmentNear(px, py, this.cell * 0.15)) return false;
    }
    return true;
  }

  rayDistance(x, y, angle, maxDist) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const step = this.cell * 0.5;
    let d = 0;
    while (d < maxDist) {
      if (this.isWallAt(x + dx * d, y + dy * d) || this.segmentNear(x + dx * d, y + dy * d, this.cell * 0.2)) return d;
      d += step;
    }
    return maxDist;
  }

  nearestOpen(x, y, radius = 0) {
    let tx = Math.floor(x / this.cell);
    let ty = Math.floor(y / this.cell);
    const fits = (cx, cy) => {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
      if (!radius) return !this.isWall(cx, cy);
      return !this.circleHitsWall((cx + 0.5) * this.cell, (cy + 0.5) * this.cell, radius);
    };
    if (fits(tx, ty)) return { tx, ty };
    for (let r = 1; r < Math.max(this.cols, this.rows); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (fits(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return { tx, ty };
  }

  // Nudge a drawn point out of a wall by up to two radii without jumping
  // across a wall. The renderer keeps the authored line; the mover uses a
  // clear point so a line drawn a few pixels too close cannot wedge the mouse.
  clearPoint(x, y, radius) {
    if (!this.circleHitsWall(x, y, radius)) return { x, y };
    const step = Math.max(1, radius * 0.35);
    for (let d = step; d <= radius * 2.5; d += step) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const px = x + Math.cos(a) * d;
        const py = y + Math.sin(a) * d;
        if (this.circleHitsWall(px, py, radius)) continue;
        if (!this.lineClear(x, y, px, py)) continue;
        return { x: px, y: py };
      }
    }
    return this.closestOpen(x, y, radius);
  }

  nearestNavOpen(x, y) {
    let tx = Math.floor(x / this.cell);
    let ty = Math.floor(y / this.cell);
    const fits = (cx, cy) => cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows && !this.isNavWall(cx, cy);
    if (fits(tx, ty)) return { tx, ty };
    for (let r = 1; r < Math.max(this.cols, this.rows); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (fits(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return { tx, ty };
  }

  closestOpen(x, y, radius = 0) {
    const { tx, ty } = this.nearestOpen(x, y, radius);
    return { x: (tx + 0.5) * this.cell, y: (ty + 0.5) * this.cell };
  }

  // BFS over open cells; points are returned in world units (cell centres).
  bfs(sTx, sTy, tTx, tTy) {
    if (sTx === tTx && sTy === tTy) return [];
    const n = this.cols * this.rows;
    const prev = new Int32Array(n).fill(-1);
    const seen = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    const s = sTy * this.cols + sTx;
    const t = tTy * this.cols + tTx;
    q[tail++] = s;
    seen[s] = 1;
    const dirs = [1, -1, this.cols, -this.cols];
    while (head < tail) {
      const cur = q[head++];
      if (cur === t) break;
      const cx = cur % this.cols;
      const cy = (cur / this.cols) | 0;
      for (let i = 0; i < 4; i++) {
        const nb = cur + dirs[i];
        if (nb < 0 || nb >= n) continue;
        const nx = nb % this.cols;
        const ny = (nb / this.cols) | 0;
        if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
        if (seen[nb] || this.isNavWall(nx, ny)) continue;
        seen[nb] = 1;
        prev[nb] = cur;
        q[tail++] = nb;
      }
    }
    if (!seen[t]) return null;
    const c = this.cell;
    const pts = [];
    let cur = t;
    while (cur !== s && cur !== -1) {
      pts.push({ x: (cur % this.cols + 0.5) * c, y: (((cur / this.cols) | 0) + 0.5) * c });
      cur = prev[cur];
    }
    pts.reverse();
    return pts;
  }

  bfsToWorld(sx, sy, tx, ty) {
    const f = this.nearestNavOpen(sx, sy);
    const to = this.nearestNavOpen(tx, ty);
    return this.bfs(f.tx, f.ty, to.tx, to.ty);
  }
}


