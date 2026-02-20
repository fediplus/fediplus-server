/**
 * Local patch of @fedify/fastify that fixes two Node.js compatibility issues:
 *
 * 1. Adds `duplex: "half"` to the Request constructor (required in Node 20+).
 * 2. Avoids Readable.toWeb() which crashes on Node 25 with NaN chunk size.
 *    Instead, creates a ReadableStream manually from the raw request.
 *
 * Remove this file once @fedify/fastify ships these fixes.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Federation } from "@fedify/fedify";
import fp from "fastify-plugin";

interface FedifyPluginOptions {
  federation: Federation<unknown>;
  contextDataFactory?: (request: FastifyRequest) => unknown | Promise<unknown>;
  errorHandlers?: Record<string, (...args: unknown[]) => Response>;
}

const dummyNotFoundResponse = new Response("", { status: 404 });
const defaultNotAcceptableResponse = new Response("Not Acceptable", {
  status: 406,
  headers: { "Content-Type": "text/plain", Vary: "Accept" },
});

function toWebRequest(fastifyReq: FastifyRequest): Request {
  const protocol = fastifyReq.protocol;
  const host = fastifyReq.headers.host ?? fastifyReq.hostname;
  const url = `${protocol}://${host}${fastifyReq.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(fastifyReq.raw.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const hasBody =
    fastifyReq.method !== "GET" && fastifyReq.method !== "HEAD";

  // Only attach the body for ActivityPub inbox routes. Reading the raw
  // stream here would consume it before Fastify's body parser runs,
  // breaking all non-AP POST routes (e.g. /auth/register).
  // Fedify only needs URL + headers to decide if a route is AP or not;
  // the body is only needed when actually processing an inbox delivery.
  const isInboxRoute = /\/inbox\b/.test(fastifyReq.url);

  let body: BodyInit | undefined;
  if (hasBody && isInboxRoute) {
    if (fastifyReq.body !== undefined) {
      body =
        typeof fastifyReq.body === "string"
          ? fastifyReq.body
          : JSON.stringify(fastifyReq.body);
    } else {
      // Manual ReadableStream instead of Readable.toWeb() which crashes
      // on Node.js v25 with "The argument 'size' is invalid. Received NaN"
      const raw = fastifyReq.raw;
      body = new ReadableStream({
        start(controller) {
          raw.on("data", (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          raw.on("end", () => controller.close());
          raw.on("error", (err: Error) => controller.error(err));
        },
      });
    }
  }

  return new Request(url, {
    method: fastifyReq.method,
    headers,
    body,
    ...(body !== undefined ? { duplex: "half" } : {}),
  } as RequestInit);
}

const fedifyPluginCore = (
  fastify: FastifyInstance,
  options: FedifyPluginOptions,
) => {
  const {
    federation,
    contextDataFactory = () => undefined,
    errorHandlers,
  } = options;

  fastify.addHook("onRequest", async (request, reply) => {
    const webRequest = toWebRequest(request);
    const contextData = await contextDataFactory(request);
    const response = await (federation as any).fetch(webRequest, {
      contextData,
      onNotAcceptable: () => defaultNotAcceptableResponse,
      onNotFound: () => dummyNotFoundResponse,
      ...errorHandlers,
    });
    if (response === dummyNotFoundResponse) return;
    await reply.send(response);
  });

  return Promise.resolve();
};

const fedifyPlugin = fp(fedifyPluginCore, {
  name: "fedify-plugin",
  fastify: "5.x",
});

export default fedifyPlugin;
export { fedifyPlugin };
