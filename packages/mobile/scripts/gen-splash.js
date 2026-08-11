// Generates packages/mobile/assets/splash-icon.png — the Fleet brand mark used by the native
// splash screen. Mirrors the in-app <Logo /> mark: a blue (Carbon blue60 #0f62fe) rounded square
// with a white route arrow. White background so it matches the boot screen (ui01 = #ffffff).
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const SIZE = 1024;
const WHITE = [255, 255, 255, 255];
const BLUE = [15, 98, 254, 255]; // #0f62fe
const ON = [255, 255, 255, 255];

const png = new PNG({ width: SIZE, height: SIZE });
// fill white
for (let i = 0; i < SIZE * SIZE; i++) {
  const idx = i * 4;
  png.data[idx] = WHITE[0];
  png.data[idx + 1] = WHITE[1];
  png.data[idx + 2] = WHITE[2];
  png.data[idx + 3] = WHITE[3];
}

function setPx(x, y, c) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const idx = (SIZE * y + x) * 4;
  png.data[idx] = c[0];
  png.data[idx + 1] = c[1];
  png.data[idx + 2] = c[2];
  png.data[idx + 3] = c[3];
}

function fillRoundedRect(x0, y0, x1, y1, r, c) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const inX = x >= x0 + r || x <= x1 - r || (y >= y0 + r && y <= y1 - r);
      const inY = y >= y0 + r || y <= y1 - r || (x >= x0 + r && x <= x1 - r);
      // inside rectangle minus the four corner circles
      const corner =
        (x < x0 + r && y < y0 + r && Math.hypot(x - (x0 + r), y - (y0 + r)) > r) ||
        (x > x1 - r && y < y0 + r && Math.hypot(x - (x1 - r), y - (y0 + r)) > r) ||
        (x < x0 + r && y > y1 - r && Math.hypot(x - (x0 + r), y - (y1 - r)) > r) ||
        (x > x1 - r && y > y1 - r && Math.hypot(x - (x1 - r), y - (y1 - r)) > r);
      if (inX || inY) {
        if (!corner) setPx(x, y, c);
      }
    }
  }
}

function thickLine(x0, y0, x1, y1, w, c) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // normal
  const half = w / 2;
  for (let t = 0; t <= len; t += 0.5) {
    const cx = x0 + (dx * t) / len;
    const cy = y0 + (dy * t) / len;
    for (let s = -half; s <= half; s += 0.5) {
      setPx(Math.round(cx + nx * s), Math.round(cy + ny * s), c);
    }
  }
}

// --- Brand mark: centered blue rounded square ---
const m = 360; // mark size
const mx0 = Math.round((SIZE - m) / 2);
const my0 = Math.round((SIZE - m) / 2);
const mx1 = mx0 + m;
const my1 = my0 + m;
const radius = Math.round(m * 0.13);
fillRoundedRect(mx0, my0, mx1, my1, radius, BLUE);

// --- White route arrow (L rotated 45° → points up-right / northeast) ---
const w = Math.round(m * 0.09);
const pad = Math.round(m * 0.26);
// shaft: from lower-left to upper-right
thickLine(mx0 + pad, my1 - pad, mx1 - pad, my0 + pad, w, ON);
// arrowhead chevron at upper-right end
const ex = mx1 - pad, ey = my0 + pad;
const a = Math.round(m * 0.12);
thickLine(ex, ey, ex - a, ey + a, w, ON); // down-left
thickLine(ex, ey, ex - a, ey - a, w, ON); // up-left

const outPath = path.join(__dirname, "..", "assets", "splash-icon.png");
fs.writeFileSync(outPath, PNG.sync.write(png));
console.log("wrote", outPath, SIZE + "x" + SIZE);
