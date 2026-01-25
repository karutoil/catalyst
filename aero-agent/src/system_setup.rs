use std::fs;
use std::path::Path;
use std::process::Command;
use tracing::{error, info, warn};

pub struct SystemSetup;

impl SystemSetup {
    /// Initialize the system with all required dependencies
    pub async fn initialize() -> Result<(), Box<dyn std::error::Error>> {
        info!("🚀 Starting system initialization...");

        // 1. Detect package manager
        let pkg_manager = Self::detect_package_manager()?;
        info!("✓ Detected package manager: {}", pkg_manager);

        // 2. Check and install containerd/nerdctl
        Self::ensure_container_runtime(&pkg_manager).await?;

        // 3. Ensure IP tooling is available (iproute2)
        Self::ensure_iproute(&pkg_manager).await?;

        // 4. Setup CNI networking
        Self::setup_cni_networking().await?;
        Self::setup_cni_static_networking().await?;

        // 5. Start DHCP daemon
        Self::ensure_dhcp_daemon().await?;

        info!("✅ System initialization complete!");
        Ok(())
    }

    /// Detect the system's package manager
    fn detect_package_manager() -> Result<String, Box<dyn std::error::Error>> {
        let managers = vec![
            ("apk", "apk"),
            ("apt-get", "apt"),
            ("yum", "yum"),
            ("dnf", "dnf"),
            ("pacman", "pacman"),
            ("zypper", "zypper"),
        ];

        for (cmd, name) in managers {
            if Command::new("which").arg(cmd).output()?.status.success() {
                return Ok(name.to_string());
            }
        }

        Err("No supported package manager found".into())
    }

