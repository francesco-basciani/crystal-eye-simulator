#!/usr/bin/env node
/** Development-only static server with CORS and byte-range support. */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "scientific-assets/rito-updated-20260907");
const port = Number(process.argv[3] ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid port.");

const contentType = (path) => extname(path) === ".json"
  ? "application/json; charset=utf-8"
  : "application/octet-stream";

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const path = resolve(root, `.${pathname}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  let size;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("not-file");
    size = stat.size;
  } catch {
    response.writeHead(404).end();
    return;
  }
  const commonHeaders = {
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes",
    "content-type": contentType(path),
  };
  const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
  if (match) {
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), size - 1);
    if (start > end || start >= size) {
      response.writeHead(416, { ...commonHeaders, "content-range": `bytes */${size}` }).end();
      return;
    }
    response.writeHead(206, {
      ...commonHeaders,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": end - start + 1,
    });
    createReadStream(path, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...commonHeaders, "content-length": size });
  createReadStream(path).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Scientific assets: http://127.0.0.1:${port}/ from ${root}`);
});
