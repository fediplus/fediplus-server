import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { createProxy } from "http-proxy";
import { readFileSync } from "node:fs";
import { parse } from "node:url";
import httpProxy from "http-proxy";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOST ?? "localhost";
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3001";

const tlsCert = process.env.TLS_CERT;
const tlsKey = process.env.TLS_KEY;
const tlsCa = process.env.TLS_CA;
const tlsEnabled = !!(tlsCert && tlsKey);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const proxy = httpProxy.createProxyServer({ target: backendUrl, ws: true });
proxy.on("error", (err, _req, res) => {
  console.error("Proxy error:", err.message);
  if (res.writeHead) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
  }
});

await app.prepare();

function requestHandler(req, res) {
  const parsedUrl = parse(req.url, true);
  handle(req, res, parsedUrl);
}

let server;
if (tlsEnabled) {
  const httpsOptions = {
    key: readFileSync(tlsKey),
    cert: readFileSync(tlsCert),
  };
  if (tlsCa) httpsOptions.ca = readFileSync(tlsCa);

  server = createHttpsServer(httpsOptions, requestHandler);
} else {
  server = createHttpServer(requestHandler);
}

// Proxy WebSocket upgrades for backend paths to Fastify
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/api/")) {
    proxy.ws(req, socket, head);
  }
});

server.listen(port, hostname, () => {
  const protocol = tlsEnabled ? "https" : "http";
  console.log(`Fedi+ frontend running at ${protocol}://${hostname}:${port}`);
});
