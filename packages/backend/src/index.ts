import Fastify from "fastify";
import cors from "@fastify/cors";
import fedifyPlugin from "@fedify/fastify";
import { config } from "./config.js";
import { setupFederation } from "./federation/setup.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRoutes } from "./routes/auth/index.js";
import { wellKnownRoutes } from "./routes/well-known/index.js";
import { userRoutes } from "./routes/api/v1/users.js";
import { circleRoutes } from "./routes/api/v1/circles.js";
import { postRoutes } from "./routes/api/v1/posts.js";
import { followRoutes } from "./routes/api/v1/follows.js";
import { notificationRoutes } from "./routes/api/v1/notifications.js";
import { streamRoutes } from "./routes/api/v1/stream.js";
import { communityRoutes } from "./routes/api/v1/communities.js";
import { collectionRoutes } from "./routes/api/v1/collections.js";
import { mediaRoutes } from "./routes/api/v1/media.js";

async function main() {
  const app = Fastify({
    logger: {
      level: config.isProduction ? "info" : "debug",
    },
  });

  // CORS
  await app.register(cors, {
    origin: config.isProduction ? config.publicUrl : true,
    credentials: true,
  });

  // Error handler
  app.setErrorHandler(errorHandler);

  // Federation (Fedify)
  const federation = setupFederation();
  await app.register(fedifyPlugin, { federation });

  // Routes
  await app.register(authRoutes);
  await app.register(wellKnownRoutes);
  await app.register(userRoutes);
  await app.register(circleRoutes);
  await app.register(postRoutes);
  await app.register(followRoutes);
  await app.register(notificationRoutes);
  await app.register(streamRoutes);
  await app.register(communityRoutes);
  await app.register(collectionRoutes);
  await app.register(mediaRoutes);

  // Health check
  app.get("/health", async () => ({ status: "ok", version: "0.1.0" }));

  // Start
  await app.listen({ host: config.host, port: config.port });
  console.log(`Fedi+ backend running at http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
