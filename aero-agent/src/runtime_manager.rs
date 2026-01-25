use std::sync::Arc;
use std::process::Stdio;
use tokio::process::Command;
use tokio::io::AsyncBufReadExt;
use tracing::{info, error, debug};
use serde_json::json;
use std::collections::HashMap;

use crate::errors::{AgentError, AgentResult};
use crate::firewall_manager::FirewallManager;

#[derive(Clone)]
pub struct ContainerdRuntime {
    socket_path: String,
    namespace: String,
}

impl ContainerdRuntime {
    pub fn new(socket_path: std::path::PathBuf, namespace: String) -> Self {
        Self {
            socket_path: socket_path.to_string_lossy().to_string(),
            namespace,
        }
    }

    /// Create and start a container
    pub async fn create_container(
        &self,
        container_id: &str,
        image: &str,
        startup_command: &str,
        env: &HashMap<String, String>,
        memory_mb: u64,
        cpu_cores: u64,
        data_dir: &str,
        port: u16,
        network_mode: Option<&str>,
    ) -> AgentResult<String> {
        info!(
            "Creating container: {} from image: {}",
            container_id, image
        );

        // Build nerdctl command
        let mut cmd = Command::new("nerdctl");
        cmd.arg("--namespace").arg(&self.namespace).arg("run");

        // Set resource limits
        cmd.arg(format!("--memory={}m", memory_mb));
        cmd.arg("--cpus").arg(&cpu_cores.to_string());

        // Volume mount (host data directory → /data in container)
        cmd.arg("-v").arg(format!("{}:/data", data_dir));
        
        // Working directory
        cmd.arg("-w").arg("/data");

        // Network mode
        if let Some(network) = network_mode {
            if network == "host" {
                cmd.arg("--network").arg("host");
            } else if network != "bridge" {
                // Assume it's a custom network name (e.g., "mc-lan" for macvlan)
                cmd.arg("--network").arg(network);
            }
            // "bridge" or no network specified = default bridge
        }

        // Port mapping (only if not using host network)
        if network_mode.is_none() || (network_mode.is_some() && network_mode.unwrap() != "host") {
            cmd.arg("-p").arg(format!("0.0.0.0:{}:{}", port, port));
        }

        // Set environment variables
        for (key, value) in env {
            cmd.arg("-e").arg(format!("{}={}", key, value));
        }

        // Container name and image
        cmd.arg("--name").arg(container_id);
        cmd.arg("-d"); // Detached
        cmd.arg(image);

        // Startup command (if provided)
        if !startup_command.is_empty() {
            // Parse as shell command
            cmd.arg("sh").arg("-c").arg(startup_command);
        }

        let output = cmd
            .output()
            .await
            .map_err(|e| AgentError::ContainerError(format!("Failed to create container: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Container creation failed: {}",
                stderr
            )));
        }

        let container_full_id = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_string();

        info!("Container created successfully: {}", container_full_id);
        
        // Get container IP for firewall configuration
        let container_ip = self.get_container_ip(container_id).await
            .unwrap_or_else(|_| "0.0.0.0".to_string());
        
        // Configure firewall to allow the port
        info!("Configuring firewall for port {} (container IP: {})", port, container_ip);
        if let Err(e) = FirewallManager::allow_port(port, &container_ip).await {
            error!("Failed to configure firewall: {}", e);
            // Don't fail container creation if firewall config fails
            // The container is already running, just log the error
        } else {
            info!("✓ Firewall configured for port {}", port);
        }
        
