#!/bin/bash

# Catalyst Agent Cleanup Script
# Removes the Catalyst Agent, dependencies, and containerd config added by deploy-agent.sh

set -euo pipefail

echo "=== Catalyst Agent Cleanup ==="

detect_pkg_manager() {
    if command -v apt-get >/dev/null 2>&1; then echo "apt"; return; fi
    if command -v apk >/dev/null 2>&1; then echo "apk"; return; fi
    if command -v dnf >/dev/null 2>&1; then echo "dnf"; return; fi
    if command -v yum >/dev/null 2>&1; then echo "yum"; return; fi
    if command -v pacman >/dev/null 2>&1; then echo "pacman"; return; fi
    if command -v zypper >/dev/null 2>&1; then echo "zypper"; return; fi
    echo ""
}

is_installed() {
    local pm="$1"
    local pkg="$2"
    case "$pm" in
        apt) dpkg -s "$pkg" >/dev/null 2>&1 ;;
        apk) apk info -e "$pkg" >/dev/null 2>&1 ;;
        yum|dnf|zypper) rpm -q "$pkg" >/dev/null 2>&1 ;;
        pacman) pacman -Q "$pkg" >/dev/null 2>&1 ;;
        *) return 1 ;;
    esac
}

is_safe_to_remove() {
    local pm="$1"
    local pkg="$2"
    case "$pm" in
        apt)
            local dep
            while read -r dep; do
                [ "$dep" = "$pkg" ] && continue
                return 1
            done < <(apt-cache rdepends --installed "$pkg" 2>/dev/null | awk '
                /Reverse Depends:/ { flag = 1; next }
                flag && NF { print $1 }
            ')
            return 0
            ;;
        apk)
            if apk info -R "$pkg" 2>/dev/null | awk '
                /is required by:/ { flag = 1; next }
                flag && NF { print $1 }
            ' | grep -q .; then
                return 1
            fi
            return 0
            ;;
        yum|dnf|zypper)
            if rpm -q --whatrequires "$pkg" 2>/dev/null | grep -q -v 'no package requires'; then
                return 1
            fi
            return 0
            ;;
        pacman)
            local required_by
            required_by="$(pacman -Qi "$pkg" 2>/dev/null | awk -F: '/^Required By/ { gsub(/^[[:space:]]+/, "", $2); print $2 }')"
            if [ -n "$required_by" ] && [ "$required_by" != "None" ]; then
                return 1
            fi
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

echo "Stopping and removing systemd service..."
if command -v systemctl >/dev/null 2>&1; then
    systemctl stop catalyst-agent.service || true
    systemctl disable catalyst-agent.service || true
    systemctl reset-failed catalyst-agent.service >/dev/null 2>&1 || true
    rm -rf /etc/systemd/system/catalyst-agent.service.d
    rm -f /etc/systemd/system/catalyst-agent.service
    systemctl daemon-reload
    journalctl --rotate >/dev/null 2>&1 || true
    journalctl --vacuum-time=1s --unit=catalyst-agent >/dev/null 2>&1 || true
else
    echo "systemctl not found; skipping service removal."
fi

echo "Removing agent files..."
rm -rf /opt/catalyst-agent
rm -rf /var/lib/catalyst

CONFIG_PATH="/etc/containerd/config.toml"
if [ -f "$CONFIG_PATH" ]; then
    BACKUP_PATH="${CONFIG_PATH}.catalyst-agent.bak-$(date +%Y%m%d%H%M%S)"
    cp "$CONFIG_PATH" "$BACKUP_PATH"
    awk '
        BEGIN { skip = 0 }
        /^\[plugins\."io\.containerd\.grpc\.v1\.cri"\.containerd\]$/ { skip = 1; next }
        skip && /^[[:space:]]*SystemdCgroup = true[[:space:]]*$/ { skip = 0; next }
        skip { next }
        { print }
    ' "$BACKUP_PATH" > "${CONFIG_PATH}.tmp"
    if cmp -s "$BACKUP_PATH" "${CONFIG_PATH}.tmp"; then
        echo "No matching containerd config block found; leaving ${CONFIG_PATH} unchanged."
        rm -f "${CONFIG_PATH}.tmp"
    else
        mv "${CONFIG_PATH}.tmp" "$CONFIG_PATH"
        echo "Reverted containerd config block (backup: ${BACKUP_PATH})."
        if command -v systemctl >/dev/null 2>&1; then
            systemctl restart containerd || true
        fi
    fi
else
    echo "No containerd config found at ${CONFIG_PATH}; skipping."
fi

PKG_MANAGER="$(detect_pkg_manager)"
if [ -z "$PKG_MANAGER" ]; then
    echo "No supported package manager found; skipping dependency removal."
    exit 0
fi

echo "Removing dependencies via $PKG_MANAGER..."
packages=(
    curl
    wget
    unzip
    containerd
    nerdctl
    openssl
    pkgconf
)

case "$PKG_MANAGER" in
    apt)
        packages+=(build-essential pkg-config libssl-dev containerd.io)
        ;;
    apk)
        packages+=(build-base pkgconfig openssl-dev)
        ;;
    yum|dnf)
        packages+=(gcc gcc-c++ make pkgconfig openssl-devel)
        ;;
    pacman)
        packages+=(base-devel)
        ;;
    zypper)
        packages+=(gcc gcc-c++ make pkg-config libopenssl-devel)
        ;;
esac

installed=()
for pkg in "${packages[@]}"; do
    if is_installed "$PKG_MANAGER" "$pkg"; then
        if is_safe_to_remove "$PKG_MANAGER" "$pkg"; then
            installed+=("$pkg")
        else
            echo "Package required by other packages: $pkg (skipping)"
        fi
    else
        echo "Package not installed: $pkg (skipping)"
    fi
done

if [ "${#installed[@]}" -eq 0 ]; then
    echo "No matching dependencies installed; skipping package removal."
    exit 0
fi

case "$PKG_MANAGER" in
    apt)
        apt-get remove -y "${installed[@]}"
        apt-get autoremove -y
        ;;
    apk)
        apk del "${installed[@]}"
        ;;
    yum)
        yum remove -y "${installed[@]}"
        ;;
    dnf)
        dnf remove -y "${installed[@]}"
        ;;
    pacman)
        pacman -Rns --noconfirm "${installed[@]}"
        ;;
    zypper)
        zypper --non-interactive remove "${installed[@]}"
        ;;
esac

echo "Cleanup complete."
