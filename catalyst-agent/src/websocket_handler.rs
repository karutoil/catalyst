use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::sync::RwLock;
use sysinfo::{Disks, System};
use tokio::io::{AsyncBufReadExt, AsyncReadExt};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::connect_async;
use futures::{SinkExt, StreamExt};
use futures::stream::SplitSink;
use sha2::{Digest, Sha256};
use base64::Engine;
use tracing::{info, error, warn, debug};
use regex::Regex;
use serde_json::{json, Value};
use std::time::Duration;

use crate::{AgentConfig, ContainerdRuntime, FileManager, StorageManager, AgentError, AgentResult};

type WsStream = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;
type WsWrite = SplitSink<WsStream, Message>;

pub struct WebSocketHandler {
    config: Arc<AgentConfig>,
    runtime: Arc<ContainerdRuntime>,
    file_manager: Arc<FileManager>,
    storage_manager: Arc<StorageManager>,
    write: Arc<RwLock<Option<Arc<tokio::sync::Mutex<WsWrite>>>>>,
    active_log_streams: Arc<RwLock<HashSet<String>>>,
}

impl Clone for WebSocketHandler {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime: self.runtime.clone(),
            file_manager: self.file_manager.clone(),
            storage_manager: self.storage_manager.clone(),
            write: self.write.clone(),
            active_log_streams: self.active_log_streams.clone(),
        }
    }
}

