#!/bin/bash

# Aero - Complete System Setup Script
# Run this once on a fresh Ubuntu/Debian server

set -e

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     Aero - Game Server Management System Setup          ║"
echo "║         https://github.com/aero/aero                    ║"
echo "╚═══════════════════════════════════════════════════════════╝"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "✗ This script must be run as root (use sudo)"
    exit 1
fi

# Detect OS
if [ ! -f /etc/os-release ]; then
    echo "✗ Unable to detect OS"
    exit 1
fi

. /etc/os-release

if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    echo "✗ This script only supports Ubuntu and Debian"
    exit 1
fi

echo ""
echo "📦 Installing system dependencies..."
apt-get update
apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    wget \
    gnupg \
    lsb-release \
    unzip \
    build-essential \
    pkg-config \
    libssl-dev \
    docker.io \
    docker-compose

# Add user to docker group
usermod -aG docker $SUDO_USER || true

# Install containerd
echo "📦 Installing containerd..."
echo "deb [signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/${ID} $(lsb_release -cs) stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

apt-get update
apt-get install -y containerd.io

# Configure containerd
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml > /dev/null
systemctl restart containerd

# Install nerdctl
echo "📦 Installing nerdctl..."
NERDCTL_VERSION="1.7.0"
wget -q https://github.com/containerd/nerdctl/releases/download/v${NERDCTL_VERSION}/nerdctl-${NERDCTL_VERSION}-linux-amd64.tar.gz \
    -O /tmp/nerdctl.tar.gz
tar xzf /tmp/nerdctl.tar.gz -C /usr/local/bin/
rm /tmp/nerdctl.tar.gz

# Create aero user
echo "👤 Creating aero system user..."
useradd -r -s /bin/false aero || true

# Create directories
echo "📁 Creating directories..."
mkdir -p /opt/aero-agent
mkdir -p /var/lib/aero
mkdir -p /var/log/aero
chown -R aero:aero /var/lib/aero
chown -R aero:aero /var/log/aero

# Install Rust (optional, for compiling agent)
if ! command -v cargo &> /dev/null; then
    echo "📦 Installing Rust toolchain..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

# Install Node.js (for backend)
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo ""
echo "✓ System setup complete!"
echo ""
echo "Next steps:"
echo "1. Create a node in the Aero backend"
echo "2. Generate deployment token"
echo "3. Run: /opt/aero-agent/deploy-agent.sh <backend_url> <node_id> <secret>"
echo ""
