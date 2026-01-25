use futures::{stream::SplitSink, SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use sysinfo::System;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::Mutex;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::{AgentConfig, AgentError, AgentResult, ContainerdRuntime, FileManager};

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type WsWriter = SplitSink<WsStream, Message>;

pub struct WebSocketHandler {
    config: Arc<AgentConfig>,
    runtime: Arc<ContainerdRuntime>,
    file_manager: Arc<FileManager>,
    ws_writer: Arc<Mutex<Option<Arc<Mutex<WsWriter>>>>>,
    install_sessions: Arc<Mutex<HashMap<String, InstallSession>>>,
}

struct InstallSession {
    stdin: Arc<Mutex<ChildStdin>>,
}

impl Clone for WebSocketHandler {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime: self.runtime.clone(),
            file_manager: self.file_manager.clone(),
            ws_writer: self.ws_writer.clone(),
            install_sessions: self.install_sessions.clone(),
        }
    }
}

impl WebSocketHandler {
    pub fn new(
        config: Arc<AgentConfig>,
        runtime: Arc<ContainerdRuntime>,
        file_manager: Arc<FileManager>,
    ) -> Self {
        Self {
            config,
            runtime,
            file_manager,
            ws_writer: Arc::new(Mutex::new(None)),
            install_sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // Helper to send WebSocket messages
    async fn send_message(&self, msg: Value) -> AgentResult<()> {
        let writer_guard = self.ws_writer.lock().await;
        if let Some(writer) = writer_guard.as_ref() {
            let mut w = writer.lock().await;
            w.send(Message::Text(msg.to_string()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            debug!("Sent message: {}", msg);
        } else {
            warn!("WebSocket not connected, cannot send message");
        }
        Ok(())
    }

    pub async fn connect_and_listen(&self) -> AgentResult<()> {
        loop {
            match self.establish_connection().await {
                Ok(()) => {
                    info!("WebSocket connection closed");
                }
                Err(e) => {
                    error!("Connection error: {}", e);
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    }

    async fn establish_connection(&self) -> AgentResult<()> {
        let ws_url = format!(
            "{}?nodeId={}&token={}",
            self.config.server.backend_url, self.config.server.node_id, self.config.server.secret
        );

        info!("Connecting to backend: {}", ws_url);

        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .map_err(|e| AgentError::NetworkError(format!("Failed to connect: {}", e)))?;

        info!("WebSocket connected to backend");

        let (write, mut read) = ws_stream.split();
        let write = Arc::new(Mutex::new(write));

        // Store writer for use in other methods
        {
            let mut writer_guard = self.ws_writer.lock().await;
            *writer_guard = Some(write.clone());
        }

        // Send handshake
        let handshake = json!({
            "type": "node_handshake",
            "token": self.config.server.secret,
            "nodeId": self.config.server.node_id,
        });

        self.send_message(handshake).await?;
        info!("Handshake sent");

        // Start heartbeat task
        let handler_clone = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
            loop {
                interval.tick().await;
                debug!("Sending heartbeat");
                let heartbeat = json!({ "type": "heartbeat" });
                let _ = handler_clone.send_message(heartbeat).await;
            }
        });

        // Start health report task (every 30 seconds)
        let handler_clone = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                if let Err(e) = handler_clone.send_health_report().await {
                    error!("Failed to send health report: {}", e);
                }
            }
        });

        // Start metrics collection task (every 30 seconds)
        let handler_clone = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                if let Err(e) = handler_clone.collect_and_send_metrics().await {
                    error!("Failed to collect metrics: {}", e);
                }
            }
        });

