use std::sync::Arc;
use std::path::PathBuf;
use tokio::sync::RwLock;
use sysinfo::{Disks, System};
use tokio::io::AsyncReadExt;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::connect_async;
use futures::{SinkExt, StreamExt};
use futures::stream::SplitSink;
use sha2::{Digest, Sha256};
use base64::Engine;
use tracing::{info, error, warn, debug};
use serde_json::{json, Value};
use std::time::Duration;

use crate::{AgentConfig, ContainerdRuntime, FileManager, AgentError, AgentResult};

type WsStream = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;
type WsWrite = SplitSink<WsStream, Message>;

pub struct WebSocketHandler {
    config: Arc<AgentConfig>,
    runtime: Arc<ContainerdRuntime>,
    file_manager: Arc<FileManager>,
    write: Arc<RwLock<Option<Arc<tokio::sync::Mutex<WsWrite>>>>>,
}

impl Clone for WebSocketHandler {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime: self.runtime.clone(),
            file_manager: self.file_manager.clone(),
            write: self.write.clone(),
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
            write: Arc::new(RwLock::new(None)),
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
                let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
                    AgentError::InvalidRequest("Missing serverUuid".to_string())
                })?;
                self.start_server_with_details(&msg).await?;
            }
            Some("stop_server") => {
                let server_uuid = msg["serverUuid"].as_str().ok_or_else(|| {
                    AgentError::InvalidRequest("Missing serverUuid".to_string())
                })?;
                self.stop_server(server_uuid).await?;
            }
            Some("console_input") => self.handle_console_input(&msg).await?,
            Some("file_operation") => self.handle_file_operation(&msg).await?,
            Some("create_backup") => self.handle_create_backup(&msg, write).await?,
            Some("restore_backup") => self.handle_restore_backup(&msg, write).await?,
            Some("delete_backup") => self.handle_delete_backup(&msg, write).await?,
            Some("download_backup") => self.handle_download_backup(&msg, write).await?,
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
                format!("/tmp/aero-servers/{}", server_uuid)
            });
        
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

        // Execute the install script on the host
        // NOTE: Script handles its own directory with cd {{SERVER_DIR}}
        let output = tokio::process::Command::new("bash")
            .arg("-c")
            .arg(&final_script)
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to execute install script: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Installation failed: {}", stderr);
            return Err(AgentError::InstallationError(format!(
                "Install script failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        info!("Installation output: {}", stdout);

        // Emit state update
        self.emit_server_state_update(server_id, "stopped", None)
            .await?;

        info!("Server installed successfully: {}", server_uuid);
        Ok(())
    }

    async fn start_server_with_details(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"].as_str().ok_or_else(|| {
            AgentError::InvalidRequest("Missing serverId".to_string())
        })?;

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
                format!("/tmp/aero-servers/{}", server_uuid)
            });

        info!("Starting server: {} (UUID: {})", server_id, server_uuid);
        info!("Image: {}, Port: {}, Memory: {}MB, CPU: {}", 
              docker_image, primary_port, memory_mb, cpu_cores);

        // Replace template variables in startup command
        let mut final_startup_command = startup_command.to_string();
        
        // Add MEMORY to environment for variable replacement
        env_map.insert("MEMORY".to_string(), memory_mb.to_string());
        env_map.insert("PORT".to_string(), primary_port.to_string());
        
        // Replace all {{VARIABLE}} placeholders
        for (key, value) in &env_map {
            let placeholder = format!("{{{{{}}}}}", key);
            final_startup_command = final_startup_command.replace(&placeholder, value);
        }

        info!("Final startup command: {}", final_startup_command);

        let network_ip = env_map.get("AERO_NETWORK_IP").map(|value| value.as_str());

        // Create and start container
        self.runtime.create_container(
            server_uuid,
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

        // Emit state update
        self.emit_server_state_update(server_id, "running", None)
            .await?;

        Ok(())
    }

    async fn stop_server(&self, server_id: &str) -> AgentResult<()> {
        info!("Stopping server: {}", server_id);

        self.runtime
            .stop_container(server_id, 30)
            .await?;

        self.emit_server_state_update(server_id, "stopped", None)
            .await?;

        Ok(())
    }

    async fn kill_server(&self, server_id: &str) -> AgentResult<()> {
        info!("Killing server: {}", server_id);

        self.runtime
            .kill_container(server_id, "SIGKILL")
            .await?;

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

        debug!("Console input for {}: {}", server_id, data);

        // Send to container stdin
        self.runtime.send_input(server_id, data).await?;

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
        let default_backup_dir = PathBuf::from("/var/lib/aero/backups").join(server_uuid);
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

        // In production, this would send to the backend via the WebSocket
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
