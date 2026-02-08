#!/usr/bin/env bash

set -euo pipefail

ORIGINAL_ARGS=("$@")
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "${ORIGINAL_ARGS[@]}"
  fi
  echo "This uninstaller must run as root."
  exit 1
fi

INSTALL_ROOT="${CATALYST_INSTALL_ROOT:-/opt/catalyst}"
APP_ROOT="${INSTALL_ROOT}/app"
WEB_ROOT="${INSTALL_ROOT}/www"
ENV_DIR="/etc/catalyst"
ENV_FILE="${ENV_DIR}/catalyst.env"
STATE_FILE="${ENV_DIR}/install.state"
SUMMARY_FILE="${ENV_DIR}/credentials.txt"
SFTP_HOST_KEY="${ENV_DIR}/sftp_host_key"
CADDYFILE="/etc/caddy/Caddyfile"
CATALYST_USER="catalyst"
CATALYST_GROUP="catalyst"
CONTAINER_NAMESPACE="${CATALYST_CONTAINER_NAMESPACE:-catalyst}"
POSTGRES_CONTAINER_NAME="${CATALYST_POSTGRES_CONTAINER_NAME:-catalyst-postgres}"
REDIS_CONTAINER_NAME="${CATALYST_REDIS_CONTAINER_NAME:-catalyst-redis}"
POSTGRES_VOLUME="${CATALYST_POSTGRES_VOLUME:-catalyst-postgres-data}"
REDIS_VOLUME="${CATALYST_REDIS_VOLUME:-catalyst-redis-data}"

NON_INTERACTIVE=false
ASSUME_YES=false
PURGE_DATA=false
DROP_DATABASE=false
RESTORE_CADDY=true
REMOVE_FIREWALL_RULES=false

INIT_SYSTEM="unknown"
DB_NAME="catalyst_db"
DB_USER="catalyst"

log() {
  printf '[catalyst-uninstall] %s\n' "$*"
}

warn() {
  printf '[catalyst-uninstall] WARN: %s\n' "$*" >&2
}

die() {
  printf '[catalyst-uninstall] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Catalyst production uninstaller

Usage:
  sudo ./scripts/uninstall-panel.sh [options]

Options:
  --install-root <path>        Install location. Defaults to /opt/catalyst.
  --drop-database              Drop Catalyst PostgreSQL data (nerdctl volume or local role/db).
  --purge-data                 Remove /var/lib/catalyst and /var/log/catalyst (and Redis volume).
  --remove-firewall-rules      Remove ufw/firewalld rules for HTTP/HTTPS added by installer.
  --keep-caddy-config          Keep current /etc/caddy/Caddyfile and skip backup restore.
  --non-interactive            Fail instead of prompting.
  --yes                        Run without interactive confirmation.
  --help                       Show this help.

Examples:
  sudo ./scripts/uninstall-panel.sh --yes
  sudo ./scripts/uninstall-panel.sh --drop-database --purge-data --yes
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --install-root)
        [ "$#" -ge 2 ] || die "--install-root requires a value"
        INSTALL_ROOT="$2"
        APP_ROOT="${INSTALL_ROOT}/app"
        WEB_ROOT="${INSTALL_ROOT}/www"
        shift 2
        ;;
      --drop-database)
        DROP_DATABASE=true
        shift
        ;;
      --purge-data)
        PURGE_DATA=true
        shift
        ;;
      --remove-firewall-rules)
        REMOVE_FIREWALL_RULES=true
        shift
        ;;
      --keep-caddy-config)
        RESTORE_CADDY=false
        shift
        ;;
      --non-interactive)
        NON_INTERACTIVE=true
        shift
        ;;
      --yes|-y)
        ASSUME_YES=true
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

  if [ "$NON_INTERACTIVE" = true ] && [ "$ASSUME_YES" = false ]; then
    die "--non-interactive requires --yes"
  fi
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
  INIT_SYSTEM="unknown"
}

nerdctl_ns() {
  nerdctl --namespace "$CONTAINER_NAMESPACE" "$@"
}

volume_exists() {
  local name="$1"
  nerdctl_ns volume inspect "$name" >/dev/null 2>&1
}

as_postgres() {
  local cmd="$1"
  if command -v sudo >/dev/null 2>&1; then
    sudo -u postgres sh -c "$cmd"
    return
  fi
  su -s /bin/sh postgres -c "$cmd"
}

load_database_details() {
  if [ ! -f "$ENV_FILE" ]; then
    return
  fi

  local db_url without_scheme credentials after_at user_part db_part
  db_url="$(awk -F= '/^DATABASE_URL=/{sub(/^DATABASE_URL=/, "", $0); print; exit}' "$ENV_FILE" || true)"
  if [ -z "$db_url" ]; then
    return
  fi

  without_scheme="${db_url#postgresql://}"
  without_scheme="${without_scheme#postgres://}"
  credentials="${without_scheme%%@*}"
  after_at="${without_scheme#*@}"
  user_part="${credentials%%:*}"
  db_part="${after_at#*/}"
  db_part="${db_part%%\?*}"

  if [ -n "$user_part" ] && [ "$user_part" != "$credentials" ]; then
    DB_USER="$user_part"
  fi
  if [ -n "$db_part" ] && [ "$db_part" != "$after_at" ]; then
    DB_NAME="$db_part"
  fi
}

