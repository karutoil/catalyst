#!/bin/bash

# Catalyst Agent - Local Development Build

set -e

echo "Building Catalyst Agent for local development..."

cd "$(dirname "$0")"

# Check Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "Error: Rust is not installed"
    echo "Install from: https://rustup.rs/"
    exit 1
fi

# Build development version
echo "Building debug version..."
cargo build

# Build release version
echo "Building release version..."
cargo build --release

echo ""
echo "✓ Agent build complete!"
echo ""
echo "Debug binary: ./target/debug/catalyst-agent"
echo "Release binary: ./target/release/catalyst-agent"
echo ""
echo "To run locally:"
echo "  export NODE_ID=local-node"
echo "  export NODE_SECRET=dev-secret"
echo "  export NODE_API_KEY=catalyst_xxx"
echo "  export BACKEND_URL=ws://localhost:3000"
echo "  ./target/debug/catalyst-agent"
echo ""
