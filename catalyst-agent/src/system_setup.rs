use std::fs;
use std::path::Path;
use std::process::Command;
use tracing::{error, info, warn};

use crate::AgentError;

pub struct SystemSetup;

impl SystemSetup {
    /// Initialize the system with all required dependencies
    pub async fn initialize() -> Result<(), AgentError> {
        info!("🚀 Starting system initialization...");

        // 1. Detect package manager
        let pkg_manager = Self::detect_package_manager()?;
        info!("✓ Detected package manager: {}", pkg_manager);

        // 2. Check and install containerd/nerdctl
        Self::ensure_container_runtime(&pkg_manager).await?;

        // 3. Ensure IP tooling is available (iproute2)
        Self::ensure_iproute(&pkg_manager).await?;

        // 4. Setup CNI networking only (static host-local IPAM)
        Self::setup_cni_static_networking().await?;

        info!("✅ System initialization complete!");
        Ok(())
    }

    /// Detect the system's package manager
    fn detect_package_manager() -> Result<String, AgentError> {
        let managers = vec![
            ("apk", "apk"),
            ("apt-get", "apt"),
            ("yum", "yum"),
            ("dnf", "dnf"),
            ("pacman", "pacman"),
            ("zypper", "zypper"),
        ];

        for (cmd, name) in managers {
            if Command::new("which")
                .arg(cmd)
                .output()
                .map_err(|e| AgentError::IoError(format!("Failed to detect package manager: {}", e)))?
                .status
                .success()
            {
                return Ok(name.to_string());
            }
        }

        Err(AgentError::InternalError(
            "No supported package manager found".to_string(),
        ))
    }

