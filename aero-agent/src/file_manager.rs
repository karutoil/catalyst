use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{info, warn, error, debug};

use crate::{AgentError, AgentResult};

const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024; // 100MB

pub struct FileManager {
    data_dir: PathBuf,
}

impl FileManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    /// Validate and resolve a path within the container's data directory
    fn resolve_path(&self, server_id: &str, requested_path: &str) -> AgentResult<PathBuf> {
        let server_base = self.data_dir.join(server_id);
        let requested = PathBuf::from(requested_path);

        // Prevent directory traversal
        let normalized = if requested.is_absolute() {
            self.data_dir.join(requested_path.trim_start_matches('/'))
        } else {
            server_base.join(requested_path)
        };

        // Ensure the path is within the server's data directory
        let canonical = normalized
            .canonicalize()
            .or_else(|_| {
                // If canonicalize fails, try to create parent and check
                let parent = normalized.parent().unwrap_or(&self.data_dir);
                parent.canonicalize().map(|_| normalized.clone())
            })
            .map_err(|_| {
                AgentError::PermissionDenied(format!(
                    "Path traversal attempt detected: {}",
                    requested_path
                ))
            })?;

        let canonical_base = server_base
            .canonicalize()
            .unwrap_or(server_base.clone());

        if !canonical.starts_with(&canonical_base) {
            return Err(AgentError::PermissionDenied(
                "Access denied: path outside data directory".to_string(),
            ));
        }

        Ok(canonical)
    }

    pub async fn read_file(&self, server_id: &str, path: &str) -> AgentResult<Vec<u8>> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Reading file: {:?}", full_path);

        // Check file size limit
        let metadata = fs::metadata(&full_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Cannot access file: {}", e)))?;

        if metadata.len() > MAX_FILE_SIZE {
            return Err(AgentError::FileSystemError(
                format!("File too large: {} > {}MB", metadata.len(), MAX_FILE_SIZE / 1024 / 1024),
            ));
        }

        let content = fs::read(&full_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to read file: {}", e)))?;

        info!("File read successfully: {:?} ({} bytes)", full_path, content.len());

        Ok(content)
    }

    pub async fn write_file(&self, server_id: &str, path: &str, data: &str) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Writing file: {:?}", full_path);

        // Create parent directories if needed
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to create dir: {}", e)))?;
        }

        // Check size limit before writing
        if data.len() as u64 > MAX_FILE_SIZE {
            return Err(AgentError::FileSystemError(
                format!(
                    "File too large: {} > {}MB",
                    data.len(),
                    MAX_FILE_SIZE / 1024 / 1024
                ),
            ));
        }

        fs::write(&full_path, data.as_bytes())
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to write file: {}", e)))?;

        info!("File written successfully: {:?}", full_path);

        Ok(())
    }

    pub async fn delete_file(&self, server_id: &str, path: &str) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Deleting file: {:?}", full_path);

        fs::remove_file(&full_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to delete file: {}", e)))?;

        info!("File deleted successfully: {:?}", full_path);

        Ok(())
    }

    pub async fn list_dir(&self, server_id: &str, path: &str) -> AgentResult<Vec<FileEntry>> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Listing directory: {:?}", full_path);

        let mut entries = Vec::new();
        let mut dir = fs::read_dir(&full_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to read dir: {}", e)))?;

        while let Some(entry) = dir
            .next_entry()
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Error reading dir entry: {}", e)))?
        {
            let metadata = entry
                .metadata()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to get metadata: {}", e)))?;

            let name = entry
                .file_name()
                .to_string_lossy()
                .to_string();

            let is_dir = metadata.is_dir();

            entries.push(FileEntry {
                name,
                is_dir,
                size: if is_dir { 0 } else { metadata.len() },
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_secs())
                    })
                    .unwrap_or(0),
            });
        }

        info!("Directory listed: {:?} ({} entries)", full_path, entries.len());

        Ok(entries)
    }

    pub async fn compress_directory(
        &self,
        server_id: &str,
        path: &str,
    ) -> AgentResult<Vec<u8>> {
        let full_path = self.resolve_path(server_id, path)?;

        info!("Compressing directory: {:?}", full_path);

        // This is a placeholder - in production, use flate2 or zip crate
        Err(AgentError::InternalError(
            "Compression not yet implemented".to_string(),
        ))
    }

    pub async fn decompress_archive(
        &self,
        server_id: &str,
        path: &str,
        archive: &[u8],
    ) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;

        info!("Decompressing archive to: {:?}", full_path);

        // This is a placeholder - in production, use flate2 or zip crate
        Err(AgentError::InternalError(
            "Decompression not yet implemented".to_string(),
        ))
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}
