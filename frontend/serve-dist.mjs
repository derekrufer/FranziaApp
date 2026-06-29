import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const port = Number(process.env.PORT ?? 5173);
const root = resolve("dist");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

process.on("uncaughtException", (error) => {
  console.error(error);
});

process.on("unhandledRejection", (error) => {
  console.error(error);
});

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const requestedPath = resolve(root, cleanPath);
  const filePath = requestedPath.startsWith(root) && existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(filePath)] ?? "application/octet-stream");
  createReadStream(filePath)
    .on("error", () => {
      response.statusCode = 404;
      response.end("Not found");
    })
    .pipe(response);
});

server.on("error", (error) => {
  console.error(error);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Frontend listening on http://localhost:${port}`);
});
