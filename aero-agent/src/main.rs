use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

mod config;
mod errors;
mod file_manager;
mod firewall_manager;
mod runtime_manager;
mod system_setup;
mod websocket_handler;

pub use config::AgentConfig;
pub use errors::{AgentError, AgentResult};
pub use file_manager::FileManager;
pub use firewall_manager::FirewallManager;
pub use runtime_manager::ContainerdRuntime;
pub use system_setup::SystemSetup;
pub use websocket_handler::WebSocketHandler;

/// Aero Agent - Main application state
pub struct AeroAgent {
    pub config: Arc<AgentConfig>,
    pub runtime: Arc<ContainerdRuntime>,
    pub ws_handler: Arc<WebSocketHandler>,
    pub file_manager: Arc<FileManager>,
    pub backend_connected: Arc<RwLock<bool>>,
}

impl AeroAgent {
    pub async fn new(config: AgentConfig) -> AgentResult<Self> {
        info!("Initializing Aero Agent");

        let config = Arc::new(config);
        let runtime = Arc::new(ContainerdRuntime::new(
            config.containerd.socket_path.clone(),
            config.containerd.namespace.clone(),
        ));

        let file_manager = Arc::new(FileManager::new(config.server.data_dir.clone()));

        let ws_handler = Arc::new(WebSocketHandler::new(
            config.clone(),
            runtime.clone(),
            file_manager.clone(),
        ));

        Ok(Self {
            config,
            runtime,
            ws_handler,
            file_manager,
            backend_connected: Arc::new(RwLock::new(false)),
        })
    }

    pub async fn run(&self) -> AgentResult<()> {
        info!("Starting Aero Agent");

        // Start WebSocket connection to backend
        let agent = self.clone_refs();
        let ws_task = tokio::spawn(async move {
            if let Err(e) = agent.ws_handler.connect_and_listen().await {
                error!("WebSocket error: {}", e);
            }
        });

        // Start health monitoring
        let agent = self.clone_refs();
        let health_task = tokio::spawn(async move {
            agent.start_health_monitoring().await;
        });

        // Start HTTP server for local management
        let agent = self.clone_refs();
        let http_task = tokio::spawn(async move {
            if let Err(e) = agent.start_http_server().await {
                error!("HTTP server error: {}", e);
            }
        });

        tokio::select! {
            _ = ws_task => {},
            _ = health_task => {},
            _ = http_task => {},
        }

        Ok(())
    }

    async fn start_health_monitoring(&self) {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));

        loop {
            interval.tick().await;

            // Collect health metrics
            if let Err(err) = self.ws_handler.send_health_report().await {
                warn!("Failed to send health report: {}", err);
            }

            // Collect per-server resource stats
            if let Err(err) = self.ws_handler.send_resource_stats().await {
                warn!("Failed to send resource stats: {}", err);
            }
        }
    }

    async fn start_http_server(&self) -> AgentResult<()> {
        use axum::{
            routing::get,
            Router,
        };

        let app = Router::new()
            .route("/health", get(|| async { "ok" }))
            .route("/stats", get(|| async { "stats" }))
            .route("/containers", get(|| async { "containers" }));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await?;

        info!("Local HTTP server listening on 127.0.0.1:8080");

        axum::serve(listener, app)
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))
    }

    fn clone_refs(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime: self.runtime.clone(),
            ws_handler: self.ws_handler.clone(),
            file_manager: self.file_manager.clone(),
            backend_connected: self.backend_connected.clone(),
        }
    }
}

#[tokio::main]
async fn main() -> AgentResult<()> {
    // Load config first so logging level/format can be applied.
    let config = AgentConfig::from_file("./config.toml")
        .or_else(|_| AgentConfig::from_env())
        .map_err(|e| AgentError::ConfigError(e.to_string()))?;

    let filter = format!("aero_agent={},tokio=info", config.logging.level);
    if config.logging.format == "json" {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    info!("Aero Agent starting");
    info!("Configuration loaded: {:?}", config);

    // Run system initialization
    info!("Running system setup and dependency check...");
    if let Err(e) = SystemSetup::initialize().await {
        warn!("System setup encountered issues: {}", e);
        warn!("Continuing with existing configuration...");
    }

    // Create and run agent
    let agent = AeroAgent::new(config).await?;
    agent.run().await?;

    Ok(())
}
