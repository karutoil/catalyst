#!/usr/bin/env bash

set -euo pipefail

ORIGINAL_ARGS=("$@")
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "${ORIGINAL_ARGS[@]}"
  fi
  echo "This installer must run as root."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INSTALL_ROOT="${CATALYST_INSTALL_ROOT:-/opt/catalyst}"
APP_ROOT="${INSTALL_ROOT}/app"
WEB_ROOT="${INSTALL_ROOT}/www"
ENV_DIR="/etc/catalyst"
ENV_FILE="${ENV_DIR}/catalyst.env"
STATE_FILE="${ENV_DIR}/install.state"
SUMMARY_FILE="${ENV_DIR}/credentials.txt"
SFTP_HOST_KEY="${ENV_DIR}/sftp_host_key"
CADDYFILE="/etc/caddy/Caddyfile"
BACKEND_PORT="${CATALYST_BACKEND_PORT:-3000}"
CATALYST_USER="catalyst"
CATALYST_GROUP="catalyst"

DOMAIN="${CATALYST_DOMAIN:-}"
ADMIN_EMAIL="${CATALYST_ADMIN_EMAIL:-}"
ADMIN_USERNAME="${CATALYST_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${CATALYST_ADMIN_PASSWORD:-}"
NON_INTERACTIVE=false

PM=""
INIT_SYSTEM=""
PKG_UPDATED=0
POSTGRES_SERVICE="postgresql"
DB_NAME="catalyst_db"
DB_USER="catalyst"
DB_PASSWORD=""
JWT_SECRET=""
BETTER_AUTH_SECRET=""
BACKUP_CREDENTIALS_KEY=""
PANEL_SCHEME="https"
PANEL_URL=""
CADDY_SITE=""
NODE_BIN=""
CADDY_BINARY_FALLBACK=false

log() {
  printf '[catalyst-installer] %s\n' "$*"
}

warn() {
  printf '[catalyst-installer] WARN: %s\n' "$*" >&2
}

die() {
  printf '[catalyst-installer] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Catalyst production installer

Usage:
  sudo ./scripts/install-panel.sh [options]

Options:
  --domain <fqdn-or-ip>         Panel domain (or IP). Defaults to hostname -f.
  --admin-email <email>         Initial admin email. Defaults to admin@<domain>.
  --admin-username <username>   Initial admin username. Defaults to admin.
  --admin-password <password>   Initial admin password. Randomly generated if omitted.
  --non-interactive             Do not prompt for missing values; fail instead.
  --install-root <path>         Install location. Defaults to /opt/catalyst.
  --help                        Show this help.

Examples:
  sudo ./scripts/install-panel.sh --domain panel.example.com
  sudo ./scripts/install-panel.sh --domain 203.0.113.10 --non-interactive
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --domain)
        [ "$#" -ge 2 ] || die "--domain requires a value"
        DOMAIN="$2"
        shift 2
        ;;
      --admin-email)
        [ "$#" -ge 2 ] || die "--admin-email requires a value"
        ADMIN_EMAIL="$2"
        shift 2
        ;;
      --admin-username)
        [ "$#" -ge 2 ] || die "--admin-username requires a value"
        ADMIN_USERNAME="$2"
        shift 2
        ;;
      --admin-password)
        [ "$#" -ge 2 ] || die "--admin-password requires a value"
        ADMIN_PASSWORD="$2"
        shift 2
        ;;
      --install-root)
        [ "$#" -ge 2 ] || die "--install-root requires a value"
        INSTALL_ROOT="$2"
        APP_ROOT="${INSTALL_ROOT}/app"
        WEB_ROOT="${INSTALL_ROOT}/www"
        shift 2
        ;;
      --non-interactive)
        NON_INTERACTIVE=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    PM="apt"
    return
  fi
  if command -v apk >/dev/null 2>&1; then
    PM="apk"
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    PM="dnf"
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    PM="yum"
    return
  fi
  if command -v pacman >/dev/null 2>&1; then
    PM="pacman"
    return
  fi
  die "Unsupported distro: no supported package manager found (apt/apk/dnf/yum/pacman)."
}

