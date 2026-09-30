// pdf.js needs its CMaps and standard-font data at runtime to draw PDFs whose
// fonts are not embedded (for example Arabic/English government reports).
import { cpSync, mkdirSync } from "node:fs";

const source = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const target = new URL("../public/pdfjs/", import.meta.url);

for (const dir of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
  mkdirSync(new URL(`${dir}/`, target), { recursive: true });
  cpSync(new URL(`${dir}/`, source), new URL(`${dir}/`, target), {
    recursive: true,
  });
}
