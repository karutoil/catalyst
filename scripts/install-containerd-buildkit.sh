#!/bin/bash
# Install containerd, nerdctl, buildkit (buildctl + buildkitd) for multiple package managers
# Usage: sudo ./install-containerd-buildkit.sh

set -euo pipefail

detect_pkg_manager() {
    if command -v apt-get >/dev/null 2>&1; then echo "apt"; return; fi
    if command -v apk >/dev/null 2>&1; then echo "apk"; return; fi
    if command -v dnf >/dev/null 2>&1; then echo "dnf"; return; fi
    if command -v yum >/dev/null 2>&1; then echo "yum"; return; fi
    if command -v pacman >/dev/null 2>&1; then echo "pacman"; return; fi
    if command -v zypper >/dev/null 2>&1; then echo "zypper"; return; fi
    echo "";
}

PKG_MANAGER=$(detect_pkg_manager)
if [ -z "$PKG_MANAGER" ]; then
    echo "Unsupported system. Please install containerd, nerdctl, buildkit manually." >&2
    exit 1
fi

echo "Detected package manager: $PKG_MANAGER"

install_packages() {
    case "$PKG_MANAGER" in
        apt)
            apt-get update -qq
            apt-get install -y -qq ca-certificates curl wget tar gnupg2 software-properties-common \
                containerd buildkit || true
            # Try to install nerdctl package if available
            apt-get install -y -qq nerdctl || true
            ;;
        apk)
            apk add --no-cache ca-certificates curl wget tar containerd buildkit || true
            apk add --no-cache nerdctl || true
            ;;
        dnf|yum)
            $PKG_MANAGER install -y ca-certificates curl wget tar containerd buildkit || true
            $PKG_MANAGER install -y nerdctl || true
            ;;
        pacman)
            pacman -Sy --noconfirm ca-certificates curl wget tar containerd buildkit || true
            pacman -Sy --noconfirm nerdctl || true
            ;;
        zypper)
            zypper --non-interactive install -y ca-certificates curl wget tar containerd buildkit || true
            zypper --non-interactive install -y nerdctl || true
            ;;
        *)
            echo "Unknown package manager: $PKG_MANAGER" >&2
            exit 1
            ;;
    esac
}

# Ensure basic packages
echo "Installing containerd and dependencies (may require distro packages)..."
install_packages

# Start containerd if available
if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet containerd; then
        echo "containerd already running"
    else
        echo "Starting containerd service..."
        systemctl daemon-reload || true
        systemctl enable --now containerd || true
    fi
fi

# Install nerdctl if missing
if ! command -v nerdctl >/dev/null 2>&1; then
    echo "nerdctl not found, installing from GitHub release..."
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64) ARCH=amd64 ;;
        aarch64) ARCH=arm64 ;;
        *) echo "Unrecognized CPU arch $ARCH, proceeding with amd64"; ARCH=amd64 ;;
    esac
    NERDCTL_VER="1.8.0"
    URL="https://github.com/containerd/nerdctl/releases/download/v${NERDCTL_VER}/nerdctl-${NERDCTL_VER}-linux-${ARCH}.tar.gz"
    echo "Downloading $URL"
    curl -fsSL "$URL" | tar -xz -C /usr/local/bin --strip-components=1
    chmod +x /usr/local/bin/nerdctl /usr/local/bin/nerdctl-ctr || true
fi

# Install buildctl/buildkitd if missing
if ! command -v buildctl >/dev/null 2>&1 || ! command -v buildkitd >/dev/null 2>&1; then
    echo "buildctl or buildkitd not found, installing from GitHub release..."
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64) ARCH=amd64 ;;
        aarch64) ARCH=arm64 ;;
        *) echo "Unrecognized CPU arch $ARCH, proceeding with amd64"; ARCH=amd64 ;;
    esac
    # Try to find the latest buildkit release asset for this architecture via GitHub API
    echo "Querying GitHub releases for buildkit..."
    RELEASES_JSON="$(curl -s "https://api.github.com/repos/moby/buildkit/releases")"
    ASSET_URL=$(echo "$RELEASES_JSON" | jq -r --arg pattern "linux-${ARCH}.tar.gz" '.[] | .assets[]? | select(.name | test($pattern)) | .browser_download_url' | head -n1)

    if [ -z "$ASSET_URL" ]; then
        echo "Could not find buildkit release asset for linux-${ARCH} via GitHub API." >&2
        echo "Please install buildctl/buildkitd manually from https://github.com/moby/buildkit/releases" >&2
        exit 1
    fi

    echo "Found asset: $ASSET_URL"
    tmpdir=$(mktemp -d)
    if curl -fsSL "$ASSET_URL" -o "$tmpdir/buildkit.tar.gz"; then
        if tar -xz -C "$tmpdir" -f "$tmpdir/buildkit.tar.gz"; then
            # Binary paths vary across releases (bin/ or buildkit/)
            if [ -f "$tmpdir/buildkit/buildctl" ] && [ -f "$tmpdir/buildkit/buildkitd" ]; then
                cp "$tmpdir/buildkit/buildctl" /usr/local/bin/
                cp "$tmpdir/buildkit/buildkitd" /usr/local/bin/
            elif [ -f "$tmpdir/bin/buildctl" ] && [ -f "$tmpdir/bin/buildkitd" ]; then
                cp "$tmpdir/bin/buildctl" /usr/local/bin/
                cp "$tmpdir/bin/buildkitd" /usr/local/bin/
            else
                echo "Downloaded archive did not contain buildctl/buildkitd" >&2
                rm -rf "$tmpdir"
                exit 1
            fi
            chmod +x /usr/local/bin/buildctl /usr/local/bin/buildkitd
            echo "Installed buildkit from $ASSET_URL"
            rm -rf "$tmpdir"
        else
            echo "Failed to extract buildkit archive" >&2
            rm -rf "$tmpdir"
            exit 1
        fi
    else
        echo "Failed to download buildkit archive" >&2
        rm -rf "$tmpdir"
        exit 1
    fi
fi

# Create systemd service for buildkitd if systemd exists
if command -v systemctl >/dev/null 2>&1; then
    if [ ! -f /etc/systemd/system/buildkit.service ]; then
        echo "Installing systemd service for buildkitd..."
        cat > /etc/systemd/system/buildkit.service << 'EOF'
[Unit]
Description=BuildKit
After=network.target

[Service]
ExecStart=/usr/local/bin/buildkitd --addr unix:///run/buildkit/buildkitd.sock
Restart=always
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
        mkdir -p /run/buildkit || true
        systemctl daemon-reload || true
        systemctl enable --now buildkit || true
    else
        echo "buildkit systemd service already installed"
    fi
else
    echo "No systemctl found. You can run buildkitd manually: sudo buildkitd --addr unix:///run/buildkit/buildkitd.sock &"
fi

# Validate installations
echo "Validating installations..."
nerdctl --version || true
buildctl --version || true
buildkitd --version || true

echo "Installation complete. If any of the commands above were missing, inspect the output and install manually."

exit 0
