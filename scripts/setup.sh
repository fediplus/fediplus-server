#!/usr/bin/env bash
set -euo pipefail

echo "=== Fedi+ Development Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed. Please install Node.js 20+ first."
  echo "  https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d. -f1 | tr -d v)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ is required. Current version: $(node -v)"
  exit 1
fi
echo "Node.js $(node -v) detected"

# Check if Docker is available for services
if command -v docker &> /dev/null; then
  echo "Docker detected. Starting services..."
  docker compose up -d
  echo "Waiting for services to be healthy..."
  sleep 8

  # Create MinIO bucket using the mc client bundled in the minio image
  echo ""
  echo "Creating MinIO bucket..."
  # Use docker exec to run mc inside the minio container
  if docker compose exec -T minio mc alias set local http://localhost:9000 fediplus fediplus-secret --quiet 2>/dev/null; then
    docker compose exec -T minio mc mb --ignore-existing local/fediplus-media
    docker compose exec -T minio mc anonymous set download local/fediplus-media
    echo "MinIO bucket 'fediplus-media' ready."
  else
    echo "WARNING: Could not configure MinIO bucket automatically."
    echo "  Please create it manually:"
    echo "  1. Open http://localhost:9001 in your browser"
    echo "  2. Log in with user: fediplus  password: fediplus-secret"
    echo "  3. Go to Buckets → Create Bucket"
    echo "  4. Name it: fediplus-media"
    echo "  5. Set Access Policy to: public (or 'download')"
  fi
else
  echo "WARNING: Docker not found. Please ensure PostgreSQL, Redis, and MinIO are running manually."
  echo "  PostgreSQL: localhost:5432 (user: fediplus, password: fediplus, db: fediplus)"
  echo "  Redis: localhost:6379"
  echo "  MinIO: localhost:9000 (access key: fediplus, secret: fediplus-secret)"
  echo ""
  echo "  Once MinIO is running, create the bucket:"
  echo "  Option A — MinIO web console at http://localhost:9001"
  echo "    Log in → Buckets → Create Bucket → name: fediplus-media → Access Policy: public"
  echo "  Option B — mc CLI:"
  echo "    mc alias set local http://localhost:9000 fediplus fediplus-secret"
  echo "    mc mb local/fediplus-media"
  echo "    mc anonymous set download local/fediplus-media"
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Copy env file
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Build shared package first
echo ""
echo "Building shared package..."
npm run build -w packages/shared

# Generate DB migrations
echo ""
echo "Generating database migrations..."
npm run db:generate -w packages/backend

# Run migrations
echo "Running database migrations..."
npm run db:migrate -w packages/backend

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Start development servers:"
echo "  npm run dev"
echo ""
echo "Or start individually:"
echo "  npm run dev -w packages/backend    # API server on :3001"
echo "  npm run dev -w packages/frontend   # Next.js on :3000"
