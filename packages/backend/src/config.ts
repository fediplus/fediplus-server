export const config = {
  host: process.env.HOST ?? "localhost",
  port: parseInt(process.env.PORT ?? "3001", 10),
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3000",
  nodeEnv: process.env.NODE_ENV ?? "development",

  database: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://fediplus:fediplus@localhost:5432/fediplus",
  },

  redis: {
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? "change-me-in-production",
    expiry: process.env.JWT_EXPIRY ?? "7d",
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    accessKey: process.env.S3_ACCESS_KEY ?? "fediplus",
    secretKey: process.env.S3_SECRET_KEY ?? "fediplus-secret",
    bucket: process.env.S3_BUCKET ?? "fediplus-media",
    region: process.env.S3_REGION ?? "us-east-1",
  },

  get domain() {
    const url = new URL(this.publicUrl);
    return url.host;
  },

  get isProduction() {
    return this.nodeEnv === "production";
  },
} as const;