confirm_uninstall() {
  if [ "$ASSUME_YES" = true ]; then
    return
  fi

  echo
  echo "Catalyst uninstall summary:"
  echo "  Install root: ${INSTALL_ROOT}"
  echo "  Container namespace: ${CONTAINER_NAMESPACE}"
  echo "  Drop database: ${DROP_DATABASE} (${DB_NAME}/${DB_USER})"
  echo "  Purge /var/lib/catalyst and /var/log/catalyst: ${PURGE_DATA}"
  echo "  Restore Caddy backup/remove Catalyst Caddyfile: ${RESTORE_CADDY}"
  echo

  if [ "$NON_INTERACTIVE" = true ]; then
    die "Refusing to continue without --yes in non-interactive mode."
  fi

  local answer
  read -r -p "Continue uninstall? [y/N]: " answer
  case "$answer" in
    y|Y|yes|YES)
      ;;
    *)
      die "Uninstall aborted."
      ;;
  esac
}

service_disable_stop() {
  local svc="$1"
  case "$INIT_SYSTEM" in
    systemd)
      systemctl disable --now "$svc" >/dev/null 2>&1 || systemctl stop "$svc" >/dev/null 2>&1 || true
      systemctl reset-failed "$svc" >/dev/null 2>&1 || true
      ;;
    openrc)
      rc-service "$svc" stop >/dev/null 2>&1 || true
      rc-update del "$svc" default >/dev/null 2>&1 || true
      ;;
    *)
      ;;
  esac
}

service_restart() {
  local svc="$1"
  case "$INIT_SYSTEM" in
    systemd)
      systemctl restart "$svc" >/dev/null 2>&1 || true
      ;;
    openrc)
      rc-service "$svc" restart >/dev/null 2>&1 || true
      ;;
    *)
      ;;
  esac
}

daemon_reload() {
  if [ "$INIT_SYSTEM" = "systemd" ]; then
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
}

is_installer_caddy_systemd_unit() {
  local unit="/etc/systemd/system/caddy.service"
  [ -f "$unit" ] || return 1
  grep -q "ExecStart=.*run --environ --config /etc/caddy/Caddyfile --adapter caddyfile" "$unit" &&
    grep -q "ReadWritePaths=/etc/caddy /var/lib/caddy /var/log/caddy" "$unit"
}

is_installer_caddy_openrc_unit() {
  local init_file="/etc/init.d/caddy"
  [ -f "$init_file" ] || return 1
  grep -q 'command_args="run --config /etc/caddy/Caddyfile --adapter caddyfile"' "$init_file" &&
    grep -q 'output_log="/var/log/caddy/caddy.log"' "$init_file"
}

find_latest_caddy_backup() {
  ls -1t /etc/caddy/Caddyfile.bak.* 2>/dev/null | head -n1 || true
}

is_catalyst_caddyfile() {
  [ -f "$CADDYFILE" ] || return 1
  grep -q "@backend path /api/\\* /ws /docs\\* /health" "$CADDYFILE" &&
    grep -q "reverse_proxy @backend 127.0.0.1:" "$CADDYFILE" &&
    grep -q "try_files {path} /index.html" "$CADDYFILE"
}

cleanup_caddy() {
  local reloaded=false

  if is_installer_caddy_systemd_unit; then
    log "Removing installer-managed caddy systemd unit..."
    service_disable_stop caddy
    rm -f /etc/systemd/system/caddy.service
    daemon_reload
  fi

  if is_installer_caddy_openrc_unit; then
    log "Removing installer-managed caddy OpenRC unit..."
    service_disable_stop caddy
    rm -f /etc/init.d/caddy
  fi

  if [ "$RESTORE_CADDY" = false ]; then
    return
  fi

  if [ -f "$CADDYFILE" ]; then
    local backup_file
    backup_file="$(find_latest_caddy_backup)"
    if [ -n "$backup_file" ]; then
      log "Restoring Caddy config from ${backup_file}..."
      cp "$backup_file" "$CADDYFILE"
      reloaded=true
    elif is_catalyst_caddyfile; then
      log "Removing Catalyst-managed Caddyfile..."
      rm -f "$CADDYFILE"
      reloaded=true
    else
      warn "Caddyfile does not match installer template and no backup found; leaving it unchanged."
    fi
  fi

  if [ "$reloaded" = true ]; then
    service_restart caddy
  fi
}

cleanup_backend_services() {
  log "Stopping and removing backend service..."
  service_disable_stop catalyst-backend
  rm -f /etc/systemd/system/catalyst-backend.service
  rm -f /etc/init.d/catalyst-backend
  rm -f /usr/local/bin/catalyst-backend-run
  daemon_reload
}

