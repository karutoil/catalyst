#!/usr/bin/env bash
# install-deps.sh - Install containerd, nerdctl, buildctl and common dependencies
# Supports: apt (Debian/Ubuntu), apk (Alpine), dnf/yum (Fedora/RHEL/CentOS), pacman (Arch), zypper (openSUSE)
# Will try to install packaged containerd where possible, and fall back to GitHub binary releases
# Run as root or with sudo

set -euo pipefail
export PATH="/usr/local/bin:$PATH"

CONTAINERD_VERSION="latest"   # set to e.g. 1.7.17 to pin
NERDCTL_VERSION="latest"      # set to e.g. 0.30.0 to pin
BUILDKIT_VERSION="latest"     # set to e.g. v0.13.1 to pin

# Tools we will attempt to install via packages
COMMON_PKGS=(curl ca-certificates tar gzip jq)

# Check for root
if [ "$EUID" -ne 0 ]; then
  SUDO=sudo
else
  SUDO=""
fi

log() { printf "[install-deps] %s\n" "$*"; }
error() { printf "[install-deps] ERROR: %s\n" "$*" >&2; exit 1; }

detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID=$ID
    OS_ID_LIKE=${ID_LIKE:-}
  else
    OS_ID=$(uname -s)
    OS_ID_LIKE=""
  fi

  case "${OS_ID,,}" in
    alpine) PM=apk ;;
    ubuntu|debian) PM=apt ;;
    fedora) PM=dnf ;;
    centos|rhel) PM=yum ;;
    arch) PM=pacman ;;
    opensuse*|suse) PM=zypper ;;
    *)
      # try detect by ID_LIKE
      case "${OS_ID_LIKE,,}" in
        *debian*) PM=apt ;;
        *rhel*|*fedora*) PM=dnf ;;
        *alpine*) PM=apk ;;
        *arch*) PM=pacman ;;
        *) PM=unknown ;;
      esac
      ;;
  esac
}

run_update_and_install() {
  case "$PM" in
    apt)
      $SUDO apt-get update -y
      $SUDO apt-get install -y "${COMMON_PKGS[@]}" gnupg lsb-release software-properties-common ca-certificates
      ;;
    apk)
      $SUDO apk update
      $SUDO apk add --no-cache "${COMMON_PKGS[@]}" gnupg
      ;;
    dnf)
      $SUDO dnf -y install "${COMMON_PKGS[@]}" gnupg2
      ;;
    yum)
      $SUDO yum -y install "${COMMON_PKGS[@]}" gnupg2
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm "${COMMON_PKGS[@]}" gnupg
      ;;
    zypper)
      $SUDO zypper refresh
      $SUDO zypper install -y "${COMMON_PKGS[@]}" gpg2
      ;;
    *)
      error "Unsupported package manager or OS. Please install prerequisites manually: ${COMMON_PKGS[*]}"
      ;;
  esac
}

apt_add_docker_repo() {
  # Add Docker repo to get a recent containerd package (for Debian/Ubuntu)
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    ARCH=$(dpkg --print-architecture 2>/dev/null || true)
    if [ -z "$ARCH" ]; then ARCH=amd64; fi
    echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
    $SUDO apt-get update -y
  fi
}

install_containerd_package() {
  log "Attempting to install containerd via package manager ($PM)"
  case "$PM" in
    apt)
      apt_add_docker_repo
      if $SUDO apt-get install -y containerd; then return 0; fi
      ;;
    apk)
      if $SUDO apk add --no-cache containerd; then return 0; fi
      ;;
    dnf)
      if $SUDO dnf -y install containerd; then return 0; fi
      ;;
    yum)
      if $SUDO yum -y install containerd; then return 0; fi
      ;;
    pacman)
      if $SUDO pacman -Sy --noconfirm containerd; then return 0; fi
      ;;
    zypper)
      if $SUDO zypper install -y containerd; then return 0; fi
      ;;
  esac
  return 1
}

download_github_release_asset() {
  # usage: download_github_release_asset owner/repo tag match_regex dest
  repo=$1
  tag=$2
  match=$3
  dest=$4

  api_url="https://api.github.com/repos/${repo}/releases"
  if [ "$tag" = "latest" ]; then
    url="${api_url}/latest"
  else
    url="${api_url}/tags/${tag}"
  fi

  log "Fetching release metadata from $url"
  assets=$(curl -fsSL "$url" | jq -r '.assets[] | .browser_download_url')
  if [ -z "$assets" ]; then
    error "No release assets found for ${repo} ${tag}"
  fi

  for a in $assets; do
    if echo "$a" | grep -Eq "$match"; then
      log "Found asset: $a"
      curl -fsSL "$a" -o "$dest"
      return 0
    fi
  done

  return 1
}

