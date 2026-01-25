#!/bin/bash

# Aero Backend - Local Development Setup

set -e

echo "Setting up Aero Backend for local development..."

cd "$(dirname "$0")"

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env file"
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Generate Prisma Client
echo "Generating Prisma Client..."
npm run build

# Run migrations
echo "Running database migrations..."
npm run db:push

# Seed database
echo "Seeding database..."
npm run db:seed

echo ""
echo "✓ Backend setup complete!"
echo ""
echo "Start the development server:"
echo "  npm run dev"
echo ""
echo "View database:"
echo "  npm run db:studio"
echo ""
