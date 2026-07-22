use sqlx::PgPool;
use tokio::fs;
use tokio::time::{Duration, interval};
use uuid::Uuid;

use crate::db::files::{
    FilePurgeTarget, get_user_file_for_permanent_delete, hard_delete_file_record,
    list_expired_deleted_files, list_file_version_storage_paths,
};
use crate::db::folders::{hard_delete_folder_tree, list_deleted_folder_file_targets};

const PURGE_BATCH_SIZE: i64 = 100;

#[derive(Debug)]
pub enum TrashPurgeError {
    Database(sqlx::Error),
    Storage(std::io::Error),
}

impl std::fmt::Display for TrashPurgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(err) => write!(f, "{err}"),
            Self::Storage(err) => write!(f, "{err}"),
        }
    }
}

impl From<sqlx::Error> for TrashPurgeError {
    fn from(err: sqlx::Error) -> Self {
        Self::Database(err)
    }
}

impl From<std::io::Error> for TrashPurgeError {
    fn from(err: std::io::Error) -> Self {
        Self::Storage(err)
    }
}

pub async fn permanently_delete_user_file(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<bool, TrashPurgeError> {
    let Some(target) = get_user_file_for_permanent_delete(pool, user_id, file_id).await? else {
        return Ok(false);
    };

    purge_target(pool, target, false).await?;
    Ok(true)
}

pub async fn permanently_delete_user_folder(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<bool, TrashPurgeError> {
    let targets = list_deleted_folder_file_targets(pool, user_id, folder_id).await?;
    for target in targets {
        purge_target(pool, target, false).await?;
    }

    let deleted_folders = hard_delete_folder_tree(pool, user_id, folder_id).await?;
    Ok(deleted_folders > 0)
}

pub fn spawn_trash_purge_worker(pool: PgPool, retention_days: i64, interval_hours: u64) {
    tokio::spawn(async move {
        purge_expired_files(&pool, retention_days).await;

        let mut ticker = interval(Duration::from_secs(
            interval_hours.saturating_mul(3600).max(1),
        ));
        loop {
            ticker.tick().await;
            purge_expired_files(&pool, retention_days).await;
        }
    });
}

async fn purge_expired_files(pool: &PgPool, retention_days: i64) {
    loop {
        let targets = match list_expired_deleted_files(pool, retention_days, PURGE_BATCH_SIZE).await
        {
            Ok(targets) => targets,
            Err(err) => {
                tracing::error!(error = %err, "trash purge failed to list expired files");
                return;
            }
        };

        if targets.is_empty() {
            return;
        }

        let count = targets.len();
        for target in targets {
            if let Err(err) = purge_target(pool, target, true).await {
                tracing::error!(error = %err, "trash purge failed to purge file");
            }
        }

        if count < PURGE_BATCH_SIZE as usize {
            return;
        }
    }
}

async fn purge_target(
    pool: &PgPool,
    target: FilePurgeTarget,
    defer_storage_errors: bool,
) -> Result<(), TrashPurgeError> {
    let mut storage_paths = list_file_version_storage_paths(pool, target.id).await?;
    storage_paths.push(target.storage_path.clone());
    storage_paths.sort();
    storage_paths.dedup();

    for storage_path in storage_paths {
        if !remove_storage_path(&storage_path, target.id, defer_storage_errors).await? {
            return Ok(());
        }
    }

    hard_delete_file_record(pool, target.id).await?;
    Ok(())
}

async fn remove_storage_path(
    storage_path: &str,
    file_id: Uuid,
    defer_storage_errors: bool,
) -> Result<bool, TrashPurgeError> {
    match fs::remove_file(storage_path).await {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            if defer_storage_errors {
                tracing::error!(
                    file_id = %file_id,
                    error = %err,
                    "trash purge failed to remove binary"
                );
                return Ok(false);
            }

            return Err(err.into());
        }
    }

    Ok(true)
}
