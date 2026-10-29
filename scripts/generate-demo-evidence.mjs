/**
 * Genera los ocho PNG de demostración de `public/demo-evidence/`.
 *
 * Las evidencias del seed deben apuntar a archivos que existan: la auditoría
 * encontró ocho tarjetas con "Imagen no disponible" porque las URLs eran
 * `https://pulso.ejemplo/...`. Estos assets son placeholders deterministas
 * (sin dependencias) y se pueden regenerar con `node scripts/generate-demo-evidence.mjs`.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1200;
const HEIGHT = 675;

const THEMES = [
  [22, 101, 52],   // verde cocina
  [146, 64, 14],   // ámbar almacén
  [30, 64, 175],   // azul cámara fría
  [153, 27, 27],   // rojo incidencia
  [15, 118, 110],  // teal limpieza
  [91, 33, 182],   // violeta auditoría
  [194, 65, 12],   // naranja recepción
  [51, 65, 85],    // pizarra general
];

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Cada scanline lleva su byte de filtro (0 = None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function render(theme) {
  const [r, g, b] = theme;
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const t = y / HEIGHT;
      const band = Math.floor(x / 150) % 2 === 0 ? 1.04 : 0.96;
      const noise = ((x * 131 + y * 197) % 11) - 5;
      const i = (y * WIDTH + x) * 4;
      rgba[i] = Math.max(0, Math.min(255, Math.round((r + 34 * (0.25 - t)) * band + noise)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round((g + 30 * (0.25 - t)) * band + noise)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round((b + 26 * (0.25 - t)) * band + noise)));
      rgba[i + 3] = 255;
    }
  }

  // Tarjeta central clara para que la miniatura no sea un color plano.
  const left = 170;
  const top = 190;
  const right = WIDTH - 170;
  const bottom = HEIGHT - 190;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * WIDTH + x) * 4;
      const glow = 0.16 + 0.1 * (1 - y / HEIGHT);
      rgba[i] = Math.round(rgba[i] * (1 - glow) + 245 * glow);
      rgba[i + 1] = Math.round(rgba[i + 1] * (1 - glow) + 247 * glow);
      rgba[i + 2] = Math.round(rgba[i + 2] * (1 - glow) + 250 * glow);
    }
  }

  // Tres "renglones" de contenido simulado.
  for (const [row, width] of [[300, 420], [380, 620], [460, 520]]) {
    const y0 = row;
    const y1 = row + 22;
    for (let y = y0; y < y1; y++) {
      for (let x = 240; x < 240 + width; x++) {
        const i = (y * WIDTH + x) * 4;
        rgba[i] = Math.round(r * 0.55 + 90);
        rgba[i + 1] = Math.round(g * 0.55 + 90);
        rgba[i + 2] = Math.round(b * 0.55 + 90);
      }
    }
  }

  return png(WIDTH, HEIGHT, rgba);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo-evidence");
mkdirSync(outDir, { recursive: true });

THEMES.forEach((theme, index) => {
  const name = `evidencia-${String(index + 1).padStart(2, "0")}.png`;
  const file = join(outDir, name);
  writeFileSync(file, render(theme));
  console.log(`Generado ${name}`);
});