detect_init_system() {
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    INIT_SYSTEM="systemd"
    return
  fi
  if command -v rc-service >/dev/null 2>&1; then
    INIT_SYSTEM="openrc"
    return
  fi
  die "Unsupported init system. Need systemd or OpenRC."
}

pkg_update_once() {
  if [ "$PKG_UPDATED" -eq 1 ]; then
    return
  fi
  case "$PM" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get update -y
      ;;
    apk)
      apk update
      ;;
    dnf)
      dnf makecache -y
      ;;
    yum)
      yum makecache -y
      ;;
    pacman)
      pacman -Sy --noconfirm
      ;;
  esac
  PKG_UPDATED=1
}

pkg_install() {
  pkg_update_once
  case "$PM" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
      ;;
    apk)
      apk add --no-cache "$@"
      ;;
    dnf)
      dnf install -y "$@"
      ;;
    yum)
      yum install -y "$@"
      ;;
    pacman)
      pacman -S --noconfirm --needed "$@"
      ;;
  esac
}

ensure_base_packages() {
  log "Installing base packages..."
  case "$PM" in
    apt)
      pkg_install ca-certificates curl jq openssl git rsync tar xz-utils unzip \
        bash sed grep coreutils gnupg lsb-release pkg-config build-essential python3 \
        openssh-client
      ;;
    apk)
      pkg_install ca-certificates curl jq openssl git rsync tar xz unzip bash sed grep \
        coreutils pkgconf build-base python3 openssh
      ;;
    dnf)
      pkg_install ca-certificates curl jq openssl git rsync tar xz unzip bash sed grep \
        coreutils gcc gcc-c++ make pkgconf-pkg-config python3 openssh-clients
      ;;
    yum)
      pkg_install ca-certificates curl jq openssl git rsync tar xz unzip bash sed grep \
        coreutils gcc gcc-c++ make pkgconfig python3 openssh-clients
      ;;
    pacman)
      pkg_install ca-certificates curl jq openssl git rsync tar xz unzip bash sed grep \
        coreutils base-devel pkgconf python openssh
      ;;
  esac
}

node_major_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo "0"
    return
  fi
  node -e "process.stdout.write(process.versions.node.split('.')[0])"
}

ensure_nodejs() {
  local major
  major="$(node_major_version)"
  if [ "$major" -ge 20 ]; then
    log "Node.js $(node -v) already installed."
    return
  fi

  log "Installing Node.js 20+..."
  case "$PM" in
    apt)
      if curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; then
        pkg_install nodejs
      else
        warn "NodeSource setup failed; falling back to distro nodejs package."
        pkg_install nodejs npm
      fi
      ;;
    dnf|yum)
      if curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -; then
        pkg_install nodejs
      else
        warn "NodeSource setup failed; falling back to distro nodejs package."
        pkg_install nodejs npm
      fi
      ;;
    apk|pacman)
      pkg_install nodejs npm
      ;;
  esac

  major="$(node_major_version)"
  if [ "$major" -lt 20 ]; then
    die "Node.js 20+ is required. Installed version: $(node -v 2>/dev/null || echo unknown)"
  fi
  command -v npm >/dev/null 2>&1 || die "npm is required but was not installed."
}

ensure_postgresql_packages() {
  log "Installing PostgreSQL..."
  case "$PM" in
    apt)
      pkg_install postgresql postgresql-contrib
      ;;
    apk)
      pkg_install postgresql postgresql-contrib postgresql-client
      ;;
    dnf|yum)
      pkg_install postgresql-server postgresql postgresql-contrib
      ;;
    pacman)
      pkg_install postgresql
      ;;
  esac
}