cleanup_dependency_containers() {
  if ! command -v nerdctl >/dev/null 2>&1; then
    return
  fi

  log "Stopping and removing dependency containers..."
  nerdctl_ns rm -f "$REDIS_CONTAINER_NAME" >/dev/null 2>&1 || true
  nerdctl_ns rm -f "$POSTGRES_CONTAINER_NAME" >/dev/null 2>&1 || true

  if [ "$PURGE_DATA" = true ] && volume_exists "$REDIS_VOLUME"; then
    nerdctl_ns volume rm "$REDIS_VOLUME" >/dev/null 2>&1 || warn "Could not remove Redis volume ${REDIS_VOLUME}."
  fi
}

drop_database() {
  if [ "$DROP_DATABASE" = false ]; then
    return
  fi

  if command -v nerdctl >/dev/null 2>&1 && volume_exists "$POSTGRES_VOLUME"; then
    log "Removing PostgreSQL volume ${POSTGRES_VOLUME}..."
    nerdctl_ns volume rm "$POSTGRES_VOLUME" >/dev/null 2>&1 || warn "Could not remove PostgreSQL volume ${POSTGRES_VOLUME}."
    return
  fi

  if ! id postgres >/dev/null 2>&1; then
    warn "postgres user not found; skipping database removal."
    return
  fi

  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found; skipping database removal."
    return
  fi

  local db_lit db_ident user_ident
  db_lit="$(printf '%s' "$DB_NAME" | sed "s/'/''/g")"
  db_ident="$(printf '%s' "$DB_NAME" | sed 's/"/""/g')"
  user_ident="$(printf '%s' "$DB_USER" | sed 's/"/""/g')"

  log "Dropping PostgreSQL database and role (${DB_NAME}/${DB_USER})..."
  as_postgres "psql -v ON_ERROR_STOP=1 -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db_lit}' AND pid <> pg_backend_pid();\"" >/dev/null 2>&1 || true
  as_postgres "psql -v ON_ERROR_STOP=1 -c \"DROP DATABASE IF EXISTS \\\"${db_ident}\\\";\"" >/dev/null 2>&1 || warn "Failed to drop database ${DB_NAME}."
  as_postgres "psql -v ON_ERROR_STOP=1 -c \"DROP ROLE IF EXISTS \\\"${user_ident}\\\";\"" >/dev/null 2>&1 || warn "Failed to drop role ${DB_USER}."
}

remove_install_tree() {
  log "Removing installed Catalyst app files..."
  rm -rf "$APP_ROOT" "$WEB_ROOT"
  if [ -d "$INSTALL_ROOT" ]; then
    rmdir "$INSTALL_ROOT" 2>/dev/null || true
  fi
}

remove_config_files() {
  log "Removing Catalyst configuration files..."
  rm -f "$ENV_FILE" "$STATE_FILE" "$SUMMARY_FILE" "$SFTP_HOST_KEY"
  rmdir "$ENV_DIR" 2>/dev/null || true
}

remove_data_files() {
  if [ "$PURGE_DATA" = false ]; then
    log "Keeping /var/lib/catalyst and /var/log/catalyst (use --purge-data to remove them)."
    return
  fi

  log "Removing Catalyst runtime data..."
  rm -rf /var/lib/catalyst /var/log/catalyst
}

remove_catalyst_user_group() {
  if id -u "$CATALYST_USER" >/dev/null 2>&1; then
    log "Removing ${CATALYST_USER} user..."
    userdel "$CATALYST_USER" >/dev/null 2>&1 || warn "Could not remove user ${CATALYST_USER}."
  fi

  if command -v getent >/dev/null 2>&1 && getent group "$CATALYST_GROUP" >/dev/null 2>&1; then
    log "Removing ${CATALYST_GROUP} group..."
    groupdel "$CATALYST_GROUP" >/dev/null 2>&1 || warn "Could not remove group ${CATALYST_GROUP}."
  fi
}

remove_firewall_rules() {
  if [ "$REMOVE_FIREWALL_RULES" = false ]; then
    return
  fi

  log "Removing firewall rules for HTTP/HTTPS..."
  if command -v ufw >/dev/null 2>&1; then
    ufw delete allow 80/tcp >/dev/null 2>&1 || true
    ufw delete allow 443/tcp >/dev/null 2>&1 || true
  fi
  if command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --remove-service=http >/dev/null 2>&1 || true
    firewall-cmd --permanent --remove-service=https >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
}

main() {
  parse_args "$@"
  detect_init_system
  load_database_details
  confirm_uninstall

  cleanup_backend_services
  cleanup_dependency_containers
  cleanup_caddy
  drop_database
  remove_install_tree
  remove_config_files
  remove_data_files
  remove_catalyst_user_group
  remove_firewall_rules

  log "Uninstall complete."
}

main "$@"
