#!/bin/bash

# Aero Agent - Local Development Build

set -e

echo "Building Aero Agent for local development..."

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
echo "Debug binary: ./target/debug/aero-agent"
echo "Release binary: ./target/release/aero-agent"
echo ""
echo "To run locally:"
echo "  export NODE_ID=local-node"
echo "  export NODE_SECRET=dev-secret"
echo "  export BACKEND_URL=ws://localhost:3000"
echo "  ./target/debug/aero-agent"
echo ""