ensure_caddy_user() {
  if id -u caddy >/dev/null 2>&1; then
    return
  fi

  local nologin_shell
  nologin_shell="$(command -v nologin || true)"
  if [ -z "$nologin_shell" ]; then
    nologin_shell="/sbin/nologin"
  fi

  if command -v useradd >/dev/null 2>&1; then
    useradd --system --home /var/lib/caddy --shell "$nologin_shell" caddy >/dev/null 2>&1 || true
    return
  fi

  if command -v adduser >/dev/null 2>&1 && command -v addgroup >/dev/null 2>&1; then
    addgroup -S caddy >/dev/null 2>&1 || true
    adduser -S -D -H -h /var/lib/caddy -s "$nologin_shell" -G caddy caddy >/dev/null 2>&1 || true
    return
  fi

  warn "Could not create caddy user automatically."
}

ensure_caddy_binary_service() {
  local caddy_bin
  caddy_bin="$(command -v caddy || echo /usr/local/bin/caddy)"

  ensure_caddy_user
  mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy
  chown -R caddy:caddy /var/lib/caddy /var/log/caddy

  if [ "$INIT_SYSTEM" = "systemd" ]; then
    cat > /etc/systemd/system/caddy.service <<EOF
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=${caddy_bin} run --environ --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=${caddy_bin} reload --config /etc/caddy/Caddyfile --adapter caddyfile
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/etc/caddy /var/lib/caddy /var/log/caddy

[Install]
WantedBy=multi-user.target
EOF
    return
  fi

  cat > /etc/init.d/caddy <<EOF
#!/sbin/openrc-run
name="Caddy"
description="Caddy Web Server"
command="${caddy_bin}"
command_args="run --config /etc/caddy/Caddyfile --adapter caddyfile"
command_background=true
pidfile="/run/caddy.pid"
command_user="caddy:caddy"
output_log="/var/log/caddy/caddy.log"
error_log="/var/log/caddy/caddy.log"

depend() {
  need net
}
EOF
  chmod +x /etc/init.d/caddy
}

install_caddy_binary() {
  log "Installing Caddy from upstream release..."
  local arch url json tmp_file
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    armv7l) arch="armv7" ;;
    *)
      die "Unsupported architecture for Caddy binary install: $(uname -m)"
      ;;
  esac

  json="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest)"
  url="$(printf '%s' "$json" | jq -r ".assets[] | select(.name | test(\"linux_${arch}\\\\.tar\\\\.gz$\")) | .browser_download_url" | head -n1)"
  [ -n "$url" ] || die "Could not find a Caddy release asset for linux_${arch}."

  tmp_file="$(mktemp /tmp/caddy.XXXXXX.tar.gz)"
  curl -fsSL "$url" -o "$tmp_file"
  tar -xzf "$tmp_file" -C /tmp
  install -m 0755 /tmp/caddy /usr/local/bin/caddy
  rm -f "$tmp_file" /tmp/caddy /tmp/LICENSE /tmp/README.md /tmp/README.txt
  CADDY_BINARY_FALLBACK=true
  ensure_caddy_binary_service
}

ensure_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    log "Caddy already installed."
    return
  fi

  log "Installing Caddy..."
  if pkg_install caddy >/dev/null 2>&1; then
    log "Installed Caddy via package manager."
    return
  fi

  warn "Caddy package not available via ${PM}; falling back to binary install."
  install_caddy_binary
}

ensure_catalyst_user() {
  if id -u "$CATALYST_USER" >/dev/null 2>&1; then
    return
  fi

  local nologin_shell
  nologin_shell="$(command -v nologin || true)"
  if [ -z "$nologin_shell" ]; then
    nologin_shell="/sbin/nologin"
  fi

  if command -v useradd >/dev/null 2>&1; then
    useradd --system --create-home --home-dir /var/lib/catalyst --shell "$nologin_shell" "$CATALYST_USER"
    return
  fi

  if command -v adduser >/dev/null 2>&1 && command -v addgroup >/dev/null 2>&1; then
    addgroup -S "$CATALYST_GROUP" >/dev/null 2>&1 || true
    adduser -S -D -h /var/lib/catalyst -s "$nologin_shell" -G "$CATALYST_GROUP" "$CATALYST_USER"
    return
  fi

  die "Could not create ${CATALYST_USER} user."
}

