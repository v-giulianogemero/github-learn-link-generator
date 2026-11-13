import { MAX_URL_LENGTH } from "./core.mjs";
import { qrcode } from "./vendor/qrcode.mjs";
import { githubMarkPath, githubMarkLicense } from "./vendor/github-mark.mjs";

export function createQr(url) {
  if (typeof url !== "string" || !/^[\x20-\x7e]+$/.test(url) || url.length > MAX_URL_LENGTH) {
    throw new Error("QR generation requires a saved, encoded URL of at most 2,200 characters.");
  }
  // Version 40 byte capacities: H=1273, Q=1663, M=2331. Keep the existing URL limit.
  const correction = url.length <= 1273 ? "H" : url.length <= 1663 ? "Q" : "M";
  const qr = qrcode(0, correction);
  qr.addData(url, "Byte");
  qr.make();
  const modules = qr.getModuleCount();
  const border = 4;
  const size = modules + 2 * border;
  let data = "";
  let finders = "";
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.isDark(row, col)) continue;
      const square = `M${col + border} ${row + border}h1v1h-1z`;
      const finder = (row < 7 && (col < 7 || col >= modules - 7)) || (row >= modules - 7 && col < 7);
      if (finder) finders += square;
      else data += square;
    }
  }
  // Limit the cleared patch, especially for dense payloads using lower correction.
  const cap = correction === "H" ? 17 : correction === "Q" ? 13 : 11;
  const backing = Math.min(cap, Math.floor(modules * 0.16 / 2) * 2 + 1);
  const start = (size - backing) / 2;
  const markSize = backing - 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 5}" height="${size * 5}" viewBox="0 0 ${size} ${size}">
<metadata>${githubMarkLicense}</metadata>
<rect width="${size}" height="${size}" fill="#ffffff"/>
<g>
<path fill="#1a7f37" d="${data}"/>
<path fill="#14532d" d="${finders}"/>
<rect x="${start}" y="${start}" width="${backing}" height="${backing}" fill="#ffffff"/>
</g>
<path fill="#24292f" transform="translate(${start + 1} ${start + 1}) scale(${markSize / 16})" d="${githubMarkPath}"/>
</svg>`;
  return { svg, modules, correction };
}
