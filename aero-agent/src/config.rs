use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentConfig {
    pub server: ServerConfig,
    pub containerd: ContainerdConfig,
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerConfig {
    pub backend_url: String,
    pub node_id: String,
    pub secret: String,
    pub hostname: String,
    pub data_dir: PathBuf,
    pub max_connections: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ContainerdConfig {
    pub socket_path: PathBuf,
    pub namespace: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoggingConfig {
    pub level: String,
    pub format: String,
}

impl AgentConfig {
    pub fn from_file(path: &str) -> Result<Self, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read config: {}", e))?;
        toml::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))
    }

    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            server: ServerConfig {
                backend_url: std::env::var("BACKEND_URL")
                    .unwrap_or_else(|_| "ws://localhost:3000".to_string()),
                node_id: std::env::var("NODE_ID").map_err(|_| "NODE_ID not set".to_string())?,
                secret: std::env::var("NODE_SECRET")
                    .map_err(|_| "NODE_SECRET not set".to_string())?,
                hostname: hostname().map_err(|e| format!("Failed to get hostname: {}", e))?,
                data_dir: PathBuf::from(
                    std::env::var("DATA_DIR").unwrap_or_else(|_| "/var/lib/aero".to_string()),
                ),
                max_connections: 100,
            },
            containerd: ContainerdConfig {
                socket_path: PathBuf::from(
                    std::env::var("CONTAINERD_SOCKET")
                        .unwrap_or_else(|_| "/run/containerd/containerd.sock".to_string()),
                ),
                namespace: std::env::var("CONTAINERD_NAMESPACE")
                    .unwrap_or_else(|_| "aero".to_string()),
            },
            logging: LoggingConfig {
                level: std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string()),
                format: "json".to_string(),
            },
        })
    }
}

fn hostname() -> Result<String, std::io::Error> {
    std::process::Command::new("hostname")
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}