ensure_directories() {
  mkdir -p "$APP_ROOT" "$WEB_ROOT" "$ENV_DIR" \
    /var/lib/catalyst/backups \
    /var/lib/catalyst/backups/stream \
    /var/lib/catalyst/backups/transfer \
    /var/lib/catalyst/servers \
    /var/log/catalyst

  chown -R "${CATALYST_USER}:${CATALYST_GROUP}" "$INSTALL_ROOT" /var/lib/catalyst /var/log/catalyst
  chmod 755 "$ENV_DIR"
}

strip_scheme() {
  local input="$1"
  input="${input#http://}"
  input="${input#https://}"
  input="${input%%/*}"
  if [[ "$input" =~ ^\[(.*)\]$ ]]; then
    input="${BASH_REMATCH[1]}"
  fi
  if [[ "$input" =~ ^[^:]+:[0-9]+$ ]]; then
    input="${input%:*}"
  fi
  echo "$input"
}

is_ip_address() {
  local value="$1"
  if [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    return 0
  fi
  if [[ "$value" =~ : ]]; then
    return 0
  fi
  return 1
}

generate_secret_hex() {
  local bytes="${1:-32}"
  openssl rand -hex "$bytes"
}

generate_password() {
  openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 28
}

load_previous_state() {
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE"
  fi

  if [ -z "$DOMAIN" ] && [ -n "${STATE_DOMAIN:-}" ]; then
    DOMAIN="$STATE_DOMAIN"
  fi
  if [ -z "$ADMIN_EMAIL" ] && [ -n "${STATE_ADMIN_EMAIL:-}" ]; then
    ADMIN_EMAIL="$STATE_ADMIN_EMAIL"
  fi
  if [ -z "$ADMIN_USERNAME" ] && [ -n "${STATE_ADMIN_USERNAME:-}" ]; then
    ADMIN_USERNAME="$STATE_ADMIN_USERNAME"
  fi
  if [ -z "$ADMIN_PASSWORD" ] && [ -n "${STATE_ADMIN_PASSWORD:-}" ]; then
    ADMIN_PASSWORD="$STATE_ADMIN_PASSWORD"
  fi
  if [ -z "$DB_PASSWORD" ] && [ -n "${STATE_DB_PASSWORD:-}" ]; then
    DB_PASSWORD="$STATE_DB_PASSWORD"
  fi
  if [ -z "$JWT_SECRET" ] && [ -n "${STATE_JWT_SECRET:-}" ]; then
    JWT_SECRET="$STATE_JWT_SECRET"
  fi
  if [ -z "$BETTER_AUTH_SECRET" ] && [ -n "${STATE_BETTER_AUTH_SECRET:-}" ]; then
    BETTER_AUTH_SECRET="$STATE_BETTER_AUTH_SECRET"
  fi
  if [ -z "$BACKUP_CREDENTIALS_KEY" ] && [ -n "${STATE_BACKUP_CREDENTIALS_KEY:-}" ]; then
    BACKUP_CREDENTIALS_KEY="$STATE_BACKUP_CREDENTIALS_KEY"
  fi
}

resolve_domain_and_urls() {
  DOMAIN="$(strip_scheme "$DOMAIN")"
  if [ -z "$DOMAIN" ]; then
    DOMAIN="$(hostname -f 2>/dev/null || true)"
  fi
  if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "(none)" ]; then
    DOMAIN="$(hostname 2>/dev/null || true)"
  fi
  if [ -z "$DOMAIN" ]; then
    if [ "$NON_INTERACTIVE" = true ]; then
      die "Could not detect a domain. Use --domain."
    fi
    read -r -p "Enter domain or server IP for Catalyst panel: " DOMAIN
  fi

  DOMAIN="$(strip_scheme "$DOMAIN")"
  if [ -z "$DOMAIN" ]; then
    die "Invalid domain value."
  fi

  if is_ip_address "$DOMAIN"; then
    PANEL_SCHEME="http"
    CADDY_SITE="http://${DOMAIN}"
  else
    PANEL_SCHEME="https"
    CADDY_SITE="${DOMAIN}"
  fi
  PANEL_URL="${PANEL_SCHEME}://${DOMAIN}"
}

