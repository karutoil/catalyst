#!/bin/bash

# Test System Setup - Verifies automatic initialization
# This simulates a fresh node setup

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║  SYSTEM SETUP TEST - AUTOMATIC INITIALIZATION             ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check functions
check_command() {
    local cmd=$1
    local name=$2
    
    if command -v "$cmd" &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} $name installed: $(which $cmd)"
        return 0
    else
        echo -e "  ${RED}✗${NC} $name NOT found"
        return 1
    fi
}

check_file() {
    local file=$1
    local name=$2
    
    if [ -f "$file" ]; then
        echo -e "  ${GREEN}✓${NC} $name exists: $file"
        return 0
    else
        echo -e "  ${YELLOW}⚠${NC} $name missing: $file"
        return 1
    fi
}

check_daemon() {
    local process=$1
    local name=$2
    
    if pgrep -f "$process" > /dev/null; then
        echo -e "  ${GREEN}✓${NC} $name is running (PID: $(pgrep -f "$process" | head -1))"
        return 0
    else
        echo -e "  ${RED}✗${NC} $name NOT running"
        return 1
    fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Pre-Setup Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "System Information:"
echo "  OS: $(uname -s)"
echo "  Arch: $(uname -m)"
echo "  Kernel: $(uname -r)"
echo ""

echo "Current State:"
check_command "nerdctl" "nerdctl" || true
check_file "/opt/cni/bin/dhcp" "CNI DHCP plugin" || true
check_file "/etc/cni/net.d/mc-lan.conflist" "CNI network config" || true
check_daemon "dhcp daemon" "DHCP daemon" || true
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Running Agent Initialization"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run agent (it will initialize and then try to connect)
# We'll kill it after initialization
timeout 10 /root/catalyst3/aero-agent/target/release/aero-agent || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-Setup Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PASS=0
TOTAL=0

echo "Container Runtime:"
((TOTAL++))
if check_command "nerdctl" "nerdctl"; then ((PASS++)); fi
echo ""

echo "CNI Plugins:"
((TOTAL++))
if check_file "/opt/cni/bin/dhcp" "CNI DHCP plugin"; then ((PASS++)); fi
((TOTAL++))
if check_file "/opt/cni/bin/bridge" "CNI bridge plugin"; then ((PASS++)); fi
((TOTAL++))
if check_file "/opt/cni/bin/macvlan" "CNI macvlan plugin"; then ((PASS++)); fi
echo ""

echo "Network Configuration:"
((TOTAL++))
if check_file "/etc/cni/net.d/mc-lan.conflist" "macvlan network config"; then
    ((PASS++))
    echo ""
    echo "  Network config content:"
    cat /etc/cni/net.d/mc-lan.conflist | sed 's/^/    /'
fi
echo ""

echo "DHCP Daemon:"
((TOTAL++))
if check_daemon "dhcp daemon" "CNI DHCP daemon"; then
    ((PASS++))
    echo "  Socket: /run/cni/dhcp.sock"
    ls -l /run/cni/dhcp.sock 2>/dev/null | sed 's/^/    /' || true
fi
echo ""

# Check systemd service if available
if command -v systemctl &> /dev/null; then
    echo "Systemd Service:"
    ((TOTAL++))
    if systemctl is-enabled cni-dhcp.service &> /dev/null; then
        ((PASS++))
        echo -e "  ${GREEN}✓${NC} cni-dhcp.service enabled"
        systemctl status cni-dhcp.service --no-pager | head -5 | sed 's/^/    /'
    else
        echo -e "  ${YELLOW}⚠${NC} cni-dhcp.service not enabled (daemon running manually)"
    fi
    echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Checks Passed: $PASS / $TOTAL"
echo ""

if [ $PASS -eq $TOTAL ]; then
    echo -e "${GREEN}✅ System fully initialized and ready!${NC}"
    exit 0
elif [ $PASS -ge 5 ]; then
    echo -e "${YELLOW}⚠ System partially initialized (manual setup may be needed)${NC}"
    exit 0
else
    echo -e "${RED}❌ System initialization incomplete${NC}"
    exit 1
fi