        // Start container crash monitor (every 10 seconds)
        let handler_clone = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            loop {
                interval.tick().await;
                if let Err(e) = handler_clone.check_for_crashed_containers().await {
                    error!("Failed to check for crashes: {}", e);
                }
            }
        });

        // Clean stale CNI static allocations (every 60 seconds)
        let handler_clone = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                match handler_clone
                    .runtime
                    .clean_stale_ip_allocations("mc-lan-static")
                    .await
                {
                    Ok(removed) if removed > 0 => {
                        info!("Cleaned {} stale static IP allocations", removed);
                    }
                    Ok(_) => {}
                    Err(e) => {
                        warn!("Failed to clean static IP allocations: {}", e);
                    }
                }
            }
        });

        // Listen for messages
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Err(e) = self.handle_message(&text).await {
                        error!("Error handling message: {}", e);
                    }
                }
                Ok(Message::Close(_)) => {
                    info!("Backend closed connection");
                    break;
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
                _ => {}
            }
        }

        // Clear writer on disconnect
        {
            let mut writer_guard = self.ws_writer.lock().await;
            *writer_guard = None;
        }

        Ok(())
    }

    async fn handle_message(&self, text: &str) -> AgentResult<()> {
        let msg: Value = serde_json::from_str(text)?;

        match msg["type"].as_str() {
            Some("server_control") => self.handle_server_control(&msg).await?,
            Some("install_server") => self.install_server(&msg).await?,
            Some("start_server") => {
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                self.start_server_with_details(&msg).await?;
            }
            Some("stop_server") => {
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                self.stop_server(server_uuid).await?;
            }
            Some("restart_server") => {
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                self.restart_server(server_uuid).await?;
            }
            Some("console_input") => self.handle_console_input(&msg).await?,
            Some("execute_command") => self.execute_command(&msg).await?,
            Some("file_operation") => self.handle_file_operation(&msg).await?,
            Some("create_backup") => self.create_backup(&msg).await?,
            Some("restore_backup") => self.restore_backup(&msg).await?,
            Some("delete_backup") => self.delete_backup(&msg).await?,
            Some("node_handshake_response") => {
                info!("Handshake accepted by backend");
            }
            _ => {
                warn!("Unknown message type: {}", msg["type"]);
            }
        }

        Ok(())
    }

    async fn handle_server_control(&self, msg: &Value) -> AgentResult<()> {
        let action = msg["action"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing action".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        match action {
            "install" => self.install_server(msg).await?,
            "start" => self.start_server(server_id).await?,
            "stop" => self.stop_server(server_id).await?,
            "kill" => self.kill_server(server_id).await?,
            "restart" => {
                self.stop_server(server_id).await?;
                tokio::time::sleep(Duration::from_secs(2)).await;
                self.start_server(server_id).await?;
            }
            _ => {
                return Err(AgentError::InvalidRequest(format!(
                    "Unknown action: {}",
                    action
                )))
            }
        }

        Ok(())
    }

    async fn install_server(&self, msg: &Value) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let template = msg["template"]
            .as_object()
            .ok_or_else(|| AgentError::InvalidRequest("Missing template".to_string()))?;

        let install_script = template
            .get("installScript")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AgentError::InvalidRequest("Missing installScript in template".to_string())
            })?;

        let install_image = template
            .get("installImage")
            .and_then(|v| v.as_str())
            .or_else(|| template.get("image").and_then(|v| v.as_str()))
            .ok_or_else(|| {
                AgentError::InvalidRequest("Missing installImage in template".to_string())
            })?;

        let environment = msg
            .get("environment")
            .and_then(|v| v.as_object())
            .ok_or_else(|| {
                AgentError::InvalidRequest("Missing or invalid environment".to_string())
            })?;

        info!("Installing server: {} (UUID: {})", server_id, server_uuid);

        // Update state to installing
        self.emit_server_state_update(
            server_id,
            "installing",
            Some("Starting installation".to_string()),
        )
        .await?;

        // Send installation log
        self.send_console_output(server_id, "system", "Starting server installation...")
            .await?;

        // Backend should provide SERVER_DIR automatically
        let server_dir = environment
            .get("SERVER_DIR")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                // Fallback: create based on UUID
                format!("/tmp/aero-servers/{}", server_uuid)
            });

        let server_dir_path = std::path::PathBuf::from(&server_dir);

        tokio::fs::create_dir_all(&server_dir_path)
            .await
            .map_err(|e| {
                AgentError::IoError(format!("Failed to create server directory: {}", e))
            })?;

        info!("Created server directory: {}", server_dir_path.display());
        self.send_console_output(
            server_id,
            "system",
            &format!("Created directory: {}", server_dir_path.display()),
        )
        .await?;

        let mut env_map = std::collections::HashMap::new();
        for (key, value) in environment {
            if let Some(val_str) = value.as_str() {
                env_map.insert(key.clone(), val_str.to_string());
            }
        }
        env_map.insert("SERVER_DIR".to_string(), "/data".to_string());

        // Replace variables in install script
        let mut final_script = install_script.to_string();
        for (key, value) in &env_map {
            let placeholder = format!("{{{{{}}}}}", key);
            final_script = final_script.replace(&placeholder, value);
        }

        info!("Executing installation script");
        self.send_console_output(server_id, "system", "Executing installation script...")
            .await?;

        // Execute the install script in a container
        // NOTE: Script handles its own directory with cd {{SERVER_DIR}}
        let mut child = self
            .runtime
            .spawn_installer_container(install_image, &final_script, &env_map, &server_dir)
            .await
            .map_err(|e| {
                let err_msg = format!("Failed to execute install script: {}", e);
                // Try to send error log (ignore if it fails)
                let handler = self.clone();
                let sid = server_id.to_string();
                let msg = err_msg.clone();
                tokio::spawn(async move {
                    let _ = handler
                        .send_console_output(&sid, "system", &format!("ERROR: {}", msg))
                        .await;
                    let _ = handler
                        .emit_server_state_update(
                            &sid,
                            "stopped",
                            Some("Installation failed".to_string()),
                        )
                        .await;
                });
                AgentError::IoError(err_msg)
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AgentError::IoError("Installer stdin unavailable".to_string()))?;
        {
            let mut sessions = self.install_sessions.lock().await;
            sessions.insert(
                server_id.to_string(),
                InstallSession {
                    stdin: Arc::new(Mutex::new(stdin)),
                },
            );
        }

        if let Some(stdout) = child.stdout.take() {
            let handler = self.clone();
            let sid = server_id.to_string();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let _ = handler
                        .send_console_output(&sid, "stdout", &format!("{}\n", line))
                        .await;
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let handler = self.clone();
            let sid = server_id.to_string();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let _ = handler
                        .send_console_output(&sid, "stderr", &format!("{}\n", line))
                        .await;
                }
            });
        }

        let status = match child.wait().await {
            Ok(status) => status,
            Err(e) => {
                let mut sessions = self.install_sessions.lock().await;
                sessions.remove(server_id);
                return Err(AgentError::IoError(format!(
                    "Failed waiting for installer: {}",
                    e
                )));
            }
        };

        {
            let mut sessions = self.install_sessions.lock().await;
            sessions.remove(server_id);
        }

        if !status.success() {
            let detail = status
                .code()
                .map(|code| format!("exit code {}", code))
                .unwrap_or_else(|| "unknown error".to_string());
            error!("Installation failed: {}", detail);

            // Send error logs
            self.send_console_output(server_id, "system", "Installation FAILED")
                .await?;

            // Update state to stopped with error reason
            self.emit_server_state_update(
                server_id,
                "stopped",
                Some(format!("Installation failed: {}", detail)),
            )
            .await?;

            return Err(AgentError::InstallationError(format!(
                "Install script failed: {}",
                detail
            )));
        }

        self.send_console_output(server_id, "system", "Installation completed successfully!")
            .await?;

        // Emit state update to stopped (ready to start)
        self.emit_server_state_update(
            server_id,
            "stopped",
            Some("Installation complete".to_string()),
        )
        .await?;

        info!("Server installed successfully: {}", server_uuid);
        Ok(())
    }

    // Helper method to send console output
    async fn send_console_output(
        &self,
        server_id: &str,
        stream: &str,
        data: &str,
    ) -> AgentResult<()> {
        let msg = json!({
            "type": "console_output",
            "serverId": server_id,
            "stream": stream,
            "data": data,
        });

        self.send_message(msg).await
    }

    async fn start_server_with_details(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let template = msg["template"]
            .as_object()
            .ok_or_else(|| AgentError::InvalidRequest("Missing template".to_string()))?;

        let docker_image = template
            .get("image")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AgentError::InvalidRequest("Missing image in template".to_string()))?;

        let startup_command = template
            .get("startup")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AgentError::InvalidRequest("Missing startup in template".to_string()))?;

        let memory_mb = msg["allocatedMemoryMb"]
            .as_u64()
            .ok_or_else(|| AgentError::InvalidRequest("Missing allocatedMemoryMb".to_string()))?;

        let cpu_cores = msg["allocatedCpuCores"]
            .as_u64()
            .ok_or_else(|| AgentError::InvalidRequest("Missing allocatedCpuCores".to_string()))?;

        let primary_port = msg["primaryPort"]
            .as_u64()
            .ok_or_else(|| AgentError::InvalidRequest("Missing primaryPort".to_string()))?
            as u16;

        let network_mode = msg.get("networkMode").and_then(|v| v.as_str());

        let environment = msg
            .get("environment")
            .and_then(|v| v.as_object())
            .ok_or_else(|| {
                AgentError::InvalidRequest("Missing or invalid environment".to_string())
            })?;

        // Convert environment to HashMap
        let mut env_map = std::collections::HashMap::new();
        for (key, value) in environment {
            if let Some(val_str) = value.as_str() {
                env_map.insert(key.clone(), val_str.to_string());
            }
        }

        let network_ip = env_map.get("AERO_NETWORK_IP").cloned();

        // Get SERVER_DIR from environment
        let server_dir = environment
            .get("SERVER_DIR")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("/tmp/aero-servers/{}", server_uuid));

        info!("Starting server: {} (UUID: {})", server_id, server_uuid);
        info!(
            "Image: {}, Port: {}, Memory: {}MB, CPU: {}",
            docker_image, primary_port, memory_mb, cpu_cores
        );

        // Replace template variables in startup command
        let mut final_startup_command = startup_command.to_string();

        // Add MEMORY to environment for variable replacement.
        // If MEMORY_PERCENT is set, reserve headroom by using a percentage of the allocation.
        let effective_memory_mb = env_map
            .get("MEMORY_PERCENT")
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| (1..=100).contains(value))
            .map(|percent| std::cmp::max(256, memory_mb.saturating_mul(percent) / 100))
            .unwrap_or(memory_mb);
        env_map.insert("MEMORY".to_string(), effective_memory_mb.to_string());
        env_map.insert("PORT".to_string(), primary_port.to_string());

        // Replace all {{VARIABLE}} placeholders
        for (key, value) in &env_map {
            let placeholder = format!("{{{{{}}}}}", key);
            final_startup_command = final_startup_command.replace(&placeholder, value);
        }

        info!("Final startup command: {}", final_startup_command);

        // Persist console target hints inferred from startup command.

        // Check if container already exists (from installation or previous run)
        let container_exists = self.runtime.container_exists(server_uuid).await;

        if container_exists {
            info!("Existing container found, removing it before creating new one...");
            // Remove the old container (could be from install or previous start)
            if let Err(e) = self.runtime.remove_container(server_uuid).await {
                warn!("Failed to remove existing container: {}", e);
                // Continue anyway - maybe it's already gone
            }
        }

        info!("Creating new container...");
        // Create and start container
        self.runtime
            .create_container(
                server_uuid,
                docker_image,
                &final_startup_command,
                &env_map,
                memory_mb,
                cpu_cores,
                &server_dir,
                primary_port,
                network_mode,
                network_ip.as_deref(),
            )
            .await?;

        // Spawn log streamer
        self.spawn_log_streamer(server_id.to_string(), server_uuid.to_string());

        // Emit state update
        self.emit_server_state_update(server_id, "running", None)
            .await?;

        info!("Server started successfully: {}", server_uuid);
        Ok(())
    }

    async fn start_server(&self, server_id: &str) -> AgentResult<()> {
        info!("Starting server: {}", server_id);

        // In production, fetch server config from database or local cache
        self.runtime.start_container(server_id).await?;

        // Spawn log streamer
        self.spawn_log_streamer(server_id.to_string(), server_id.to_string());

        // Emit state update
        self.emit_server_state_update(server_id, "running", None)
            .await?;

        Ok(())
    }

    async fn stop_server(&self, server_id: &str) -> AgentResult<()> {
        info!("Stopping server: {}", server_id);

        self.runtime.stop_container(server_id, 30).await?;

        self.emit_server_state_update(server_id, "stopped", None)
            .await?;

        Ok(())
    }

    async fn kill_server(&self, server_id: &str) -> AgentResult<()> {
        info!("Killing server: {}", server_id);

        self.runtime.kill_container(server_id, "SIGKILL").await?;

        self.emit_server_state_update(server_id, "crashed", Some("Killed by agent".to_string()))
            .await?;

        Ok(())
    }

    async fn restart_server(&self, server_id: &str) -> AgentResult<()> {
        info!("Restarting server: {}", server_id);

        // First stop the server
        self.runtime.stop_container(server_id, 30).await?;

        self.emit_server_state_update(server_id, "stopped", None)
            .await?;

        // Small delay to ensure clean shutdown
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Then start it again
        self.runtime.start_container(server_id).await?;

        self.emit_server_state_update(server_id, "starting", None)
            .await?;

        // Start console monitoring for the restarted server
        self.spawn_log_streamer(server_id.to_string(), server_id.to_string());

        self.emit_server_state_update(server_id, "running", None)
            .await?;

        Ok(())
    }

    async fn execute_command(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"].as_str().unwrap_or(server_id);

        let command = msg["command"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing command".to_string()))?;

        info!("Executing command on server {}: {}", server_id, command);

        // Send command to container stdin (same as console input)
        self.runtime
            .send_input(server_uuid, &format!("{}\n", command))
            .await?;

        // Send console output notification
        self.send_message(json!({
            "type": "console_output",
            "serverId": server_id,
            "stream": "stdin",
            "data": format!("> {}\n", command),
        }))
        .await?;

        Ok(())
    }

    async fn handle_console_input(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"].as_str().unwrap_or(server_id);

        let data = msg["data"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing data".to_string()))?;

        debug!("Console input for {}: {}", server_id, data);

        let install_stdin = {
            let sessions = self.install_sessions.lock().await;
            sessions.get(server_id).map(|session| session.stdin.clone())
        };
        if let Some(stdin) = install_stdin {
            let mut stdin = stdin.lock().await;
            stdin.write_all(data.as_bytes()).await.map_err(|e| {
                AgentError::IoError(format!("Failed to write install stdin: {}", e))
            })?;
            return Ok(());
        }

        // Send to container stdin
        self.runtime.send_input(server_uuid, data).await?;

        Ok(())
    }

    async fn handle_file_operation(&self, msg: &Value) -> AgentResult<()> {
        let op_type = msg["type"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing type".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let path = msg["path"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing path".to_string()))?;

        match op_type {
            "read" => {
                self.file_manager.read_file(server_id, path).await?;
            }
            "write" => {
                let data = msg["data"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing data".to_string()))?;
                self.file_manager.write_file(server_id, path, data).await?;
            }
            "delete" => {
                self.file_manager.delete_file(server_id, path).await?;
            }
            "list" => {
                self.file_manager.list_dir(server_id, path).await?;
            }
            _ => {
                return Err(AgentError::InvalidRequest(format!(
                    "Unknown file operation: {}",
                    op_type
                )))
            }
        }

        Ok(())
    }

    async fn create_backup(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let backup_name = msg["backupName"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupName".to_string()))?;

        info!(
            "Creating backup for server {}: {}",
            server_uuid, backup_name
        );

        // Send log to backend
        self.send_console_output(
            server_id,
            "system",
            &format!("Creating backup: {}", backup_name),
        )
        .await?;

        // Get server directory
        let server_dir = format!("/tmp/aero-servers/{}", server_uuid);
        let backup_dir = "/var/lib/aero/backups";

        // Create backup directory if it doesn't exist
        tokio::fs::create_dir_all(backup_dir)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to create backup dir: {}", e)))?;

        let backup_path = format!("{}/{}.tar.gz", backup_dir, backup_name);

        // Create tar.gz archive
        let output = tokio::process::Command::new("tar")
            .arg("-czf")
            .arg(&backup_path)
            .arg("-C")
            .arg(&server_dir)
            .arg(".")
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to create backup: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Backup creation failed: {}", stderr);
            self.send_console_output(server_id, "system", &format!("Backup FAILED: {}", stderr))
                .await?;
            return Err(AgentError::IoError(format!("Backup failed: {}", stderr)));
        }

        // Get backup file size
        let metadata = tokio::fs::metadata(&backup_path)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to read backup metadata: {}", e)))?;
        let size_mb = metadata.len() as f64 / 1024.0 / 1024.0;

        // Calculate checksum
        let checksum = self.calculate_checksum(&backup_path).await?;

        info!("Backup created: {} ({:.2} MB)", backup_path, size_mb);
        self.send_console_output(
            server_id,
            "system",
            &format!("Backup created successfully ({:.2} MB)", size_mb),
        )
        .await?;

        // Notify backend about backup completion
        let backup_complete = json!({
            "type": "backup_complete",
            "serverId": server_id,
            "backupName": backup_name,
            "path": backup_path,
            "sizeMb": size_mb,
            "checksum": checksum,
            "metadata": {
                "serverUuid": server_uuid,
                "timestamp": chrono::Utc::now().timestamp_millis(),
            },
        });

        self.send_message(backup_complete).await?;

        Ok(())
    }

    async fn restore_backup(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;

        info!(
            "Restoring backup for server {}: {}",
            server_uuid, backup_path
        );

        self.send_console_output(
            server_id,
            "system",
            &format!("Restoring from backup: {}", backup_path),
        )
        .await?;

        // Get server directory
        let server_dir = format!("/tmp/aero-servers/{}", server_uuid);

        // Clear existing server directory
        if tokio::fs::metadata(&server_dir).await.is_ok() {
            tokio::fs::remove_dir_all(&server_dir)
                .await
                .map_err(|e| AgentError::IoError(format!("Failed to clear server dir: {}", e)))?;
        }

        // Create server directory
        tokio::fs::create_dir_all(&server_dir)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to create server dir: {}", e)))?;

        // Extract backup
        let output = tokio::process::Command::new("tar")
            .arg("-xzf")
            .arg(backup_path)
            .arg("-C")
            .arg(&server_dir)
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to extract backup: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Restore failed: {}", stderr);
            self.send_console_output(server_id, "system", &format!("Restore FAILED: {}", stderr))
                .await?;
            return Err(AgentError::IoError(format!("Restore failed: {}", stderr)));
        }

        info!("Backup restored successfully: {}", backup_path);
        self.send_console_output(server_id, "system", "Backup restored successfully")
            .await?;

        Ok(())
    }

    async fn delete_backup(&self, msg: &Value) -> AgentResult<()> {
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;

        info!("Deleting backup: {}", backup_path);

        // Delete backup file
        tokio::fs::remove_file(backup_path)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to delete backup: {}", e)))?;

        info!("Backup deleted: {}", backup_path);

        Ok(())
    }

    async fn calculate_checksum(&self, path: &str) -> AgentResult<String> {
        let output = tokio::process::Command::new("sha256sum")
            .arg(path)
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to calculate checksum: {}", e)))?;

        if !output.status.success() {
            return Err(AgentError::IoError(
                "Checksum calculation failed".to_string(),
            ));
        }

        let checksum = String::from_utf8_lossy(&output.stdout);
        let checksum = checksum.split_whitespace().next().unwrap_or("").to_string();

        Ok(checksum)
    }

    async fn emit_server_state_update(
        &self,
        server_id: &str,
        state: &str,
        reason: Option<String>,
    ) -> AgentResult<()> {
        let msg = json!({
            "type": "server_state_update",
            "serverId": server_id,
            "state": state,
            "timestamp": chrono::Utc::now().timestamp_millis(),
            "reason": reason,
        });

        info!("Emitting state update: {} -> {}", server_id, state);
        self.send_message(msg).await
    }

    /// Spawn a task to stream container logs to the backend
    fn spawn_log_streamer(&self, server_id: String, container_id: String) {
        let handler = self.clone();

        tokio::spawn(async move {
            info!("Starting log streamer for server: {}", server_id);

            match handler.runtime.spawn_log_stream(&container_id).await {
                Ok(mut child) => {
                    // Get stdout and stderr handles
                    let stdout = child.stdout.take();
                    let stderr = child.stderr.take();

                    // Spawn task for stdout
                    if let Some(stdout) = stdout {
                        let handler_clone = handler.clone();
                        let server_id_clone = server_id.clone();
                        tokio::spawn(async move {
                            let reader = tokio::io::BufReader::new(stdout);
                            let mut lines = reader.lines();

                            while let Ok(Some(line)) = lines.next_line().await {
                                let msg = json!({
                                    "type": "console_output",
                                    "serverId": server_id_clone,
                                    "stream": "stdout",
                                    "data": line,
                                });

                                if let Err(e) = handler_clone.send_message(msg).await {
                                    error!("Failed to send console output: {}", e);
                                    break;
                                }
                            }

                            info!("stdout stream ended for server: {}", server_id_clone);
                        });
                    }

                    // Spawn task for stderr
                    if let Some(stderr) = stderr {
                        let handler_clone = handler.clone();
                        let server_id_clone = server_id.clone();
                        tokio::spawn(async move {
                            let reader = tokio::io::BufReader::new(stderr);
                            let mut lines = reader.lines();

                            while let Ok(Some(line)) = lines.next_line().await {
                                let msg = json!({
                                    "type": "console_output",
                                    "serverId": server_id_clone,
                                    "stream": "stderr",
                                    "data": line,
                                });

                                if let Err(e) = handler_clone.send_message(msg).await {
                                    error!("Failed to send console output: {}", e);
                                    break;
                                }
                            }

                            info!("stderr stream ended for server: {}", server_id_clone);
                        });
                    }

                    // Wait for the logs process to exit
                    match child.wait().await {
                        Ok(status) => {
                            info!("Log streamer exited for server {}: {:?}", server_id, status);
                        }
                        Err(e) => {
                            error!("Log streamer error for server {}: {}", server_id, e);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to start log stream for {}: {}", server_id, e);
                }
            }
        });
    }

    pub async fn send_health_report(&self) -> AgentResult<()> {
        debug!("Sending health report");

        let containers = self.runtime.list_containers().await?;

        // Get system stats
        let mut sys = System::new_all();
        sys.refresh_all();

        let total_memory = sys.total_memory() / 1024 / 1024; // Convert to MB
        let used_memory = sys.used_memory() / 1024 / 1024;

        // Get CPU usage (average across all cores)
        let cpu_usage: f32 = sys.cpus().iter().map(|cpu| cpu.cpu_usage()).sum::<f32>()
            / sys.cpus().len().max(1) as f32;

        let health = json!({
            "type": "health_report",
            "nodeId": self.config.server.node_id,
            "timestamp": chrono::Utc::now().timestamp_millis(),
            "containerCount": containers.len(),
            "cpuPercent": cpu_usage,
            "memoryUsageMb": used_memory,
            "memoryTotalMb": total_memory,
            "diskUsageMb": 0, // TODO: Implement disk usage
            "diskTotalMb": 0, // TODO: Implement disk total
            "networkRxBytes": 0, // TODO: Implement network stats
            "networkTxBytes": 0, // TODO: Implement network stats
        });

        self.send_message(health).await
    }

    // New method: Collect and send metrics for all running containers
    async fn collect_and_send_metrics(&self) -> AgentResult<()> {
        let containers = self.runtime.list_containers().await?;

        for container in containers {
            // Get container stats
            match self.runtime.get_stats(&container.id).await {
                Ok(stats) => {
                    // Extract server ID from container name (fallback to container ID).
                    let server_id = extract_server_id(&container);

                    // Parse stats (nerdctl returns strings like "15.32%" or "100MiB / 200MiB")
                    let cpu_percent = parse_percent_string(&stats.cpu_percent) as f32;

                    // Parse memory usage (format: "1.996GiB / 2GiB")
                    let memory_mb = if let Some(usage_part) = stats.memory_usage.split('/').next() {
                        parse_memory_string(usage_part.trim())
                    } else {
                        0
                    };

                    // Parse network IO (format: "51.4MB / 415kB" = rx / tx)
                    let (network_rx, network_tx) =
                        if let Some((rx_str, tx_str)) = stats.net_io.split_once('/') {
                            (
                                parse_bytes_string(rx_str.trim()),
                                parse_bytes_string(tx_str.trim()),
                            )
                        } else {
                            (0, 0)
                        };

                    // Parse block IO (format: "612MB / 1.12GB" = read / write)
                    let disk_usage_mb = if let Some(read_str) = stats.block_io.split('/').next() {
                        parse_bytes_string(read_str.trim()) / 1024 / 1024 // Convert to MB
                    } else {
                        0
                    };

                    let metrics = json!({
                        "type": "resource_stats",
                        "serverId": server_id,
                        "cpuPercent": cpu_percent,
                        "memoryUsageMb": memory_mb,
                        "networkRxBytes": network_rx,
                        "networkTxBytes": network_tx,
                        "diskUsageMb": disk_usage_mb,
                    });

                    if let Err(e) = self.send_message(metrics).await {
                        warn!(
                            "Failed to send metrics for container {}: {}",
                            container.id, e
                        );
                    }
                }
                Err(e) => {
                    debug!("Failed to get stats for container {}: {}", container.id, e);
                }
            }
        }

        Ok(())
    }

    // Check for crashed containers and notify backend
    async fn check_for_crashed_containers(&self) -> AgentResult<()> {
        let containers = self.runtime.list_containers().await?;

        for container in containers {
            // Check if container status indicates a crash
            // nerdctl ps shows status like "Exited (1)" or "Exited (137)"
            if container.status.contains("Exited") {
                // Extract exit code
                let exit_code = if let Some(start) = container.status.find('(') {
                    if let Some(end) = container.status.find(')') {
                        container.status[start + 1..end].parse::<i32>().unwrap_or(1)
                    } else {
                        1
                    }
                } else {
                    1
                };

                // Send crashed state update
                let server_id = extract_server_id(&container);

                warn!(
                    "Detected crashed container: {} (exit code: {})",
                    server_id, exit_code
                );

                let crash_msg = json!({
                    "type": "server_state_update",
                    "serverId": server_id,
                    "state": "crashed",
                    "timestamp": chrono::Utc::now().timestamp_millis(),
                    "reason": format!("Container exited with code {}", exit_code),
                });

                if let Err(e) = self.send_message(crash_msg).await {
                    error!("Failed to send crash notification for {}: {}", server_id, e);
                }
            }
        }

        Ok(())
    }

    async fn heartbeat_loop(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            interval.tick().await;
            debug!("Sending heartbeat");
            // Send heartbeat message
        }
    }
}

fn extract_server_id(container: &crate::runtime_manager::ContainerInfo) -> &str {
    // nerdctl Names can be comma-separated for multiple names; take the first.
    let name = container.names.split(',').next().unwrap_or("").trim();
    if name.is_empty() {
        &container.id
    } else {
        name
    }
}

// Helper functions to parse nerdctl stats strings
fn parse_memory_string(s: &str) -> i64 {
    let s = s.trim();
    if s.ends_with("GiB") || s.ends_with("GB") {
        let num = parse_number_prefix(s);
        (num * 1024.0) as i64
    } else if s.ends_with("MiB") || s.ends_with("MB") {
        let num = parse_number_prefix(s);
        num as i64
    } else if s.ends_with("KiB") || s.ends_with("KB") || s.ends_with("kB") {
        let num = parse_number_prefix(s);
        (num / 1024.0) as i64
    } else if s.ends_with('B') {
        let num = parse_number_prefix(s);
        (num / 1024.0 / 1024.0) as i64
    } else {
        0
    }
}

fn parse_bytes_string(s: &str) -> i64 {
    let s = s.trim();
    if s.ends_with("GiB") || s.ends_with("GB") {
        let num = parse_number_prefix(s);
        (num * 1_000_000_000.0) as i64
    } else if s.ends_with("MiB") || s.ends_with("MB") {
        let num = parse_number_prefix(s);
        (num * 1_000_000.0) as i64
    } else if s.ends_with("KiB") || s.ends_with("KB") || s.ends_with("kB") {
        let num = parse_number_prefix(s);
        (num * 1_000.0) as i64
    } else if s.ends_with('B') {
        let num = parse_number_prefix(s);
        num as i64
    } else {
        0
    }
}

fn parse_percent_string(s: &str) -> f64 {
    parse_number_prefix(s)
}

fn parse_number_prefix(s: &str) -> f64 {
    let mut buf = String::new();
    for ch in s.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            buf.push(ch);
        } else if !buf.is_empty() {
            break;
        }
    }
    buf.parse::<f64>().unwrap_or(0.0)
}

fn get_uptime() -> u64 {
    // Simplified uptime calculation
    std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| {
            s.split_whitespace()
                .next()
                .map(|first| first.parse::<f64>().ok())
        })
        .flatten()
        .map(|u| u as u64)
        .unwrap_or(0)
}