resolve_credentials() {
  if [ -z "$ADMIN_EMAIL" ]; then
    if is_ip_address "$DOMAIN"; then
      ADMIN_EMAIL="admin@localhost.local"
    else
      ADMIN_EMAIL="admin@${DOMAIN}"
    fi
  fi

  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(generate_password)"
  fi
  if [ "${#ADMIN_PASSWORD}" -lt 12 ]; then
    die "Admin password must be at least 12 characters."
  fi

  if [ -z "$DB_PASSWORD" ]; then
    DB_PASSWORD="$(generate_secret_hex 20)"
  fi
  if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET="$(generate_secret_hex 32)"
  fi
  if [ -z "$BETTER_AUTH_SECRET" ]; then
    BETTER_AUTH_SECRET="$(generate_secret_hex 32)"
  fi
  if [ -z "$BACKUP_CREDENTIALS_KEY" ]; then
    BACKUP_CREDENTIALS_KEY="$(generate_secret_hex 32)"
  fi
}

persist_state() {
  umask 077
  {
    printf "STATE_DOMAIN=%q\n" "$DOMAIN"
    printf "STATE_ADMIN_EMAIL=%q\n" "$ADMIN_EMAIL"
    printf "STATE_ADMIN_USERNAME=%q\n" "$ADMIN_USERNAME"
    printf "STATE_ADMIN_PASSWORD=%q\n" "$ADMIN_PASSWORD"
    printf "STATE_DB_PASSWORD=%q\n" "$DB_PASSWORD"
    printf "STATE_JWT_SECRET=%q\n" "$JWT_SECRET"
    printf "STATE_BETTER_AUTH_SECRET=%q\n" "$BETTER_AUTH_SECRET"
    printf "STATE_BACKUP_CREDENTIALS_KEY=%q\n" "$BACKUP_CREDENTIALS_KEY"
  } > "$STATE_FILE"
  chmod 600 "$STATE_FILE"
}

write_backend_env() {
  umask 027
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=${BACKEND_PORT}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
CORS_ORIGIN=${PANEL_URL}
JWT_SECRET=${JWT_SECRET}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${PANEL_URL}
PASSKEY_RP_ID=${DOMAIN}
BACKEND_EXTERNAL_ADDRESS=${PANEL_URL}
FRONTEND_URL=${PANEL_URL}
CONSOLE_OUTPUT_BYTE_LIMIT_BYTES=262144
BACKUP_DIR=/var/lib/catalyst/backups
BACKUP_STORAGE_MODE=local
BACKUP_STREAM_DIR=/var/lib/catalyst/backups/stream
BACKUP_TRANSFER_DIR=/var/lib/catalyst/backups/transfer
BACKUP_CREDENTIALS_ENCRYPTION_KEY=${BACKUP_CREDENTIALS_KEY}
SUSPENSION_ENFORCED=true
SUSPENSION_DELETE_POLICY=block
DATABASE_HOST_PORT_DEFAULT=3306
DATABASE_HOST_CONNECT_TIMEOUT_MS=5000
SFTP_ENABLED=true
SFTP_PORT=2022
SERVER_FILES_ROOT=/var/lib/catalyst/servers
SERVER_DATA_PATH=/var/lib/catalyst/servers
SFTP_HOST_KEY=${SFTP_HOST_KEY}
BACKEND_URL=${PANEL_URL}
API_URL=${PANEL_URL}/api
PLUGINS_DIR=${APP_ROOT}/catalyst-plugins
PLUGIN_HOT_RELOAD=false
REDIS_URL=
WHMCS_OIDC_CLIENT_ID=
WHMCS_OIDC_CLIENT_SECRET=
WHMCS_OIDC_DISCOVERY_URL=
PAYMENTER_OIDC_CLIENT_ID=
PAYMENTER_OIDC_CLIENT_SECRET=
PAYMENTER_OIDC_DISCOVERY_URL=
EOF

  chown root:${CATALYST_GROUP} "$ENV_FILE"
  chmod 640 "$ENV_FILE"
}