impl WebSocketHandler {
    pub fn new(
        config: Arc<AgentConfig>,
        runtime: Arc<ContainerdRuntime>,
        file_manager: Arc<FileManager>,
        storage_manager: Arc<StorageManager>,
    ) -> Self {
        Self {
            config,
            runtime,
            file_manager,
            storage_manager,
            write: Arc::new(RwLock::new(None)),
            active_log_streams: Arc::new(RwLock::new(HashSet::new())),
        }
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
        let write = Arc::new(tokio::sync::Mutex::new(write));
        {
            let mut guard = self.write.write().await;
            *guard = Some(write.clone());
        }

        // Send handshake
        let handshake = json!({
            "type": "node_handshake",
            "token": self.config.server.secret,
            "nodeId": self.config.server.node_id,
        });

        {
            let mut w = write.lock().await;
            w.send(Message::Text(handshake.to_string()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        }

        info!("Handshake sent");

        // Start heartbeat task
        let write_clone = write.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
            loop {
                interval.tick().await;
                debug!("Sending heartbeat");
                let heartbeat = json!({
                    "type": "heartbeat"
                });
                if let Ok(mut w) = write_clone.try_lock() {
                    let _ = w.send(Message::Text(heartbeat.to_string())).await;
                }
            }
        });

        // Listen for messages
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Err(e) = self.handle_message(&text, &write).await {
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

        {
            let mut guard = self.write.write().await;
            *guard = None;
        }

        Ok(())
    }

    async fn handle_message(&self, text: &str, write: &Arc<tokio::sync::Mutex<WsWrite>>) -> AgentResult<()> {
        let msg: Value = serde_json::from_str(text)?;

        match msg["type"].as_str() {
            Some("server_control") => self.handle_server_control(&msg).await?,
            Some("install_server") => self.install_server(&msg).await?,
            Some("start_server") => {
                self.start_server_with_details(&msg).await?;
            }
            Some("stop_server") => {
                let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
                    AgentError::InvalidRequest("Missing serverUuid".to_string())
                })?;
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                self.stop_server(server_id, container_id).await?;
            }
            Some("restart_server") => {
                let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
                    AgentError::InvalidRequest("Missing serverUuid".to_string())
                })?;
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                self.stop_server(server_id, container_id).await?;
                tokio::time::sleep(Duration::from_secs(2)).await;
                self.start_server_with_details(&msg).await?;
            }
            Some("console_input") => self.handle_console_input(&msg).await?,
            Some("file_operation") => self.handle_file_operation(&msg).await?,
            Some("create_backup") => self.handle_create_backup(&msg, write).await?,
            Some("restore_backup") => self.handle_restore_backup(&msg, write).await?,
            Some("delete_backup") => self.handle_delete_backup(&msg, write).await?,
            Some("download_backup") => self.handle_download_backup(&msg, write).await?,
            Some("resize_storage") => self.handle_resize_storage(&msg, write).await?,
            Some("resume_console") => self.resume_console(&msg).await?,
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
        let action = msg["action"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing action".to_string())
        })?;

        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;

        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if container_id.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
        }

        match action {
            "install" => self.install_server(msg).await?,
            "start" => self.start_server(server_id, container_id).await?,
            "stop" => self.stop_server(server_id, container_id).await?,
            "kill" => self.kill_server(server_id, container_id).await?,
            "restart" => {
                self.stop_server(server_id, container_id).await?;
                tokio::time::sleep(Duration::from_secs(2)).await;
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                self.start_server(server_id, container_id).await?;
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

    async fn resume_console(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;
        let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverUuid".to_string())
        })?;

        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if container_id.is_empty() {
            debug!(
                "Resume console skipped; container not found for {} ({})",
                server_id, server_uuid
            );
            return Ok(());
        }

        if !self
            .runtime
            .is_container_running(&container_id)
            .await
            .unwrap_or(false)
        {
            debug!(
                "Resume console skipped; container not running: {}",
                container_id
            );
            return Ok(());
        }

        let _ = self.runtime.send_input(&container_id, "\n").await;
        self.spawn_log_stream(server_id, &container_id);
        self.emit_console_output(
            server_id,
            "system",
            "[Catalyst] Console reattached after agent restart.\n",
        )
        .await?;

        Ok(())
    }

    async fn resolve_console_container_id(
        &self,
        server_id: &str,
        server_uuid: &str,
    ) -> Option<String> {
        if self.runtime.container_exists(server_id).await {
            warn!(
                "Console container lookup using serverId {} (uuid {})",
                server_id, server_uuid
            );
            return Some(server_id.to_string());
        }
        if self.runtime.container_exists(server_uuid).await {
            return Some(server_uuid.to_string());
        }
        None
    }

    async fn resolve_container_id(&self, server_id: &str, server_uuid: &str) -> String {
        match self
            .resolve_console_container_id(server_id, server_uuid)
            .await
        {
            Some(value) => value,
            None => String::new(),
        }
    }

    async fn install_server(&self, msg: &Value) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverUuid".to_string())
        })?;

        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;

        let template = msg["template"].as_object().ok_or_else(|| {
            AgentError::InvalidRequest("Missing template".to_string())
        })?;

        let install_script = template.get("installScript")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AgentError::InvalidRequest("Missing installScript in template".to_string()))?;

        let environment = msg.get("environment")
            .and_then(|v| v.as_object())
            .ok_or_else(|| AgentError::InvalidRequest("Missing or invalid environment".to_string()))?;

        info!("Installing server: {} (UUID: {})", server_id, server_uuid);

        // Backend should provide SERVER_DIR automatically
        let server_dir = environment.get("SERVER_DIR")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                // Fallback: create based on UUID
                format!("/tmp/catalyst-servers/{}", server_uuid)
            });

        let disk_mb = msg["allocatedDiskMb"].as_u64().unwrap_or(10240);
        let server_dir_path = PathBuf::from(&server_dir);
        self.storage_manager
            .ensure_mounted(server_uuid, &server_dir_path, disk_mb)
            .await?;
        
        let server_dir_path = std::path::PathBuf::from(&server_dir);
        
        tokio::fs::create_dir_all(&server_dir_path)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to create server directory: {}", e)))?;

        info!("Created server directory: {}", server_dir_path.display());

        // Replace variables in install script
        let mut final_script = install_script.to_string();
        for (key, value) in environment {
            let placeholder = format!("{{{{{}}}}}", key);
            let replacement = value.as_str().unwrap_or("");
            final_script = final_script.replace(&placeholder, replacement);
        }

        info!("Executing installation script");
        self.emit_console_output(server_id, "system", "[Catalyst] Starting installation...\n")
            .await?;

        // Execute the install script on the host
        // NOTE: Script handles its own directory with cd {{SERVER_DIR}}
        let mut command = tokio::process::Command::new("bash");
        command
            .arg("-c")
            .arg(&final_script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to execute install script: {}", e)))?;

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
        let mut stdout_buffer = String::new();
        let mut stderr_buffer = String::new();
        let mut stdout_done = false;
        let mut stderr_done = false;

        while !stdout_done || !stderr_done {
            tokio::select! {
                line = stdout_reader.next_line(), if !stdout_done => {
                    match line {
                        Ok(Some(entry)) => {
                            let payload = format!("{}\n", entry);
                            stdout_buffer.push_str(&payload);
                            self.emit_console_output(server_id, "stdout", &payload).await?;
                        }
                        Ok(None) => stdout_done = true,
                        Err(err) => {
                            stdout_done = true;
                            error!("Failed to read install stdout: {}", err);
                        }
                    }
                }
                line = stderr_reader.next_line(), if !stderr_done => {
                    match line {
                        Ok(Some(entry)) => {
                            let payload = format!("{}\n", entry);
                            stderr_buffer.push_str(&payload);
                            self.emit_console_output(server_id, "stderr", &payload).await?;
                        }
                        Ok(None) => stderr_done = true,
                        Err(err) => {
                            stderr_done = true;
                            error!("Failed to read install stderr: {}", err);
                        }
                    }
                }
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to wait for install script: {}", e)))?;

        if !status.success() {
            let stderr_trimmed = stderr_buffer.trim();
            let stdout_trimmed = stdout_buffer.trim();
            let reason = if !stderr_trimmed.is_empty() {
                stderr_trimmed.to_string()
            } else if !stdout_trimmed.is_empty() {
                stdout_trimmed.to_string()
            } else {
                "Install script failed".to_string()
            };
            self.emit_console_output(server_id, "stderr", &format!("{}\n", reason))
                .await?;
            self.emit_server_state_update(server_id, "error", Some(reason.clone()))
                .await?;
            return Err(AgentError::InstallationError(format!(
                "Install script failed: {}",
                reason
            )));
        }

        if stdout_buffer.trim().is_empty() && stderr_buffer.trim().is_empty() {
            self.emit_console_output(server_id, "system", "[Catalyst] Installation complete.\n")
                .await?;
        }

        // Emit state update
        self.emit_server_state_update(server_id, "stopped", None)
            .await?;

        info!("Server installed successfully: {}", server_uuid);
        Ok(())
    }

    fn spawn_log_stream(&self, server_id: &str, container_id: &str) {
        let handler = self.clone();
        let server_id = server_id.to_string();
        let container_id = container_id.to_string();
        tokio::spawn(async move {
            let stream_key = format!("{}:{}", server_id, container_id);
            {
                let mut guard = handler.active_log_streams.write().await;
                if guard.contains(&stream_key) {
                    return;
                }
                guard.insert(stream_key.clone());
            }
            if let Err(err) = handler
                .stream_container_logs(&server_id, &container_id)
                .await
            {
                error!(
                    "Failed to stream logs for server {} (container {}): {}",
                    server_id, container_id, err
                );
                let _ = handler
                    .emit_console_output(
                        &server_id,
                        "system",
                        &format!("[Catalyst] Log stream error: {}\n", err),
                    )
                    .await;
            }
            handler.active_log_streams.write().await.remove(&stream_key);
        });
    }

    async fn stream_container_logs(&self, server_id: &str, container_id: &str) -> AgentResult<()> {
        let mut child = self.runtime.spawn_log_stream(container_id).await?;
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
        let mut stdout_done = false;
        let mut stderr_done = false;

        while !stdout_done || !stderr_done {
            tokio::select! {
                line = stdout_reader.next_line(), if !stdout_done => {
                    match line? {
                        Some(entry) => {
                            let payload = format!("{}\n", entry);
                            self.emit_console_output(server_id, "stdout", &payload).await?;
                        }
                        None => stdout_done = true,
                    }
                }
                line = stderr_reader.next_line(), if !stderr_done => {
                    match line? {
                        Some(entry) => {
                            let payload = format!("{}\n", entry);
                            self.emit_console_output(server_id, "stderr", &payload).await?;
                        }
                        None => stderr_done = true,
                    }
                }
            }
        }

        let status = child.wait().await?;
        if !status.success() {
            warn!(
                "Log stream exited for server {} (container {}) with status {:?}",
                server_id,
                container_id,
                status.code()
            );
        }

        Ok(())
    }

    async fn start_server_with_details(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;

        let result: AgentResult<()> = async {
            let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
                AgentError::InvalidRequest("Missing serverUuid".to_string())
            })?;

            let template = msg["template"].as_object().ok_or_else(|| {
                AgentError::InvalidRequest("Missing template".to_string())
            })?;

            let docker_image = template.get("image")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AgentError::InvalidRequest("Missing image in template".to_string()))?;

            let startup_command = template.get("startup")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AgentError::InvalidRequest("Missing startup in template".to_string()))?;

            let memory_mb = msg["allocatedMemoryMb"].as_u64().ok_or_else(|| {
                AgentError::InvalidRequest("Missing allocatedMemoryMb".to_string())
            })?;

            let cpu_cores = msg["allocatedCpuCores"].as_u64().ok_or_else(|| {
                AgentError::InvalidRequest("Missing allocatedCpuCores".to_string())
            })?;

            let disk_mb = msg["allocatedDiskMb"].as_u64().unwrap_or(10240);

            let primary_port = msg["primaryPort"].as_u64().ok_or_else(|| {
                AgentError::InvalidRequest("Missing primaryPort".to_string())
            })? as u16;

            let network_mode = msg.get("networkMode")
                .and_then(|v| v.as_str());

            let environment = msg.get("environment")
                .and_then(|v| v.as_object())
                .ok_or_else(|| AgentError::InvalidRequest("Missing or invalid environment".to_string()))?;

            // Convert environment to HashMap
            let mut env_map = std::collections::HashMap::new();
            for (key, value) in environment {
                if let Some(val_str) = value.as_str() {
                    env_map.insert(key.clone(), val_str.to_string());
                }
            }

            // Get SERVER_DIR from environment
            let server_dir = environment.get("SERVER_DIR")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    format!("/tmp/catalyst-servers/{}", server_uuid)
                });

            let server_dir_path = PathBuf::from(&server_dir);
            self.storage_manager
                .ensure_mounted(server_uuid, &server_dir_path, disk_mb)
                .await?;

            info!("Starting server: {} (UUID: {})", server_id, server_uuid);
            info!("Image: {}, Port: {}, Memory: {}MB, CPU: {}",
                  docker_image, primary_port, memory_mb, cpu_cores);
            self.emit_console_output(server_id, "system", "[Catalyst] Starting server...\n")
                .await?;

            // Replace template variables in startup command
            let mut final_startup_command = startup_command.to_string();

            // Add MEMORY to environment for variable replacement
            env_map.insert("MEMORY".to_string(), memory_mb.to_string());
            env_map.insert("PORT".to_string(), primary_port.to_string());

            if !env_map.contains_key("MEMORY_XMS") {
                let memory_value = env_map
                    .get("MEMORY")
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(memory_mb);
                let xms_percent = env_map
                    .get("MEMORY_XMS_PERCENT")
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(50);
                let memory_xms = std::cmp::max(1, (memory_value * xms_percent) / 100);
                env_map.insert("MEMORY_XMS".to_string(), memory_xms.to_string());
            }

            // Replace all {{VARIABLE}} placeholders
            for (key, value) in &env_map {
                let placeholder = format!("{{{{{}}}}}", key);
                final_startup_command = final_startup_command.replace(&placeholder, value);
            }

            info!("Final startup command: {}", final_startup_command);

            let network_ip = env_map
                .get("CATALYST_NETWORK_IP")
                .or_else(|| env_map.get("AERO_NETWORK_IP"))
                .map(|value| value.as_str());

            // Create and start container
            self.runtime.create_container(
                server_id,
                docker_image,
                &final_startup_command,
                &env_map,
                memory_mb,
                cpu_cores,
                &server_dir,
                primary_port,
                network_mode,
                network_ip,
            ).await?;

            let is_running = match self.runtime.is_container_running(server_id).await {
                Ok(value) => value,
                Err(err) => {
                    error!("Failed to check container state for {}: {}", server_id, err);
                    false
                }
            };
            if !is_running {
                let reason = "Container exited immediately after start";
                if let Ok(logs) = self.runtime.get_logs(server_id, Some(100)).await {
                    if !logs.trim().is_empty() {
                        self.emit_console_output(server_id, "stderr", &logs).await?;
                    }
                }
                return Err(AgentError::ContainerError(reason.to_string()));
            }

            let container_id = self.resolve_container_id(server_id, server_uuid).await;
            if !container_id.is_empty() {
                self.spawn_log_stream(server_id, &container_id);
            }

            // Emit state update
            self.emit_server_state_update(server_id, "running", None)
                .await?;

            info!("Server started successfully: {}", server_id);
            Ok(())
        }.await;

        if let Err(err) = &result {
            let reason = format!("Start failed: {}", err);
            let _ = self.emit_console_output(server_id, "stderr", &format!("[Catalyst] {}\n", reason))
                .await;
            let _ = self.emit_server_state_update(server_id, "error", Some(reason)).await;
        }

        result
    }

    async fn start_server(&self, server_id: &str, container_id: String) -> AgentResult<()> {
        if container_id.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
        }
        info!("Starting server: {} (container {})", server_id, container_id);

        // In production, fetch server config from database or local cache
        match self.runtime.start_container(&container_id).await {
            Ok(()) => {
                self.spawn_log_stream(server_id, &container_id);
                self.emit_server_state_update(server_id, "running", None)
                    .await?;
                Ok(())
            }
            Err(err) => {
                let reason = format!("Start failed: {}", err);
                let _ = self.emit_console_output(server_id, "stderr", &format!("[Catalyst] {}\n", reason))
                    .await;
                let _ = self.emit_server_state_update(server_id, "error", Some(reason)).await;
                Err(err)
            }
        }
    }

    async fn stop_server(&self, server_id: &str, container_id: String) -> AgentResult<()> {
        if container_id.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
        }
        info!("Stopping server: {} (container {})", server_id, container_id);

        if self
            .runtime
            .is_container_running(&container_id)
            .await
            .unwrap_or(false)
        {
            self.runtime
                .stop_container(&container_id, 30)
                .await?;
        }

        if self.runtime.container_exists(&container_id).await {
            self.runtime.remove_container(&container_id).await?;
        }

        self.emit_server_state_update(server_id, "stopped", None)
            .await?;

        Ok(())
    }

    async fn kill_server(&self, server_id: &str, container_id: String) -> AgentResult<()> {
        if container_id.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
        }
        info!("Killing server: {} (container {})", server_id, container_id);

        self.runtime
            .kill_container(&container_id, "SIGKILL")
            .await?;

        if self.runtime.container_exists(&container_id).await {
            self.runtime.remove_container(&container_id).await?;
        }

        self.emit_server_state_update(server_id, "crashed", Some("Killed by agent".to_string()))
            .await?;

        Ok(())
    }

    async fn handle_console_input(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;

        let data = msg["data"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing data".to_string())
        })?;

        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if container_id.is_empty() {
            let err = AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            ));
            let _ = self.emit_console_output(
                server_id,
                "stderr",
                &format!("[Catalyst] Console input failed: {}\n", err),
            )
            .await;
            return Err(err);
        }

        debug!(
            "Console input for {} (container {}): {}",
            server_id, container_id, data
        );

        self.spawn_log_stream(server_id, &container_id);

        // Send to container stdin
        if let Err(err) = self.runtime.send_input(&container_id, data).await {
            let _ = self.emit_console_output(
                server_id,
                "stderr",
                &format!("[Catalyst] Console input failed: {}\n", err),
            )
            .await;
            return Err(err);
        }

        Ok(())
    }

    async fn handle_file_operation(&self, msg: &Value) -> AgentResult<()> {
        let op_type = msg["type"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing type".to_string())
        })?;

        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;

        let path = msg["path"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing path".to_string())
        })?;

        match op_type {
               "read" => { self.file_manager.read_file(server_id, path).await?; }
            "write" => {
                let data = msg["data"].as_str().ok_or_else(|| {
                    AgentError::InvalidRequest("Missing data".to_string())
                })?;
                self.file_manager.write_file(server_id, path, data).await?;
            }
               "delete" => { self.file_manager.delete_file(server_id, path).await?; }
               "list" => { self.file_manager.list_dir(server_id, path).await?; }
            _ => {
                return Err(AgentError::InvalidRequest(format!(
                    "Unknown file operation: {}",
                    op_type
                )))
            }
        }

        Ok(())
    }

    async fn handle_create_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;
        let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverUuid".to_string())
        })?;
        let backup_name = msg["backupName"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing backupName".to_string())
        })?;
        let backup_path_override = msg["backupPath"].as_str();
        let backup_id = msg["backupId"].as_str();

        let server_dir = msg["serverDir"]
            .as_str()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(self.config.server.data_dir.as_path()).join(server_uuid));
        let default_backup_dir = PathBuf::from("/var/lib/catalyst/backups").join(server_uuid);
        let backup_path = backup_path_override
            .map(PathBuf::from)
            .unwrap_or_else(|| default_backup_dir.join(format!("{}.tar.gz", backup_name)));
        let backup_dir = backup_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or(default_backup_dir);

        if !server_dir.exists() {
            return Err(AgentError::NotFound(format!(
                "Server directory not found: {}",
                server_dir.display()
            )));
        }

        tokio::fs::create_dir_all(&backup_dir).await?;

        info!(
            "Creating backup {} for server {} at {}",
            backup_name,
            server_id,
            backup_path.display()
        );

        let archive_result = tokio::process::Command::new("tar")
            .arg("-czf")
            .arg(&backup_path)
            .arg("-C")
            .arg(&server_dir)
            .arg(".")
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run tar: {}", e)))?;

        if !archive_result.status.success() {
            let stderr = String::from_utf8_lossy(&archive_result.stderr);
            return Err(AgentError::IoError(format!("Backup archive failed: {}", stderr)));
        }

        let metadata = tokio::fs::metadata(&backup_path).await.map_err(|e| {
            AgentError::IoError(format!("Failed to read backup metadata: {}", e))
        })?;
        let size_mb = metadata.len() as f64 / (1024.0 * 1024.0);

        let mut file = tokio::fs::File::open(&backup_path).await?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).await?;
        let checksum = format!("{:x}", Sha256::digest(&buffer));

        let event = json!({
            "type": "backup_complete",
            "serverId": server_id,
            "backupName": backup_name,
            "backupPath": backup_path.to_string_lossy(),
            "sizeMb": size_mb,
            "checksum": checksum,
            "backupId": backup_id,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    async fn handle_restore_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;
        let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverUuid".to_string())
        })?;
        let backup_path = msg["backupPath"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing backupPath".to_string())
        })?;

        let server_dir = msg["serverDir"]
            .as_str()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(self.config.server.data_dir.as_path()).join(server_uuid));
        let backup_file = PathBuf::from(backup_path);

        if !backup_file.exists() {
            return Err(AgentError::NotFound(format!(
                "Backup file not found: {}",
                backup_file.display()
            )));
        }

        tokio::fs::create_dir_all(&server_dir).await?;

        info!(
            "Restoring backup {} for server {} into {}",
            backup_file.display(),
            server_id,
            server_dir.display()
        );

        let restore_result = tokio::process::Command::new("tar")
            .arg("-xzf")
            .arg(&backup_file)
            .arg("-C")
            .arg(&server_dir)
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run tar: {}", e)))?;

        if !restore_result.status.success() {
            let stderr = String::from_utf8_lossy(&restore_result.stderr);
            return Err(AgentError::IoError(format!("Backup restore failed: {}", stderr)));
        }

        let event = json!({
            "type": "backup_restore_complete",
            "serverId": server_id,
            "backupPath": backup_path,
        });

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    async fn handle_delete_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;
        let backup_path = msg["backupPath"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing backupPath".to_string())
        })?;

        let backup_file = PathBuf::from(backup_path);
        if backup_file.exists() {
            tokio::fs::remove_file(&backup_file).await?;
        }

        let event = json!({
            "type": "backup_delete_complete",
            "serverId": server_id,
            "backupPath": backup_path,
        });

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    async fn handle_download_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing requestId".to_string())
        })?;
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;
        let backup_path = msg["backupPath"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing backupPath".to_string())
        })?;

        let backup_file = PathBuf::from(backup_path);
        if !backup_file.exists() {
            let event = json!({
                "type": "backup_download_chunk",
                "requestId": request_id,
                "serverId": server_id,
                "error": "Backup file not found",
                "done": true,
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        let mut file = match tokio::fs::File::open(&backup_file).await {
            Ok(file) => file,
            Err(err) => {
                let event = json!({
                    "type": "backup_download_chunk",
                    "requestId": request_id,
                    "serverId": server_id,
                    "error": format!("Failed to open backup file: {}", err),
                    "done": true,
                });
                let mut w = write.lock().await;
                w.send(Message::Text(event.to_string()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                return Ok(());
            }
        };
        let mut buffer = vec![0u8; 256 * 1024];
        let mut w = write.lock().await;

        loop {
            let read = match file.read(&mut buffer).await {
                Ok(read) => read,
                Err(err) => {
                    let event = json!({
                        "type": "backup_download_chunk",
                        "requestId": request_id,
                        "serverId": server_id,
                        "error": format!("Failed to read backup file: {}", err),
                        "done": true,
                    });
                    w.send(Message::Text(event.to_string()))
                        .await
                        .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                    break;
                }
            };
            if read == 0 {
                let done_event = json!({
                    "type": "backup_download_chunk",
                    "requestId": request_id,
                    "serverId": server_id,
                    "done": true,
                });
                w.send(Message::Text(done_event.to_string()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                break;
            }

            let chunk = base64::engine::general_purpose::STANDARD.encode(&buffer[..read]);
            let event = json!({
                "type": "backup_download_chunk",
                "requestId": request_id,
                "serverId": server_id,
                "data": chunk,
                "done": false,
            });
            w.send(Message::Text(event.to_string()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        }

        Ok(())
    }

    async fn handle_resize_storage(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;
        let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverUuid".to_string())
        })?;
        let allocated_disk_mb = msg["allocatedDiskMb"].as_u64().ok_or_else(|| {
            AgentError::InvalidRequest("Missing allocatedDiskMb".to_string())
        })?;

        let server_dir = PathBuf::from(self.config.server.data_dir.as_path()).join(server_uuid);
        let allow_online_grow = true;

        let result = self
            .storage_manager
            .resize(server_uuid, &server_dir, allocated_disk_mb, allow_online_grow)
            .await;

        let event = match &result {
            Ok(_) => json!({
                "type": "storage_resize_complete",
                "serverId": server_id,
                "serverUuid": server_uuid,
                "allocatedDiskMb": allocated_disk_mb,
                "success": true,
            }),
            Err(err) => json!({
                "type": "storage_resize_complete",
                "serverId": server_id,
                "serverUuid": server_uuid,
                "allocatedDiskMb": allocated_disk_mb,
                "success": false,
                "error": err.to_string(),
            }),
        };

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        if let Err(err) = result {
            return Err(err);
        }

        Ok(())
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

        debug!("Emitting state update: {}", msg);

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(msg.to_string())).await {
                error!("Failed to send state update: {}", err);
            }
        }

        Ok(())
    }

    async fn emit_console_output(&self, server_id: &str, stream: &str, data: &str) -> AgentResult<()> {
        if data.is_empty() {
            return Ok(());
        }

        let msg = json!({
            "type": "console_output",
            "serverId": server_id,
            "stream": stream,
            "data": data,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(msg.to_string())).await {
                error!("Failed to send console output: {}", err);
            }
        }

        Ok(())
    }

    pub async fn send_health_report(&self) -> AgentResult<()> {
        debug!("Sending health report");
        let containers = self.runtime.list_containers().await?;
        let mut system = System::new();
        system.refresh_cpu();
        system.refresh_memory();
        let cpu_percent = system.global_cpu_info().cpu_usage();
        let memory_usage_mb = (system.used_memory() / 1024) as u64;
        let memory_total_mb = (system.total_memory() / 1024) as u64;
        let mut disks = Disks::new_with_refreshed_list();
        disks.refresh();
        let mut disk_usage_mb = 0u64;
        let mut disk_total_mb = 0u64;
        for disk in disks.list() {
            disk_total_mb += disk.total_space() / (1024 * 1024);
            disk_usage_mb += disk
                .total_space()
                .saturating_sub(disk.available_space())
                / (1024 * 1024);
        }

        let health = json!({
            "type": "health_report",
            "nodeId": self.config.server.node_id,
            "timestamp": chrono::Utc::now().timestamp_millis(),
            "cpuPercent": cpu_percent,
            "memoryUsageMb": memory_usage_mb,
            "memoryTotalMb": memory_total_mb,
            "diskUsageMb": disk_usage_mb,
            "diskTotalMb": disk_total_mb,
            "containerCount": containers.len(),
            "uptimeSeconds": get_uptime(),
        });

        debug!("Health report: {}", health);

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            w.send(Message::Text(health.to_string()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        }

        Ok(())
    }

    pub async fn send_resource_stats(&self) -> AgentResult<()> {
        let containers = self.runtime.list_containers().await?;
        if containers.is_empty() {
            return Ok(());
        }

        let writer = { self.write.read().await.clone() };
        let Some(ws) = writer else {
            return Ok(());
        };

        for container in containers {
            if !container.status.contains("Up") {
                continue;
            }

            let server_uuid = normalize_container_name(&container.names);
            if server_uuid.is_empty() {
                continue;
            }

            let stats = match self.runtime.get_stats(&container.id).await {
                Ok(stats) => stats,
                Err(err) => {
                    warn!("Failed to fetch stats for container {}: {}", container.id, err);
                    continue;
                }
            };

            let cpu_percent = parse_percent(&stats.cpu_percent).unwrap_or(0.0);
            let memory_usage_mb = parse_memory_usage_mb(&stats.memory_usage).unwrap_or(0);
            let (network_rx_bytes, network_tx_bytes) = parse_io_pair_bytes(&stats.net_io).unwrap_or((0, 0));
            let (disk_read_bytes, disk_write_bytes) = parse_io_pair_bytes(&stats.block_io).unwrap_or((0, 0));
            let disk_io_mb = ((disk_read_bytes + disk_write_bytes) / (1024 * 1024)) as u64;
            let (disk_usage_mb, disk_total_mb) = match self
                .runtime
                .exec(&container.id, vec!["df", "-m", "/data"])
                .await
                .ok()
                .and_then(|output| parse_df_output_mb(&output))
                .map(|(used_mb, total_mb)| (used_mb, total_mb))
            {
                Some(value) => value,
                None => {
                    warn!(
                        "Failed to read filesystem usage for container {}. Falling back to block IO stats.",
                        container.id
                    );
                    (disk_io_mb, 0)
                }
            };

            let payload = json!({
                "type": "resource_stats",
                "serverUuid": server_uuid,
                "cpuPercent": cpu_percent,
                "memoryUsageMb": memory_usage_mb,
                "networkRxBytes": network_rx_bytes,
                "networkTxBytes": network_tx_bytes,
                "diskIoMb": disk_io_mb,
                "diskUsageMb": disk_usage_mb,
                "diskTotalMb": disk_total_mb,
                "timestamp": chrono::Utc::now().timestamp_millis(),
            });

            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(payload.to_string())).await {
                warn!("Failed to send resource stats: {}", err);
                break;
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
       async fn heartbeat_loop_static() {
           let mut interval = tokio::time::interval(Duration::from_secs(30));

           loop {
               interval.tick().await;
               debug!("Sending heartbeat");
               // Send heartbeat message
           }
       }

fn get_uptime() -> u64 {
    // Simplified uptime calculation
   std::fs::read_to_string("/proc/uptime")
       .ok()
       .and_then(|s| s.split_whitespace().next().map(|first| first.parse::<f64>().ok()))
       .flatten()
       .map(|u| u as u64)
       .unwrap_or(0)
}

fn normalize_container_name(name: &str) -> String {
    name.split(|c: char| c == ',' || c.is_whitespace())
        .find(|part| !part.trim().is_empty())
        .unwrap_or("")
        .trim()
        .trim_start_matches('/')
        .to_string()
}

fn parse_percent(value: &str) -> Option<f64> {
    let trimmed = value.trim().trim_end_matches('%').trim();
    trimmed.parse::<f64>().ok()
}

fn parse_memory_usage_mb(value: &str) -> Option<u64> {
    let first = value.split('/').next()?.trim();
    parse_size_to_bytes(first).map(|bytes| (bytes / (1024 * 1024)) as u64)
}

fn parse_io_pair_bytes(value: &str) -> Option<(u64, u64)> {
    let mut parts = value.split('/');
    let left = parts.next()?.trim();
    let right = parts.next()?.trim();
    let left_bytes = parse_size_to_bytes(left)?;
    let right_bytes = parse_size_to_bytes(right)?;
    Some((left_bytes, right_bytes))
}

fn parse_size_to_bytes(value: &str) -> Option<u64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let re = Regex::new(r"(?i)^\s*([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?i?b?)?\s*$").ok()?;
    let caps = re.captures(trimmed)?;
    let number = caps.get(1)?.as_str().parse::<f64>().ok()?;
    let unit = caps.get(2).map(|m| m.as_str().to_lowercase()).unwrap_or_default();
    let multiplier = match unit.as_str() {
        "" | "b" => 1f64,
        "k" | "kb" => 1_000f64,
        "ki" | "kib" => 1_024f64,
        "m" | "mb" => 1_000_000f64,
        "mi" | "mib" => 1_048_576f64,
        "g" | "gb" => 1_000_000_000f64,
        "gi" | "gib" => 1_073_741_824f64,
        "t" | "tb" => 1_000_000_000_000f64,
        "ti" | "tib" => 1_099_511_627_776f64,
        _ => return None,
    };
    Some((number * multiplier).round() as u64)
}

fn parse_df_output_mb(output: &str) -> Option<(u64, u64)> {
    let mut lines = output.lines().filter(|line| !line.trim().is_empty());
    let header = lines.next()?;
    if !header.to_lowercase().contains("filesystem") {
        return None;
    }
    let data = lines.next()?;
    let parts: Vec<&str> = data.split_whitespace().collect();
    if parts.len() < 6 {
        return None;
    }
    let total_mb = parts[1].parse::<u64>().ok()?;
    let used_mb = parts[2].parse::<u64>().ok()?;
    Some((used_mb, total_mb))
}
