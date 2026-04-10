import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { parse } from "node:url";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOST ?? "localhost";

const tlsCert = process.env.TLS_CERT;
const tlsKey = process.env.TLS_KEY;
const tlsCa = process.env.TLS_CA;
const tlsEnabled = !!(tlsCert && tlsKey);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

let server;
if (tlsEnabled) {
  const httpsOptions = {
    key: readFileSync(tlsKey),
    cert: readFileSync(tlsCert),
  };
  if (tlsCa) httpsOptions.ca = readFileSync(tlsCa);

  server = createHttpsServer(httpsOptions, async (req, res) => {
    const parsedUrl = parse(req.url, true);
    await handle(req, res, parsedUrl);
  });
} else {
  server = createHttpServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    await handle(req, res, parsedUrl);
  });
}

server.listen(port, hostname, () => {
  const protocol = tlsEnabled ? "https" : "http";
  console.log(`Fedi+ frontend running at ${protocol}://${hostname}:${port}`);
});