write_frontend_env() {
  local frontend_env="${APP_ROOT}/catalyst-frontend/.env.production"
  cat > "$frontend_env" <<EOF
VITE_API_URL=/api
VITE_WS_URL=/ws
VITE_ENV=production
VITE_BETTER_AUTH_URL=${PANEL_URL}
VITE_PASSKEY_RP_ID=${DOMAIN}
SKIP_WEB_SERVER=true
EOF
}

install_source_tree() {
  log "Copying source tree to ${APP_ROOT}..."
  if [ "$REPO_ROOT" = "$APP_ROOT" ]; then
    log "Installer already running from target app directory; skipping copy."
    return
  fi
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'playwright-report' \
    "$REPO_ROOT"/ "$APP_ROOT"/
}

ensure_sftp_host_key() {
  if [ ! -f "$SFTP_HOST_KEY" ]; then
    log "Generating SFTP host key..."
    ssh-keygen -t ed25519 -N '' -f "$SFTP_HOST_KEY" >/dev/null
  fi
  chown root:${CATALYST_GROUP} "$SFTP_HOST_KEY"
  chmod 640 "$SFTP_HOST_KEY"
}

create_backend_env_symlink() {
  ln -sfn "$ENV_FILE" "${APP_ROOT}/catalyst-backend/.env"
}

as_postgres() {
  local cmd="$1"
  if command -v sudo >/dev/null 2>&1; then
    sudo -u postgres sh -c "$cmd"
    return
  fi
  su -s /bin/sh postgres -c "$cmd"
}

