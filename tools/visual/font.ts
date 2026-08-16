/**
 * A 5x7 bitmap font.
 *
 * Comparison sheets have to say which panel is BEFORE and which is CURRENT, or
 * they are useless to a reviewer. Rasterizing text in Node otherwise means a
 * native canvas or font dependency; a fixed bitmap font keeps the pipeline
 * dependency-light and makes label pixels perfectly deterministic across
 * machines, which matters because these images get diffed.
 */

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Blank columns between glyphs, in font pixels. */
export const GLYPH_SPACING = 1;

const GLYPHS: Record<string, string> = {
  " ": "00000 00000 00000 00000 00000 00000 00000",
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "11111 00100 00100 00100 00100 00100 11111",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 11011 10001",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  _: "00000 00000 00000 00000 00000 00000 11111",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  ",": "00000 00000 00000 00000 01100 00100 01000",
  ":": "00000 01100 01100 00000 01100 01100 00000",
  ";": "00000 01100 01100 00000 01100 00100 01000",
  "/": "00001 00010 00010 00100 01000 01000 10000",
  "\\": "10000 01000 01000 00100 00010 00010 00001",
  "|": "00100 00100 00100 00100 00100 00100 00100",
  "(": "00010 00100 01000 01000 01000 00100 00010",
  ")": "01000 00100 00010 00010 00010 00100 01000",
  "[": "01110 01000 01000 01000 01000 01000 01110",
  "]": "01110 00010 00010 00010 00010 00010 01110",
  "%": "11001 11010 00010 00100 01000 01011 10011",
  "#": "01010 01010 11111 01010 11111 01010 01010",
  "+": "00000 00100 00100 11111 00100 00100 00000",
  "=": "00000 00000 11111 00000 11111 00000 00000",
  ">": "01000 00100 00010 00001 00010 00100 01000",
  "<": "00010 00100 01000 10000 01000 00100 00010",
  "?": "01110 10001 00001 00010 00100 00000 00100",
  "!": "00100 00100 00100 00100 00100 00000 00100",
  "*": "00000 10101 01110 11111 01110 10101 00000",
  "'": "00100 00100 00000 00000 00000 00000 00000",
  '"': "01010 01010 00000 00000 00000 00000 00000",
};

/** Characters with no glyph of their own but an obvious stand-in. */
const ALIASES: Record<string, string> = {
  "×": "X",
  "·": ".",
  "–": "-",
  "—": "-",
  "→": ">",
  "←": "<",
};

const ROWS_CACHE = new Map<string, number[]>();

function glyphRows(char: string): number[] {
  const cached = ROWS_CACHE.get(char);
  if (cached) return cached;
  const key = ALIASES[char] ?? char.toUpperCase();
  const definition = GLYPHS[key] ?? GLYPHS["?"];
  const rows = definition.split(" ").map((row) => Number.parseInt(row, 2));
  ROWS_CACHE.set(char, rows);
  return rows;
}

/** Width in device pixels of `text` at the given integer scale. */
export function measureText(text: string, scale = 2): number {
  if (text.length === 0) return 0;
  return (text.length * (GLYPH_WIDTH + GLYPH_SPACING) - GLYPH_SPACING) * scale;
}

export function textHeight(scale = 2): number {
  return GLYPH_HEIGHT * scale;
}

/**
 * Walk the lit pixels of `text`, reporting each as a device-pixel rectangle.
 * The caller owns the pixel buffer, so the font never has to know about PNGs.
 */
export function eachTextPixel(
  text: string,
  originX: number,
  originY: number,
  scale: number,
  visit: (x: number, y: number, size: number) => void,
): void {
  let cursor = originX;
  for (const char of text) {
    const rows = glyphRows(char);
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      const bits = rows[row] ?? 0;
      for (let column = 0; column < GLYPH_WIDTH; column++) {
        const lit = (bits >> (GLYPH_WIDTH - 1 - column)) & 1;
        if (lit) visit(cursor + column * scale, originY + row * scale, scale);
      }
    }
    cursor += (GLYPH_WIDTH + GLYPH_SPACING) * scale;
  }
}
