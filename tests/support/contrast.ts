/**
 * Contraste WCAG de tokens OKLCH.
 *
 * Existe para que las decisiones de contraste queden fijadas por un test y no
 * por un comentario: si alguien aclara `--warning-text` "porque se ve mejor",
 * el spec falla con el número exacto en vez de esperar a que un usuario con
 * poca visión no pueda leer un monto.
 */

/** OKLCH → sRGB (0-1 por canal). */
export function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const rl = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gl = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const gamma = (u: number) =>
    u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(u, 0), 1 / 2.4) - 0.055;

  return [gamma(rl), gamma(gl), gamma(bl)];
}

/** Contraste WCAG entre dos colores OKLCH. */
export function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number]
): number {
  const lum = ([r, g, b]: [number, number, number]) => {
    const lin = (u: number) => {
      const c = Math.min(Math.max(u, 0), 1);
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const a = lum(fg);
  const b = lum(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Oklch {
  L: number;
  C: number;
  h: number;
}

/**
 * Lee un token `--nombre: oklch(L C h)` de `app/globals.css`.
 *
 * `scope` elige el bloque: `":root"` (claro) o `".dark"`. Se lee del archivo
 * real y no de una copia en el test, para que el test no pueda quedar
 * describiendo unos valores mientras la app usa otros.
 */
export function leerToken(css: string, nombre: string, scope: ":root" | ".dark"): Oklch {
  const inicio = css.indexOf(scope === ":root" ? ":root {" : ".dark {");
  if (inicio === -1) throw new Error(`No se encontró el bloque ${scope}`);
  const fin = css.indexOf("\n}", inicio);
  const bloque = css.slice(inicio, fin === -1 ? undefined : fin);

  const match = bloque.match(
    new RegExp(`--${nombre}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`)
  );
  if (!match) throw new Error(`No se encontró --${nombre} en ${scope}`);

  return { L: Number(match[1]), C: Number(match[2]), h: Number(match[3]) };
}

export const rgbDe = ({ L, C, h }: Oklch) => oklchToRgb(L, C, h);
export const BLANCO: [number, number, number] = [1, 1, 1];