initialize_postgres_cluster() {
  if command -v postgresql-setup >/dev/null 2>&1; then
    postgresql-setup --initdb >/dev/null 2>&1 || postgresql-setup --initdb --unit postgresql >/dev/null 2>&1 || true
  fi

  local initdb_bin=""
  if command -v initdb >/dev/null 2>&1; then
    initdb_bin="$(command -v initdb)"
  else
    initdb_bin="$(ls /usr/pgsql-*/bin/initdb 2>/dev/null | head -n1 || true)"
  fi

  if [ -n "$initdb_bin" ]; then
    if [ -d /var/lib/postgres ] && [ ! -f /var/lib/postgres/data/PG_VERSION ]; then
      mkdir -p /var/lib/postgres/data
      chown -R postgres:postgres /var/lib/postgres
      as_postgres "${initdb_bin} -D /var/lib/postgres/data" >/dev/null 2>&1 || true
    fi
    if [ -d /var/lib/postgresql ] && [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
      mkdir -p /var/lib/postgresql/data
      chown -R postgres:postgres /var/lib/postgresql
      as_postgres "${initdb_bin} -D /var/lib/postgresql/data" >/dev/null 2>&1 || true
    fi
    if [ -d /var/lib/pgsql ] && [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
      mkdir -p /var/lib/pgsql/data
      chown -R postgres:postgres /var/lib/pgsql
      as_postgres "${initdb_bin} -D /var/lib/pgsql/data" >/dev/null 2>&1 || true
    fi
  fi
}

enable_postgres_service() {
  initialize_postgres_cluster

  if [ "$INIT_SYSTEM" = "openrc" ]; then
    rc-update add postgresql default >/dev/null 2>&1 || true
    rc-service postgresql restart >/dev/null 2>&1 || rc-service postgresql start
    POSTGRES_SERVICE="postgresql"
    return
  fi

  local candidates=(
    "postgresql"
    "postgresql.service"
    "postgresql-16"
    "postgresql-15"
    "postgresql@16-main"
    "postgresql@15-main"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if systemctl enable --now "$candidate" >/dev/null 2>&1; then
      POSTGRES_SERVICE="$candidate"
      return
    fi
  done

  die "Could not start PostgreSQL service automatically."
}

wait_for_postgres() {
  log "Waiting for PostgreSQL to accept connections..."
  local i
  for i in $(seq 1 30); do
    if as_postgres "pg_isready >/dev/null 2>&1"; then
      return
    fi
    sleep 1
  done
  die "PostgreSQL did not become ready in time."
}

configure_postgres_database() {
  log "Configuring PostgreSQL database and user..."
  as_postgres "psql -v ON_ERROR_STOP=1 -c \"DO \\\$\\\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\\\$\\\$;\""

  as_postgres "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1 || psql -v ON_ERROR_STOP=1 -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\""
  as_postgres "psql -v ON_ERROR_STOP=1 -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\""
}

service_enable_start() {
  local svc="$1"
  if [ "$INIT_SYSTEM" = "systemd" ]; then
    systemctl daemon-reload
    systemctl enable --now "$svc"
    return
  fi
  rc-update add "$svc" default >/dev/null 2>&1 || true
  rc-service "$svc" restart >/dev/null 2>&1 || rc-service "$svc" start
}

service_restart() {
  local svc="$1"
  if [ "$INIT_SYSTEM" = "systemd" ]; then
    systemctl daemon-reload
    systemctl restart "$svc"
    return
  fi
  rc-service "$svc" restart
}

write_backend_runner() {
  NODE_BIN="$(command -v node)"
  cat > /usr/local/bin/catalyst-backend-run <<EOF
#!/usr/bin/env sh
set -eu
set -a
. ${ENV_FILE}
set +a
cd ${APP_ROOT}/catalyst-backend
exec ${NODE_BIN} dist/index.js
EOF
  chmod 0755 /usr/local/bin/catalyst-backend-run
}

write_backend_service() {
  write_backend_runner
  if [ "$INIT_SYSTEM" = "systemd" ]; then
    cat > /etc/systemd/system/catalyst-backend.service <<EOF
[Unit]
Description=Catalyst Backend API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CATALYST_USER}
Group=${CATALYST_GROUP}
WorkingDirectory=${APP_ROOT}/catalyst-backend
ExecStart=/usr/local/bin/catalyst-backend-run
Restart=always
RestartSec=5
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
    return
  fi

  cat > /etc/init.d/catalyst-backend <<'EOF'
#!/sbin/openrc-run
name="Catalyst Backend"
description="Catalyst backend API service"
command="/usr/local/bin/catalyst-backend-run"
command_user="catalyst:catalyst"
command_background=true
pidfile="/run/catalyst-backend.pid"
output_log="/var/log/catalyst/backend.log"
error_log="/var/log/catalyst/backend.log"

depend() {
  need net postgresql
}
EOF
  chmod +x /etc/init.d/catalyst-backend
}

write_caddy_config() {
  mkdir -p /etc/caddy
  if [ -f "$CADDYFILE" ]; then
    cp "$CADDYFILE" "${CADDYFILE}.bak.$(date +%Y%m%d%H%M%S)" || true
  fi

  cat > "$CADDYFILE" <<EOF
{
    email ${ADMIN_EMAIL}
}

${CADDY_SITE} {
    encode zstd gzip

    @backend path /api/* /ws /docs* /health
    reverse_proxy @backend 127.0.0.1:${BACKEND_PORT}

    root * ${WEB_ROOT}
    try_files {path} /index.html
    file_server
}
EOF
}

build_backend() {
  log "Installing backend dependencies and building..."
  (
    cd "${APP_ROOT}/catalyst-backend"
    npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    npm run db:push
    CATALYST_ADMIN_EMAIL="$ADMIN_EMAIL" \
    CATALYST_ADMIN_USERNAME="$ADMIN_USERNAME" \
    CATALYST_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    CATALYST_ADMIN_NAME="$ADMIN_USERNAME" \
      npx tsx scripts/bootstrap-production.ts
    npm run build
  )
}

build_frontend() {
  log "Installing frontend dependencies and building..."
  (
    cd "${APP_ROOT}/catalyst-frontend"
    npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund
    npm run build
  )

  log "Deploying frontend static assets..."
  rsync -a --delete "${APP_ROOT}/catalyst-frontend/dist/" "${WEB_ROOT}/"
}

fix_permissions() {
  chown -R "${CATALYST_USER}:${CATALYST_GROUP}" "$INSTALL_ROOT" /var/lib/catalyst /var/log/catalyst
  chown root:${CATALYST_GROUP} "$ENV_FILE" "$SFTP_HOST_KEY"
  chmod 640 "$ENV_FILE" "$SFTP_HOST_KEY"
}

open_firewall_ports() {
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
  fi
  if command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
}

write_summary_file() {
  umask 077
  cat > "$SUMMARY_FILE" <<EOF
Catalyst installation summary
============================
Panel URL: ${PANEL_URL}
Admin email: ${ADMIN_EMAIL}
Admin username: ${ADMIN_USERNAME}
Admin password: ${ADMIN_PASSWORD}

Backend service: catalyst-backend
Backend env file: ${ENV_FILE}
Frontend root: ${WEB_ROOT}
Caddy config: ${CADDYFILE}

PostgreSQL database: ${DB_NAME}
PostgreSQL user: ${DB_USER}
PostgreSQL password: ${DB_PASSWORD}
EOF
  chmod 600 "$SUMMARY_FILE"
}

start_services() {
  log "Starting backend service..."
  service_enable_start catalyst-backend

  if [ "$CADDY_BINARY_FALLBACK" = true ]; then
    log "Starting Caddy service (custom unit)..."
    service_enable_start caddy
    return
  fi

  if [ "$INIT_SYSTEM" = "systemd" ]; then
    if systemctl list-unit-files | grep -q '^caddy\.service'; then
      service_enable_start caddy
    else
      ensure_caddy_binary_service
      service_enable_start caddy
    fi
  else
    if [ ! -x /etc/init.d/caddy ]; then
      ensure_caddy_binary_service
    fi
    service_enable_start caddy
  fi
}

verify_services() {
  if [ "$INIT_SYSTEM" = "systemd" ]; then
    systemctl is-active --quiet catalyst-backend || die "catalyst-backend service is not active."
    systemctl is-active --quiet caddy || die "caddy service is not active."
    return
  fi

  rc-service catalyst-backend status >/dev/null || die "catalyst-backend service is not active."
  rc-service caddy status >/dev/null || die "caddy service is not active."
}

main() {
  parse_args "$@"
  detect_package_manager
  detect_init_system
  ensure_base_packages
  load_previous_state
  resolve_domain_and_urls
  resolve_credentials
  persist_state

  ensure_nodejs
  ensure_postgresql_packages
  ensure_caddy
  ensure_catalyst_user
  ensure_directories
  install_source_tree
  write_backend_env
  write_frontend_env
  ensure_sftp_host_key
  create_backend_env_symlink

  enable_postgres_service
  wait_for_postgres
  configure_postgres_database

  build_backend
  build_frontend

  write_backend_service
  write_caddy_config
  fix_permissions

  start_services
  service_restart caddy
  verify_services
  open_firewall_ports
  write_summary_file

  log "Installation complete."
  echo
  echo "Panel URL: ${PANEL_URL}"
  echo "Admin email: ${ADMIN_EMAIL}"
  echo "Admin username: ${ADMIN_USERNAME}"
  echo "Admin password: ${ADMIN_PASSWORD}"
  echo
  echo "Saved credentials: ${SUMMARY_FILE}"
}

main "$@"