    /// Ensure container runtime is installed
    async fn ensure_container_runtime(pkg_manager: &str) -> Result<(), AgentError> {
        // Check if nerdctl exists
        if Command::new("which")
            .arg("nerdctl")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check nerdctl: {}", e)))?
            .status
            .success()
        {
            info!("✓ nerdctl already installed");
            return Ok(());
        }

        warn!("Container runtime not found, installing...");

        match pkg_manager {
            "apk" => {
                Self::run_command("apk", &["add", "--no-cache", "containerd"], None)?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"], None)?;
                Self::run_command("apt-get", &["install", "-y", "-qq", "containerd"], None)?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "containerd"], None)?;
            }
            "pacman" => {
                Self::run_command("pacman", &["-S", "--noconfirm", "containerd"], None)?;
            }
            "zypper" => {
                Self::run_command("zypper", &["--non-interactive", "install", "containerd"], None)?;
            }
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(AgentError::InternalError(format!(
                    "Please install containerd/nerdctl manually for {}",
                    pkg_manager
                )));
            }
        }

        // Install nerdctl if not bundled
        if !Command::new("which")
            .arg("nerdctl")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check nerdctl: {}", e)))?
            .status
            .success()
        {
            warn!("Installing nerdctl...");
            Self::ensure_download_tools(pkg_manager).await?;
            Self::install_nerdctl().await?;
        }

        info!("✓ Container runtime installed");
        Ok(())
    }

    /// Ensure `ip` command is available
    async fn ensure_iproute(pkg_manager: &str) -> Result<(), AgentError> {
        if Command::new("which")
            .arg("ip")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check ip: {}", e)))?
            .status
            .success()
        {
            info!("✓ ip already installed");
            return Ok(());
        }

        warn!("ip command not found, installing iproute package...");

        match pkg_manager {
            "apk" => {
                Self::run_command("apk", &["add", "--no-cache", "iproute2"], None)?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"], None)?;
                Self::run_command("apt-get", &["install", "-y", "-qq", "iproute2"], None)?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "iproute"], None)?;
            }
            "pacman" => {
                Self::run_command("pacman", &["-S", "--noconfirm", "iproute2"], None)?;
            }
            "zypper" => {
                Self::run_command("zypper", &["--non-interactive", "install", "iproute2"], None)?;
            }
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(AgentError::InternalError(format!(
                    "Please install iproute2 manually for {}",
                    pkg_manager
                )));
            }
        }

        info!("✓ ip installed");
        Ok(())
    }

    /// Ensure download/extract tools are available
    async fn ensure_download_tools(pkg_manager: &str) -> Result<(), AgentError> {
        let has_curl = Command::new("which")
            .arg("curl")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check curl: {}", e)))?
            .status
            .success();
        let has_tar = Command::new("which")
            .arg("tar")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check tar: {}", e)))?
            .status
            .success();
        let has_gzip = Command::new("which")
            .arg("gzip")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check gzip: {}", e)))?
            .status
            .success();

        if has_curl && has_tar && has_gzip {
            info!("✓ Download tools already installed");
            return Ok(());
        }

        warn!("Download tools missing, installing...");

        match pkg_manager {
            "apk" => {
                Self::run_command("apk", &["add", "--no-cache", "curl", "tar", "gzip"], None)?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"], None)?;
                Self::run_command("apt-get", &["install", "-y", "-qq", "curl", "tar", "gzip"], None)?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "curl", "tar", "gzip"], None)?;
            }
            "pacman" => {
                Self::run_command("pacman", &["-S", "--noconfirm", "curl", "tar", "gzip"], None)?;
            }
            "zypper" => {
                Self::run_command(
                    "zypper",
                    &["--non-interactive", "install", "curl", "tar", "gzip"],
                    None,
                )?;
            }
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(AgentError::InternalError(format!(
                    "Please install curl, tar, and gzip manually for {}",
                    pkg_manager
                )));
            }
        }

        info!("✓ Download tools installed");
        Ok(())
    }

    /// Install nerdctl from GitHub releases
    async fn install_nerdctl() -> Result<(), AgentError> {
        let arch = match std::env::consts::ARCH {
            "x86_64" => "amd64",
            "aarch64" => "arm64",
            other => other,
        };
        let version = "1.7.6"; // Update as needed
        let checksum = match arch {
            "amd64" => "2f8992aef6a80d2e0cdd06c6c8f47d7d9e1c17b3ad2f0fbb7f2e8b4d29506f72",
            "arm64" => "b30d7c3b7eb2f5a8a9fa0c5c2b9d0bd235897d704540b2c8d7f2f1c7a2ff8e1a",
            _ => {
                return Err(AgentError::InternalError(format!(
                    "Unsupported architecture for nerdctl install: {}",
                    arch
                )));
            }
        };

        let url = format!(
            "https://github.com/containerd/nerdctl/releases/download/v{}/nerdctl-{}-linux-{}.tar.gz",
            version, version, arch
        );

        info!("Downloading nerdctl from {}", url);

        let archive_path = format!("/tmp/nerdctl-{}-linux-{}.tar.gz", version, arch);
        Self::run_command("curl", &["-fsSL", "-o", &archive_path, &url], None)?;
        let verify_cmd = format!("{}  {}", checksum, archive_path);
        Self::run_command("sha256sum", &["-c", "--strict", "-"], Some(&verify_cmd))?;
        Self::run_command(
            "tar",
            &["-xz", "-C", "/usr/local/bin", "nerdctl", "-f", &archive_path],
            None,
        )?;
        let _ = fs::remove_file(&archive_path);

        Ok(())
    }

    /// Setup CNI networking with macvlan and host-local IPAM (static IPs)
    async fn setup_cni_static_networking() -> Result<(), AgentError> {
        let cni_dir = "/etc/cni/net.d";
        let cni_config = format!("{}/mc-lan-static.conflist", cni_dir);

        // Create CNI directory if it doesn't exist
        fs::create_dir_all(cni_dir)
            .map_err(|e| AgentError::IoError(format!("Failed to create CNI dir: {}", e)))?;

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

        fs::write(&cni_config, config)
            .map_err(|e| AgentError::IoError(format!("Failed to write CNI config: {}", e)))?;
        info!(
            "✓ Created CNI static network configuration at {}",
            cni_config
        );

        Ok(())
    }

    /// Detect the primary network interface
    fn detect_network_interface() -> Result<String, AgentError> {
        // Try to get default route interface
        let output = Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect default route: {}", e)))?;

        if output.status.success() {
            let interface = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    while let Some(part) = parts.next() {
                        if part == "dev" {
                            return parts.next().map(|name| name.to_string());
                        }
                    }
                    None
                })
                .unwrap_or_default();
            if !interface.is_empty() {
                return Ok(interface);
            }
        }

        // Fallback: find first non-loopback interface
        let output = Command::new("ip")
            .args(["-o", "link", "show"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect interfaces: {}", e)))?;

        if output.status.success() {
            let interface = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split(':');
                    let _idx = parts.next()?;
                    let name = parts.next()?.trim().to_string();
                    if name == "lo" {
                        None
                    } else {
                        Some(name)
                    }
                })
                .unwrap_or_default();
            if !interface.is_empty() {
                return Ok(interface);
            }
        }

        Err(AgentError::InternalError(
            "Could not detect network interface".to_string(),
        ))
    }

    fn detect_default_gateway() -> Result<String, AgentError> {
        let output = Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect default gateway: {}", e)))?;

        if output.status.success() {
            let gateway = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    while let Some(part) = parts.next() {
                        if part == "via" {
                            return parts.next().map(|value| value.to_string());
                        }
                    }
                    None
                })
                .unwrap_or_default();
            if !gateway.is_empty() {
                return Ok(gateway);
            }
        }

        Err(AgentError::InternalError(
            "Could not detect default gateway".to_string(),
        ))
    }

    fn detect_interface_cidr(interface: &str) -> Result<String, AgentError> {
        let output = Command::new("ip")
            .args(["-4", "addr", "show", "dev", interface])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect interface CIDR: {}", e)))?;

        if output.status.success() {
            let cidr = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    while let Some(part) = parts.next() {
                        if part == "inet" {
                            return parts.next().map(|value| value.to_string());
                        }
                    }
                    None
                })
                .unwrap_or_default();
            if !cidr.is_empty() {
                return Self::normalize_cidr(&cidr);
            }
        }

        Err(AgentError::InternalError(
            "Could not detect interface CIDR".to_string(),
        ))
    }

    fn normalize_cidr(cidr: &str) -> Result<String, AgentError> {
        let (addr_str, prefix_str) = cidr
            .split_once('/')
            .ok_or_else(|| AgentError::InvalidRequest("Invalid CIDR format".to_string()))?;
        let prefix: u32 = prefix_str
            .parse()
            .map_err(|_| AgentError::InvalidRequest("Invalid CIDR prefix".to_string()))?;
        if prefix > 32 {
            return Err(AgentError::InvalidRequest("Invalid CIDR prefix".to_string()));
        }

        let addr: std::net::Ipv4Addr = addr_str
            .parse()
            .map_err(|_| AgentError::InvalidRequest("Invalid CIDR address".to_string()))?;
        let addr_u32 = u32::from(addr);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = addr_u32 & mask;
        Ok(format!("{}/{}", std::net::Ipv4Addr::from(network), prefix))
    }

    fn cidr_usable_range(cidr: &str) -> Result<(String, String), AgentError> {
        let (addr_str, prefix_str) = cidr
            .split_once('/')
            .ok_or_else(|| AgentError::InvalidRequest("Invalid CIDR format".to_string()))?;
        let prefix: u32 = prefix_str
            .parse()
            .map_err(|_| AgentError::InvalidRequest("Invalid CIDR prefix".to_string()))?;
        if prefix > 32 {
            return Err(AgentError::InvalidRequest("Invalid CIDR prefix".to_string()));
        }

        let addr: std::net::Ipv4Addr = addr_str
            .parse()
            .map_err(|_| AgentError::InvalidRequest("Invalid CIDR address".to_string()))?;
        let addr_u32 = u32::from(addr);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = addr_u32 & mask;
        let broadcast = network | (!mask);

        if broadcast <= network + 1 {
            return Err(AgentError::InvalidRequest(
                "CIDR has no usable addresses".to_string(),
            ));
        }

        let start = network + 1;
        let end = broadcast - 1;
        Ok((
            std::net::Ipv4Addr::from(start).to_string(),
            std::net::Ipv4Addr::from(end).to_string(),
        ))
    }


    /// Helper to run a command and check for errors
    fn run_command(
        cmd: &str,
        args: &[&str],
        stdin: Option<&str>,
    ) -> Result<(), AgentError> {
        let mut command = Command::new(cmd);
        command.args(args);
        if stdin.is_some() {
            command.stdin(std::process::Stdio::piped());
        }
        let mut child = command
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to run {}: {}", cmd, e)))?;
        if let Some(input) = stdin {
            if let Some(mut handle) = child.stdin.take() {
                use std::io::Write;
                handle
                    .write_all(input.as_bytes())
                    .map_err(|e| AgentError::IoError(format!("Failed to write to {}: {}", cmd, e)))?;
            }
        }
        let output = child
            .wait_with_output()
            .map_err(|e| AgentError::IoError(format!("Failed to run {}: {}", cmd, e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Command failed: {} {}\n{}", cmd, args.join(" "), stderr);
            return Err(AgentError::IoError(format!("Command failed: {}", stderr)));
        }

        Ok(())
    }
}
