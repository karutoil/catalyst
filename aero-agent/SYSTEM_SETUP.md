# Aero Agent System Setup

## Overview

The Aero Agent now includes **automatic system initialization** that configures all required dependencies and networking on first run. This eliminates manual setup steps and makes node deployment fully automated.

## What Gets Configured Automatically

When the agent starts, it automatically:

### 1. **Container Runtime**
- Detects system package manager (apt, yum, dnf, pacman, zypper)
- Installs `containerd` if not present
- Downloads and installs `nerdctl` from GitHub releases
- Verifies installation and readiness

### 2. **CNI Networking**
- Creates `/etc/cni/net.d/` directory structure
- Detects primary network interface automatically
- Generates `mc-lan.conflist` for macvlan networking
- Configures DHCP IPAM for dynamic IP allocation

### 3. **CNI Plugins**
- Downloads CNI plugins bundle from GitHub
- Extracts to `/opt/cni/bin/`
- Includes: bridge, macvlan, dhcp, host-local, etc.

### 4. **DHCP Daemon**
- Starts CNI DHCP daemon for container IP management
- Creates systemd service (if systemd available)
- Enables auto-start on system boot
- Falls back to manual daemon start if needed

## Network Configuration

The agent creates a **macvlan network** with the following characteristics:

```json
{
  "cniVersion": "1.0.0",
  "name": "mc-lan",
  "plugins": [
    {
      "type": "macvlan",
      "master": "<detected-interface>",
      "mode": "bridge",
      "ipam": {
        "type": "dhcp"
      }
    }
  ]
}
```

### Interface Detection

The agent automatically detects your primary network interface using:
1. Default route interface (via `ip route`)
2. Fallback to first non-loopback interface

### Network Modes

Containers can use different networking modes:

| Mode | Description | IP Range | Use Case |
|------|-------------|----------|----------|
| `bridge` | Isolated network | 10.4.0.x | Testing, development |
| `mc-lan` | **LAN network with DHCP** | **192.168.1.x** | **Production game servers** |
| `host` | Host networking | Host IP | Low latency required |

## Installation on Fresh Node

### Prerequisites

- Linux system (Debian, Ubuntu, CentOS, Fedora, Arch, etc.)
- Network connectivity
- Root/sudo access

### Steps

1. **Build or download the agent binary**
   ```bash
   cd aero-agent
   cargo build --release
   ```

2. **Copy agent to node**
   ```bash
   scp target/release/aero-agent user@node:/usr/local/bin/
   ```

3. **Run the agent** - It handles everything else automatically!
   ```bash
   sudo /usr/local/bin/aero-agent
   ```

On first run, the agent will:
- Detect your system
- Install missing dependencies
- Configure networking
- Start services
- Connect to backend

### What Happens Behind the Scenes

```
🚀 Starting system initialization...
✓ Detected package manager: apt
✓ Container runtime installed
✓ Detected network interface: enp34s0
✓ Created CNI network configuration at /etc/cni/net.d/mc-lan.conflist
✓ CNI plugins installed
✓ CNI DHCP systemd service enabled and started
✅ System initialization complete!
```

## Systemd Service

The agent creates `/etc/systemd/system/cni-dhcp.service`:

```ini
[Unit]
Description=CNI DHCP Daemon for Container Networking
After=network.target

[Service]
Type=simple
ExecStart=/opt/cni/bin/dhcp daemon
Restart=always

[Install]
WantedBy=multi-user.target
```

This ensures the DHCP daemon starts automatically on boot.

## Testing

Use the provided test script to verify setup:

```bash
./tests/19-system-setup.test.sh
```

This checks:
- ✓ nerdctl installation
- ✓ CNI plugins present
- ✓ Network configuration created
- ✓ DHCP daemon running
- ✓ Systemd service enabled

## Troubleshooting

### DHCP Daemon Not Starting

Check if the daemon is running:
```bash
ps aux | grep "dhcp daemon"
```

Check systemd service status:
```bash
systemctl status cni-dhcp.service
```

Manually start if needed:
```bash
/opt/cni/bin/dhcp daemon &
```

### Network Interface Detection Failed

Manually specify interface in config:
```toml
[network]
interface = "eth0"  # Your interface name
```

Check available interfaces:
```bash
ip link show
```

### CNI Plugins Missing

Manually install:
```bash
mkdir -p /opt/cni/bin
curl -fsSL https://github.com/containernetworking/plugins/releases/download/v1.4.1/cni-plugins-linux-amd64-v1.4.1.tgz | \
  tar -xz -C /opt/cni/bin
```

### Containers Not Getting IPs

1. Verify DHCP daemon is running
2. Check network config: `cat /etc/cni/net.d/mc-lan.conflist`
3. Test container creation: `nerdctl run --network mc-lan alpine ip addr`
4. Check DHCP socket: `ls -l /run/cni/dhcp.sock`

## Production Deployment

### Recommended Setup

1. **Provision node** (cloud or bare metal)
2. **Install agent binary**
3. **Set environment variables**:
   ```bash
   export BACKEND_WS_URL=wss://your-backend.com/ws
   export NODE_ID=<your-node-id>
   export NODE_TOKEN=<your-secret-token>
   ```
4. **Run agent** - It auto-configures everything
5. **Verify** with health check: `curl localhost:8080/health`

### Cloud Deployment

The auto-setup works seamlessly on:
- ✅ AWS EC2
- ✅ Google Cloud Compute
- ✅ Azure VMs
- ✅ DigitalOcean Droplets
- ✅ Hetzner Cloud
- ✅ Bare metal servers

### Docker/Container Deployment

If running the agent itself in a container (not recommended for production):
- Mount `/opt/cni/bin` as volume
- Mount `/etc/cni/net.d` as volume
- Use privileged mode for firewall configuration
- Host networking for DHCP daemon

## Security Considerations

- The agent requires root/sudo for:
  - Package installation
  - Network configuration
  - Firewall management
  - System service creation

- Ensure secure WebSocket connection (WSS)
- Use authentication tokens
- Restrict agent binary permissions: `chmod 750`

## Future Enhancements

Planned improvements:
- [ ] Custom network ranges via config
- [ ] Static IP pool management
- [ ] IPv6 support
- [ ] Multiple network configurations
- [ ] Health checks and auto-recovery
- [ ] Metrics collection for network usage

## Summary

The Aero Agent is now **fully autonomous** - just deploy the binary and it handles:
- ✅ Dependency installation
- ✅ Network configuration  
- ✅ Service management
- ✅ Container runtime setup

No manual intervention required! 🎉