    /// Ensure container runtime is installed
    async fn ensure_container_runtime(pkg_manager: &str) -> Result<(), Box<dyn std::error::Error>> {
        // Check if nerdctl exists
        if Command::new("which")
            .arg("nerdctl")
            .output()?
            .status
            .success()
        {
            info!("✓ nerdctl already installed");
            return Ok(());
        }

        warn!("Container runtime not found, installing...");

        match pkg_manager {
            "apk" => {
                Self::run_command("apk", &["add", "--no-cache", "containerd"])?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"])?;
                Self::run_command("apt-get", &["install", "-y", "-qq", "containerd"])?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "containerd"])?;
            }
            "pacman" => {
                Self::run_command("pacman", &["-S", "--noconfirm", "containerd"])?;
            }
            "zypper" => {
                Self::run_command("zypper", &["--non-interactive", "install", "containerd"])?;
            }
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(format!(
                    "Please install containerd/nerdctl manually for {}",
                    pkg_manager
                )
                .into());
            }
        }

        // Install nerdctl if not bundled
        if !Command::new("which")
            .arg("nerdctl")
            .output()?
            .status
            .success()
        {
            warn!("Installing nerdctl...");
            Self::install_nerdctl().await?;
        }

        info!("✓ Container runtime installed");
        Ok(())
    }

    /// Ensure `ip` command is available
    async fn ensure_iproute(pkg_manager: &str) -> Result<(), Box<dyn std::error::Error>> {
        if Command::new("which").arg("ip").output()?.status.success() {
            info!("✓ ip already installed");
            return Ok(());
        }

        warn!("ip command not found, installing iproute package...");

        match pkg_manager {
            "apk" => {
                Self::run_command("apk", &["add", "--no-cache", "iproute2"])?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"])?;
                Self::run_command("apt-get", &["install", "-y", "-qq", "iproute2"])?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "iproute"])?;
            }
            "pacman" => {
                Self::run_command("pacman", &["-S", "--noconfirm", "iproute2"])?;
            }
            "zypper" => {
                Self::run_command("zypper", &["--non-interactive", "install", "iproute2"])?;
            }
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(format!("Please install iproute2 manually for {}", pkg_manager).into());
            }
        }

        info!("✓ ip installed");
        Ok(())
    }

    /// Install nerdctl from GitHub releases
    async fn install_nerdctl() -> Result<(), Box<dyn std::error::Error>> {
        let arch = std::env::consts::ARCH;
        let version = "1.7.6"; // Update as needed

        let url = format!(
            "https://github.com/containerd/nerdctl/releases/download/v{}/nerdctl-{}-linux-{}.tar.gz",
            version, version, arch
        );

        info!("Downloading nerdctl from {}", url);

        // Download and extract
        Self::run_command(
            "sh",
            &[
                "-c",
                &format!("curl -fsSL {} | tar -xz -C /usr/local/bin nerdctl", url),
            ],
        )?;

        Ok(())
    }

    /// Setup CNI networking with macvlan and DHCP
    async fn setup_cni_networking() -> Result<(), Box<dyn std::error::Error>> {
        let cni_dir = "/etc/cni/net.d";
        let cni_config = format!("{}/mc-lan.conflist", cni_dir);

        // Create CNI directory if it doesn't exist
        fs::create_dir_all(cni_dir)?;

        // Detect the primary network interface
        let interface = Self::detect_network_interface()?;
        info!("Detected network interface: {}", interface);

        // Check if config already exists for this interface
        if Path::new(&cni_config).exists() {
            let existing = fs::read_to_string(&cni_config).unwrap_or_default();
            if existing.contains(&format!("\"master\": \"{}\"", interface)) {
                info!("✓ CNI network configuration already exists");
                return Ok(());
            }
            info!("CNI config exists but uses a different interface; rewriting");
        }

        // Create macvlan network configuration
        let config = format!(
            r#"{{
  "cniVersion": "1.0.0",
  "name": "mc-lan",
  "plugins": [
    {{
      "type": "macvlan",
      "master": "{}",
      "mode": "bridge",
      "ipam": {{
        "type": "dhcp"
      }}
    }}
  ]
}}"#,
            interface
        );

        fs::write(&cni_config, config)?;
        info!("✓ Created CNI network configuration at {}", cni_config);

        Ok(())
    }

    /// Setup CNI networking with macvlan and host-local IPAM (static IPs)
    async fn setup_cni_static_networking() -> Result<(), Box<dyn std::error::Error>> {
        let cni_dir = "/etc/cni/net.d";
        let cni_config = format!("{}/mc-lan-static.conflist", cni_dir);

        // Create CNI directory if it doesn't exist
        fs::create_dir_all(cni_dir)?;

        // Check if config already exists
        if Path::new(&cni_config).exists() {
            info!("✓ CNI static network configuration already exists");
            return Ok(());
        }

        // Detect the primary network interface
        let interface = Self::detect_network_interface()?;
        info!("Detected network interface: {}", interface);

        let gateway = Self::detect_default_gateway()?;
        let cidr = Self::detect_interface_cidr(&interface)?;
        let (range_start, range_end) = Self::cidr_usable_range(&cidr)?;

        // Create macvlan network configuration (host-local IPAM)
        let config = format!(
            r#"{{
  "cniVersion": "1.0.0",
  "name": "mc-lan-static",
  "plugins": [
    {{
      "type": "macvlan",
      "master": "{}",
      "mode": "bridge",
      "ipam": {{
        "type": "host-local",
        "ranges": [[
          {{
            "subnet": "{}",
            "rangeStart": "{}",
            "rangeEnd": "{}",
            "gateway": "{}"
          }}
        ]],
        "routes": [
          {{ "dst": "0.0.0.0/0" }}
        ]
      }}
    }}
  ]
}}"#,
            interface, cidr, range_start, range_end, gateway
        );

        fs::write(&cni_config, config)?;
        info!(
            "✓ Created CNI static network configuration at {}",
            cni_config
        );

        Ok(())
    }

    /// Detect the primary network interface
    fn detect_network_interface() -> Result<String, Box<dyn std::error::Error>> {
        // Try to get default route interface
        let output = Command::new("sh")
            .arg("-c")
            .arg("ip route show default | awk '/default/ {print $5}' | head -n1")
            .output()?;

        if output.status.success() {
            let interface = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !interface.is_empty() {
                return Ok(interface);
            }
        }

        // Fallback: find first non-loopback interface
        let output = Command::new("sh")
            .arg("-c")
            .arg("ip link show | awk -F: '/^[0-9]+: [^lo]/ {print $2}' | head -n1 | xargs")
            .output()?;

        if output.status.success() {
            let interface = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !interface.is_empty() {
                return Ok(interface);
            }
        }

        Err("Could not detect network interface".into())
    }

    fn detect_default_gateway() -> Result<String, Box<dyn std::error::Error>> {
        let output = Command::new("sh")
            .arg("-c")
            .arg("ip route show default | awk '/default/ {print $3}' | head -n1")
            .output()?;

        if output.status.success() {
            let gateway = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !gateway.is_empty() {
                return Ok(gateway);
            }
        }

        Err("Could not detect default gateway".into())
    }

    fn detect_interface_cidr(interface: &str) -> Result<String, Box<dyn std::error::Error>> {
        let output = Command::new("sh")
            .arg("-c")
            .arg(format!(
                "ip -4 addr show dev {} | awk '/inet / {{print $2}}' | head -n1",
                interface
            ))
            .output()?;

        if output.status.success() {
            let cidr = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !cidr.is_empty() {
                return Self::normalize_cidr(&cidr);
            }
        }

        Err("Could not detect interface CIDR".into())
    }

    fn normalize_cidr(cidr: &str) -> Result<String, Box<dyn std::error::Error>> {
        let (addr_str, prefix_str) = cidr.split_once('/').ok_or("Invalid CIDR format")?;
        let prefix: u32 = prefix_str.parse()?;
        if prefix > 32 {
            return Err("Invalid CIDR prefix".into());
        }

        let addr: std::net::Ipv4Addr = addr_str.parse()?;
        let addr_u32 = u32::from(addr);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = addr_u32 & mask;
        Ok(format!("{}/{}", std::net::Ipv4Addr::from(network), prefix))
    }

    fn cidr_usable_range(cidr: &str) -> Result<(String, String), Box<dyn std::error::Error>> {
        let (addr_str, prefix_str) = cidr.split_once('/').ok_or("Invalid CIDR format")?;
        let prefix: u32 = prefix_str.parse()?;
        if prefix > 32 {
            return Err("Invalid CIDR prefix".into());
        }

        let addr: std::net::Ipv4Addr = addr_str.parse()?;
        let addr_u32 = u32::from(addr);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = addr_u32 & mask;
        let broadcast = network | (!mask);

        if broadcast <= network + 1 {
            return Err("CIDR has no usable addresses".into());
        }

        let start = network + 1;
        let end = broadcast - 1;
        Ok((
            std::net::Ipv4Addr::from(start).to_string(),
            std::net::Ipv4Addr::from(end).to_string(),
        ))
    }

    /// Ensure CNI DHCP daemon is running
    async fn ensure_dhcp_daemon() -> Result<(), Box<dyn std::error::Error>> {
        let dhcp_bin = "/opt/cni/bin/dhcp";

        // Check if daemon is already running
        if Self::is_dhcp_daemon_running() {
            info!("✓ CNI DHCP daemon already running");
            return Ok(());
        }

        // Check if DHCP binary exists
        if !Path::new(dhcp_bin).exists() {
            warn!("CNI DHCP plugin not found, attempting to install...");
            Self::install_cni_plugins().await?;
        }

        // Try to enable systemd service if available
        if Self::setup_dhcp_systemd_service().is_ok() {
            info!("✓ CNI DHCP daemon configured as systemd service");
            return Ok(());
        }

        // Fallback: Start the DHCP daemon directly
        info!("Starting CNI DHCP daemon...");

        Command::new(dhcp_bin).arg("daemon").spawn()?;

        // Wait a bit for daemon to start
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        if Self::is_dhcp_daemon_running() {
            info!("✓ CNI DHCP daemon started successfully");
        } else {
            error!("Failed to start CNI DHCP daemon");
            return Err("DHCP daemon failed to start".into());
        }

        Ok(())
    }

    /// Setup systemd service for DHCP daemon
    fn setup_dhcp_systemd_service() -> Result<(), Box<dyn std::error::Error>> {
        // Check if systemd is available
        if !Command::new("which")
            .arg("systemctl")
            .output()?
            .status
            .success()
        {
            return Err("systemd not available".into());
        }

        let service_content = r#"[Unit]
Description=CNI DHCP Daemon for Container Networking
Documentation=https://github.com/containernetworking/plugins
After=network.target

[Service]
Type=simple
ExecStart=/opt/cni/bin/dhcp daemon
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"#;

        // Write service file
        fs::write("/etc/systemd/system/cni-dhcp.service", service_content)?;

        // Reload systemd
        Self::run_command("systemctl", &["daemon-reload"])?;

        // Enable and start service
        Self::run_command("systemctl", &["enable", "cni-dhcp.service"])?;
        Self::run_command("systemctl", &["start", "cni-dhcp.service"])?;

        info!("✓ CNI DHCP systemd service enabled and started");
        Ok(())
    }

    /// Check if DHCP daemon is running
    fn is_dhcp_daemon_running() -> bool {
        Command::new("pgrep")
            .arg("-f")
            .arg("dhcp daemon")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Install CNI plugins
    async fn install_cni_plugins() -> Result<(), Box<dyn std::error::Error>> {
        let version = "v1.4.1"; // Update as needed
        let arch = std::env::consts::ARCH;

        let url = format!(
            "https://github.com/containernetworking/plugins/releases/download/{}/cni-plugins-linux-{}-{}.tgz",
            version, arch, version
        );

        info!("Installing CNI plugins from {}", url);

        fs::create_dir_all("/opt/cni/bin")?;

        Self::run_command(
            "sh",
            &[
                "-c",
                &format!("curl -fsSL {} | tar -xz -C /opt/cni/bin", url),
            ],
        )?;

        info!("✓ CNI plugins installed");
        Ok(())
    }

    /// Helper to run a command and check for errors
    fn run_command(cmd: &str, args: &[&str]) -> Result<(), Box<dyn std::error::Error>> {
        let output = Command::new(cmd).args(args).output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Command failed: {} {}\n{}", cmd, args.join(" "), stderr);
            return Err(format!("Command failed: {}", stderr).into());
        }

        Ok(())
    }
}
