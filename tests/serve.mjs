// Development/test server only. GitHub Pages serves the static files directly.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const prefix = "/github-learn-link-generator/";
const files = new Set(["index.html", "app.mjs", "core.mjs", "storage.mjs", "styles.css", "favicon.svg", "vendor/qrcode.mjs", "vendor/LICENSE", "dependencies.json"]);
const types = { html: "text/html", mjs: "text/javascript", css: "text/css", svg: "image/svg+xml", json: "application/json" };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const file = path.startsWith(prefix) ? path.slice(prefix.length) || "index.html" : "";
  if (request.method !== "GET" || !files.has(file)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const data = await readFile(new URL(`../${file}`, import.meta.url));
    response.writeHead(200, { "Content-Type": `${types[file.split(".").at(-1)] || "text/plain"}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(data);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end("Cannot read static asset");
  }
});
server.listen(48317, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:48317${prefix}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