install_containerd_binary() {
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) ARCH=amd64 ;;
    aarch64) ARCH=arm64 ;;
    armv7l) ARCH=armhf ;;
    *) ARCH=amd64 ;;
  esac

  if [ "$CONTAINERD_VERSION" = "latest" ]; then
    tag="latest"
  else
    tag="v${CONTAINERD_VERSION#v}"
  fi

  tgt="/tmp/containerd-${tag}-${ARCH}.tar.gz"
  if download_github_release_asset "containerd/containerd" "$tag" "linux.*${ARCH}.*\.tar\.gz|containerd-.*linux-${ARCH}.*\.tar\.gz" "$tgt"; then
    log "Extracting containerd"
    $SUDO tar -C / -xzf "$tgt"
    rm -f "$tgt"
    # systemd unit: if packaged not installed, try to set up a basic unit
    if [ ! -f /lib/systemd/system/containerd.service ] && [ -f /etc/systemd/system ]; then
      log "Installing minimal containerd systemd service"
      cat <<'EOF' | $SUDO tee /etc/systemd/system/containerd.service >/dev/null
[Unit]
Description=containerd container runtime
Documentation=https://containerd.io
After=network.target

[Service]
ExecStart=/usr/local/bin/containerd
Restart=always
Delegate=yes
KillMode=process

[Install]
WantedBy=multi-user.target
EOF
      $SUDO systemctl daemon-reload || true
    fi
    return 0
  else
    error "Failed to download containerd binary release"
  fi
}

install_nerdctl() {
  log "Installing nerdctl"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) ARCH=amd64 ;;
    aarch64) ARCH=arm64 ;;
    armv7l) ARCH=armv7 ;;
    *) ARCH=amd64 ;;
  esac
  if [ "$NERDCTL_VERSION" = "latest" ]; then
    tag="latest"
  else
    tag="v${NERDCTL_VERSION#v}"
  fi
  tmp="/tmp/nerdctl-${tag}-${ARCH}.tar.gz"
  if download_github_release_asset "containerd/nerdctl" "$tag" "linux.*${ARCH}.*\.tar\.gz|nerdctl-.*linux-${ARCH}.*\.tar\.gz" "$tmp"; then
    $SUDO tar -C /usr/local -xzf "$tmp"
    rm -f "$tmp"
    log "nerdctl installed to /usr/local/bin"
  else
    error "Failed to download nerdctl"
  fi
}

install_buildctl() {
  log "Installing buildctl (BuildKit)"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) ARCH=amd64 ;;
    aarch64) ARCH=arm64 ;;
    armv7l) ARCH=armv7 ;;
    *) ARCH=amd64 ;;
  esac

  if [ "$BUILDKIT_VERSION" = "latest" ]; then
    tag="latest"
  else
    tag="${BUILDKIT_VERSION#v}"
  fi
  tmp="/tmp/buildkit-${tag}-${ARCH}.tar.gz"
  # The repo is moby/buildkit
  # Asset names vary; match linux and arch and include buildctl
  if download_github_release_asset "moby/buildkit" "$tag" "linux.*${ARCH}.*buildctl.*\.tar\.gz|linux.*${ARCH}.*\.tar\.gz|buildkit-.*linux-${ARCH}.*\.tar\.gz" "$tmp"; then
    mkdir -p /tmp/buildkit-extract
    tar -C /tmp/buildkit-extract -xzf "$tmp"
    # find buildctl
    buildctl_path=$(find /tmp/buildkit-extract -type f -name buildctl -print -quit || true)
    if [ -n "$buildctl_path" ]; then
      $SUDO install -m 0755 "$buildctl_path" /usr/local/bin/buildctl
      log "buildctl installed to /usr/local/bin/buildctl"
    else
      error "buildctl binary not found in release archive"
    fi
    rm -rf /tmp/buildkit-extract "$tmp"
  else
    error "Failed to download buildkit release"
  fi
}

enable_and_start_containerd() {
  if command -v systemctl >/dev/null 2>&1; then
    log "Enabling and starting containerd.service"
    $SUDO systemctl enable --now containerd || true
  else
    log "systemctl not found - please start containerd manually if needed"
  fi
}

install_runc_or_crun() {
  log "Installing a runtime (runc/crun) if available in packages"
  case "$PM" in
    apt)
      $SUDO apt-get install -y runc || true
      ;;
    apk)
      $SUDO apk add --no-cache runc || true
      ;;
    dnf|yum)
      $SUDO $PM -y install runc || true
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm runc || true
      ;;
    zypper)
      $SUDO zypper install -y runc || true
      ;;
  esac
}

post_install_checks() {
  log "Verifying installations"
  command -v containerd >/dev/null 2>&1 && log "containerd: $(containerd --version 2>/dev/null || true)" || log "containerd not found in PATH"
  command -v nerdctl >/dev/null 2>&1 && log "nerdctl: $(nerdctl --version 2>/dev/null || true)" || log "nerdctl not found in PATH"
  command -v buildctl >/dev/null 2>&1 && log "buildctl: $(buildctl --version 2>/dev/null || true)" || log "buildctl not found in PATH"
}

main() {
  detect_os
  log "Detected OS/package manager: $PM"

  run_update_and_install

  if ! install_containerd_package; then
    log "Package install failed or unavailable, falling back to binary release"
    install_containerd_binary
  fi

  install_nerdctl
  install_buildctl
  install_runc_or_crun
  enable_and_start_containerd
  post_install_checks

  log "Done — containerd, nerdctl and buildctl should be installed."
  log "You may need to logout/login or add your user to the 'docker' or 'wheel' group for non-root usage." 
  log "If you use cgroup v2, ensure your system is configured accordingly and that containerd/runc/crun support it."
}

main "$@"
