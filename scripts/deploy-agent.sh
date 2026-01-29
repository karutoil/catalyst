#!/bin/bash

# Catalyst Agent Deployment Script
# Installs and configures the Catalyst Agent on a fresh node

set -e

BACKEND_URL="${1:-http://localhost:3000}"
NODE_ID="${2:-node-$(hostname)}"
NODE_SECRET="${3:-}"

if [ -z "$NODE_SECRET" ]; then
    echo "Error: NODE_SECRET required"
    echo "Usage: $0 <backend_url> <node_id> <node_secret>"
    exit 1
fi

echo "=== Catalyst Agent Installation ==="
echo "Backend: $BACKEND_URL"
echo "Node ID: $NODE_ID"

# Update system
echo "Updating system packages..."
detect_pkg_manager() {
    if command -v apt-get >/dev/null 2>&1; then echo "apt"; return; fi
    if command -v apk >/dev/null 2>&1; then echo "apk"; return; fi
    if command -v dnf >/dev/null 2>&1; then echo "dnf"; return; fi
    if command -v yum >/dev/null 2>&1; then echo "yum"; return; fi
    if command -v pacman >/dev/null 2>&1; then echo "pacman"; return; fi
    if command -v zypper >/dev/null 2>&1; then echo "zypper"; return; fi
    echo ""
}

install_packages() {
    local pm="$1"
    case "$pm" in
        apt)
            apt-get update
            apt-get upgrade -y
            apt-get install -y \
                curl \
                wget \
                unzip \
                build-essential \
                pkg-config \
                libssl-dev \
                containerd.io \
                nerdctl
            ;;
        apk)
            apk add --no-cache \
                curl \
                wget \
                unzip \
                build-base \
                pkgconfig \
                openssl-dev \
                containerd \
                nerdctl
            ;;
        yum)
            yum install -y \
                curl \
                wget \
                unzip \
                gcc \
                gcc-c++ \
                make \
                pkgconfig \
                openssl-devel \
                containerd \
                nerdctl
            ;;
        dnf)
            dnf install -y \
                curl \
                wget \
                unzip \
                gcc \
                gcc-c++ \
                make \
                pkgconfig \
                openssl-devel \
                containerd \
                nerdctl
            ;;
        pacman)
            pacman -Sy --noconfirm \
                curl \
                wget \
                unzip \
                base-devel \
                pkgconf \
                openssl \
                containerd \
                nerdctl
            ;;
        zypper)
            zypper --non-interactive install \
                curl \
                wget \
                unzip \
                gcc \
                gcc-c++ \
                make \
                pkg-config \
                libopenssl-devel \
                containerd \
                nerdctl
            ;;
        *)
            echo "Unsupported package manager. Install curl, wget, unzip, build tools, pkg-config, OpenSSL dev headers, containerd, nerdctl."
            exit 1
            ;;
    esac
}

PKG_MANAGER="$(detect_pkg_manager)"
if [ -z "$PKG_MANAGER" ]; then
    echo "No supported package manager found."
    exit 1
fi
install_packages "$PKG_MANAGER"

# Install dependencies
echo "Dependencies installed via $PKG_MANAGER."

# Create agent directory
echo "Creating agent directory..."
mkdir -p /opt/catalyst-agent
mkdir -p /var/lib/catalyst

# Download agent binary
echo "Downloading Catalyst Agent..."
if curl -fsSL "${BACKEND_URL}/api/agent/download" -o /opt/catalyst-agent/catalyst-agent; then
    chmod +x /opt/catalyst-agent/catalyst-agent
elif [ -f "$(pwd)/target/release/catalyst-agent" ]; then
    cp "$(pwd)/target/release/catalyst-agent" /opt/catalyst-agent/
    chmod +x /opt/catalyst-agent/catalyst-agent
else
    echo "Agent binary not found. Build the agent or ensure backend hosts /api/agent/download."
    exit 1
fi

# Create configuration
echo "Creating configuration..."
cat > /opt/catalyst-agent/config.toml << EOF
[server]
backend_url = "${BACKEND_URL}"
node_id = "${NODE_ID}"
secret = "${NODE_SECRET}"
hostname = "$(hostname -f)"
data_dir = "/var/lib/catalyst"
max_connections = 100

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"

[logging]
level = "info"
format = "json"
EOF

chmod 600 /opt/catalyst-agent/config.toml

# Create systemd service
echo "Installing systemd service..."
cat > /etc/systemd/system/catalyst-agent.service << EOF
[Unit]
Description=Catalyst Agent - Game Server Management
After=network.target containerd.service
Wants=network-online.target
Requires=containerd.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/catalyst-agent
ExecStart=/opt/catalyst-agent/catalyst-agent
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=yes

# Resource limits (optional)
MemoryLimit=512M
TasksMax=1000

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
systemctl daemon-reload
systemctl enable catalyst-agent

# Configure containerd namespace
echo "Configuring containerd..."
mkdir -p /etc/containerd
cat >> /etc/containerd/config.toml << EOF

[plugins."io.containerd.grpc.v1.cri".containerd]
  default_runtime_name = "runc"
  
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes."runc"]
  runtime_engine = ""
  runtime_root = ""
  runtime_type = "io.containerd.runc.v2"

  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes."runc".options]
    SystemdCgroup = true
EOF

systemctl restart containerd

# Start catalyst-agent
echo "Starting Catalyst Agent..."
systemctl start catalyst-agent

# Verify
sleep 2
if systemctl is-active --quiet catalyst-agent; then
    echo "✓ Catalyst Agent installed and running"
    systemctl status catalyst-agent
else
    echo "✗ Catalyst Agent failed to start"
    journalctl -u catalyst-agent -n 20
    exit 1
fi

echo ""
echo "Installation complete!"
echo "View logs: journalctl -u catalyst-agent -f"
