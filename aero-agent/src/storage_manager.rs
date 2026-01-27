use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::task::spawn_blocking;
use tracing::info;

use crate::{AgentError, AgentResult};

pub struct StorageManager {
    data_dir: PathBuf,
}

impl StorageManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    pub async fn ensure_mounted(
        &self,
        server_uuid: &str,
        mount_dir: &Path,
        size_mb: u64,
    ) -> AgentResult<PathBuf> {
        let image_path = self.image_path(server_uuid);
        fs::create_dir_all(self.images_dir()).await?;
        fs::create_dir_all(mount_dir).await?;

        if self.is_mounted(mount_dir).await? {
            return Ok(image_path);
        }

        if !image_path.exists() {
            self.create_image(&image_path, size_mb).await?;
        }

        if self.dir_has_data(mount_dir).await? {
            self.migrate_existing_data(server_uuid, mount_dir, &image_path)
                .await?;
        }

        self.mount_image(&image_path, mount_dir).await?;
        Ok(image_path)
    }

    pub async fn resize(
        &self,
        server_uuid: &str,
        mount_dir: &Path,
        size_mb: u64,
        allow_online_grow: bool,
    ) -> AgentResult<()> {
        let image_path = self.image_path(server_uuid);
        if !image_path.exists() {
            return Err(AgentError::NotFound("Storage image not found".to_string()));
        }

        let current_mb = self.image_size_mb(&image_path).await?;
        if size_mb == current_mb {
            return Ok(());
        }

        if size_mb > current_mb {
            self.grow_image(&image_path, mount_dir, size_mb, allow_online_grow)
                .await?;
            return Ok(());
        }

        if self.is_mounted(mount_dir).await? {
            self.unmount(mount_dir).await?;
        }

        self.shrink_image(&image_path, size_mb).await?;
        self.mount_image(&image_path, mount_dir).await?;
        Ok(())
    }

    fn images_dir(&self) -> PathBuf {
        self.data_dir.join("images")
    }

    fn image_path(&self, server_uuid: &str) -> PathBuf {
        self.images_dir().join(format!("{}.img", server_uuid))
    }

    async fn image_size_mb(&self, image_path: &Path) -> AgentResult<u64> {
        let metadata = fs::metadata(image_path).await?;
        Ok(metadata.len() / (1024 * 1024))
    }

    async fn create_image(&self, image_path: &Path, size_mb: u64) -> AgentResult<()> {
        let image = image_path.to_path_buf();
        let size = size_mb;
        spawn_blocking(move || -> AgentResult<()> {
            info!("Creating storage image {} ({} MB)", image.display(), size);
            let image_str = image
                .to_str()
                .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?;
            run("fallocate", &["-l", &format!("{}M", size), image_str])?;
            run("mkfs.ext4", &["-F", image_str])?;
            Ok(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Storage create task failed: {}", e)))?
    }

    async fn migrate_existing_data(
        &self,
        server_uuid: &str,
        mount_dir: &Path,
        image_path: &Path,
    ) -> AgentResult<()> {
        let migrate_dir = self.data_dir.join("migrate").join(server_uuid);
        if migrate_dir.exists() {
            return Err(AgentError::FileSystemError(format!(
                "Migration directory already exists: {}",
                migrate_dir.display()
            )));
        }
        fs::create_dir_all(&migrate_dir).await?;

        info!("Migrating existing data for {}", server_uuid);
        self.mount_image(image_path, &migrate_dir).await?;
        let src = format!("{}/", mount_dir.display());
        let dst = format!("{}/", migrate_dir.display());
        run("rsync", &["-a", src.as_str(), dst.as_str()])?;
        self.unmount(&migrate_dir).await?;
        self.clear_dir(mount_dir).await?;
        fs::remove_dir_all(&migrate_dir).await?;
        Ok(())
    }

    async fn clear_dir(&self, dir: &Path) -> AgentResult<()> {
        let mut entries = fs::read_dir(dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(&path).await?;
            } else {
                fs::remove_file(&path).await?;
            }
        }
        Ok(())
    }

    async fn grow_image(
        &self,
        image_path: &Path,
        mount_dir: &Path,
        size_mb: u64,
        allow_online_grow: bool,
    ) -> AgentResult<()> {
        if allow_online_grow && self.is_mounted(mount_dir).await? {
            run(
                "fallocate",
                &["-l", &format!("{}M", size_mb), image_path.to_str().unwrap()],
            )?;
            run("resize2fs", &[mount_dir.to_str().unwrap()])?;
            return Ok(());
        }
        if self.is_mounted(mount_dir).await? {
            self.unmount(mount_dir).await?;
        }
        run(
            "fallocate",
            &["-l", &format!("{}M", size_mb), image_path.to_str().unwrap()],
        )?;
        run("resize2fs", &[image_path.to_str().unwrap()])?;
        Ok(())
    }

    async fn shrink_image(&self, image_path: &Path, size_mb: u64) -> AgentResult<()> {
        run("e2fsck", &["-f", image_path.to_str().unwrap()])?;
        run(
            "resize2fs",
            &[image_path.to_str().unwrap(), &format!("{}M", size_mb)],
        )?;
        run(
            "fallocate",
            &["-l", &format!("{}M", size_mb), image_path.to_str().unwrap()],
        )?;
        Ok(())
    }

    async fn mount_image(&self, image_path: &Path, mount_dir: &Path) -> AgentResult<()> {
        run(
            "mount",
            &[
                "-o",
                "loop",
                image_path.to_str().unwrap(),
                mount_dir.to_str().unwrap(),
            ],
        )?;
        Ok(())
    }

    async fn unmount(&self, mount_dir: &Path) -> AgentResult<()> {
        run("umount", &[mount_dir.to_str().unwrap()])?;
        Ok(())
    }

    async fn is_mounted(&self, mount_dir: &Path) -> AgentResult<bool> {
        let mounts = fs::read_to_string("/proc/mounts").await?;
        let target = mount_dir.to_string_lossy();
        for line in mounts.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() > 1 && parts[1] == target {
                return Ok(true);
            }
        }
        Ok(false)
    }

    async fn dir_has_data(&self, dir: &Path) -> AgentResult<bool> {
        let mut entries = fs::read_dir(dir).await?;
        Ok(entries.next_entry().await?.is_some())
    }
}

fn run(command: &str, args: &[&str]) -> AgentResult<()> {
    let status = std::process::Command::new(command)
        .args(args)
        .status()
        .map_err(|e| AgentError::FileSystemError(format!("Failed to run {}: {}", command, e)))?;
    if !status.success() {
        return Err(AgentError::FileSystemError(format!(
            "{} failed with status {}",
            command,
            status
        )));
    }
    Ok(())
}
