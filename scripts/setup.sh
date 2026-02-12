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
  sleep 5
else
  echo "WARNING: Docker not found. Please ensure PostgreSQL and Redis are running manually."
  echo "  PostgreSQL: localhost:5432 (user: fediplus, password: fediplus, db: fediplus)"
  echo "  Redis: localhost:6379"
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