        Ok(container_full_id)
    }

    /// Start a container
    pub async fn start_container(&self, container_id: &str) -> AgentResult<()> {
        info!("Starting container: {}", container_id);

        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("start")
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to start container: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Stop a container gracefully
    pub async fn stop_container(&self, container_id: &str, timeout_secs: u64) -> AgentResult<()> {
        info!("Stopping container: {}", container_id);

        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("stop")
            .arg("-t")
            .arg(timeout_secs.to_string())
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to stop container: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Kill a container immediately
    pub async fn kill_container(&self, container_id: &str, signal: &str) -> AgentResult<()> {
        info!("Killing container: {} with signal {}", container_id, signal);

        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("kill")
            .arg("-s")
            .arg(signal)
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to kill container: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Remove a container
    pub async fn remove_container(&self, container_id: &str) -> AgentResult<()> {
        info!("Removing container: {}", container_id);

        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("rm")
            .arg("-f")
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to remove container: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Get container logs
    pub async fn get_logs(&self, container_id: &str, lines: Option<u32>) -> AgentResult<String> {
        let mut cmd = Command::new("nerdctl");
        cmd.arg("--namespace")
            .arg(&self.namespace)
            .arg("logs");

        if let Some(n) = lines {
            cmd.arg("--tail").arg(n.to_string());
        }

        cmd.arg(container_id);

        let output = cmd.output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to get logs: {}",
                stderr
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Stream container logs in real-time
    pub async fn stream_logs<F>(&self, container_id: &str, mut callback: F) -> AgentResult<()>
    where
        F: FnMut(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()>>>,
    {
        info!("Streaming logs for container: {}", container_id);

        let mut child = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("logs")
            .arg("-f")
            .arg(container_id)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentError::InternalError("Failed to capture stdout".to_string()))?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AgentError::InternalError("Failed to capture stderr".to_string()))?;

        let mut stdout_reader = tokio::io::BufReader::new(stdout).lines();
        let mut stderr_reader = tokio::io::BufReader::new(stderr).lines();

        loop {
            tokio::select! {
                line = stdout_reader.next_line() => {
                    match line? {
                        Some(l) => callback(l).await,
                        None => break,
                    }
                }
                line = stderr_reader.next_line() => {
                    match line? {
                        Some(l) => callback(l).await,
                        None => break,
                    }
                }
            }
        }

        Ok(())
    }

    /// List all containers
    pub async fn list_containers(&self) -> AgentResult<Vec<ContainerInfo>> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("ps")
            .arg("-a")
            .arg("--format")
            .arg("json")
            .output()
            .await?;

        if !output.status.success() {
            return Err(AgentError::ContainerError(
                "Failed to list containers".to_string(),
            ));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        
        // nerdctl returns newline-delimited JSON, parse each line
        let mut containers = Vec::new();
        for line in json_output.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let container: ContainerInfo = serde_json::from_str(line)?;
            containers.push(container);
        }

        Ok(containers)
    }

    /// Get container stats
    pub async fn get_stats(&self, container_id: &str) -> AgentResult<ContainerStats> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("stats")
            .arg("--no-stream")
            .arg("--format")
            .arg("json")
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            return Err(AgentError::ContainerError(
                "Failed to get stats".to_string(),
            ));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        // nerdctl returns newline-delimited JSON, parse the first line
        let first_line = json_output.lines().next().ok_or_else(|| {
            AgentError::ContainerError("No stats returned".to_string())
        })?;
        
        let stats: ContainerStats = serde_json::from_str(first_line)?;
        Ok(stats)
    }

    /// Execute command in running container
    pub async fn exec(
        &self,
        container_id: &str,
        command: Vec<&str>,
    ) -> AgentResult<String> {
        let mut cmd = Command::new("nerdctl");
        cmd.arg("--namespace")
            .arg(&self.namespace)
            .arg("exec")
            .arg(container_id);

        for arg in command {
            cmd.arg(arg);
        }

        let output = cmd.output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Exec failed: {}",
                stderr
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Send stdin to container
    pub async fn send_input(&self, container_id: &str, input: &str) -> AgentResult<()> {
        // This is a placeholder - actual implementation would require
        // attaching to the container and piping input
        debug!("Sending input to container: {}", container_id);
        Ok(())
    }

    /// Get container IP address
    pub async fn get_container_ip(&self, container_id: &str) -> AgentResult<String> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("inspect")
            .arg(container_id)
            .arg("--format")
            .arg("{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}")
            .output()
            .await?;

        if !output.status.success() {
            return Err(AgentError::ContainerError(format!(
                "Failed to get container IP"
            )));
        }

        let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(ip)
    }

    /// Check if a container exists
    pub async fn container_exists(&self, container_id: &str) -> bool {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("inspect")
            .arg(container_id)
            .output()
            .await;

        match output {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    }

    /// Spawn a process to stream container logs (stdout/stderr)
    /// Returns a handle to the log streaming process
    pub async fn spawn_log_stream(
        &self,
        container_id: &str,
    ) -> AgentResult<tokio::process::Child> {
        info!("Starting log stream for container: {}", container_id);

        let child = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("logs")
            .arg("--follow")
            .arg("--timestamps")
            .arg(container_id)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        Ok(child)
    }
}

#[derive(serde::Deserialize, Debug)]
pub struct ContainerInfo {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Names")]
    pub names: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "Command", default)]
    pub command: String,
    #[serde(rename = "Image", default)]
    pub image: String,
}

#[derive(serde::Deserialize, Debug)]
pub struct ContainerStats {
    #[serde(rename = "ID")]
    pub container_id: String,
    #[serde(rename = "Name")]
    pub container_name: String,
    #[serde(rename = "CPUPerc")]
    pub cpu_percent: String,
    #[serde(rename = "MemUsage")]
    pub memory_usage: String,
    #[serde(rename = "NetIO")]
    pub net_io: String,
    #[serde(rename = "BlockIO")]
    pub block_io: String,
}
