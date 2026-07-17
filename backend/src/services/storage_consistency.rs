use std::collections::HashSet;
use std::path::{Path, PathBuf};

use sqlx::PgPool;
use tokio::fs;
use tokio::time::{Duration, interval};
use uuid::Uuid;

use crate::db::storage::reconcile_all_storage_quotas;

pub fn spawn_storage_consistency_worker(pool: PgPool, upload_dir: PathBuf, interval_hours: u64) {
    tokio::spawn(async move {
        inspect_storage(&pool, &upload_dir).await;

        let mut ticker = interval(Duration::from_secs(
            interval_hours.saturating_mul(3600).max(1),
        ));
        loop {
            ticker.tick().await;
            inspect_storage(&pool, &upload_dir).await;
        }
    });
}

async fn inspect_storage(pool: &PgPool, upload_dir: &Path) {
    match reconcile_all_storage_quotas(pool).await {
        Ok(rows) if rows > 0 => {
            eprintln!("storage consistency: reconciled {rows} quota rows");
        }
        Ok(_) => {}
        Err(err) => {
            eprintln!("storage consistency: failed to reconcile quotas: {err}");
        }
    }

    let records = match list_storage_records(pool).await {
        Ok(records) => records,
        Err(err) => {
            eprintln!("storage consistency: failed to list file records: {err}");
            return;
        }
    };

    let known_paths: HashSet<PathBuf> = records
        .iter()
        .map(|(_, storage_path)| PathBuf::from(storage_path))
        .collect();

    for (id, storage_path) in &records {
        if fs::metadata(storage_path).await.is_err() {
            eprintln!(
                "storage consistency: record {id} references missing binary at {storage_path}"
            );
        }
    }

    let disk_paths = match list_disk_binaries(upload_dir).await {
        Ok(paths) => paths,
        Err(err) => {
            eprintln!("storage consistency: failed to scan upload dir: {err}");
            return;
        }
    };

    for path in disk_paths {
        if !known_paths.contains(&path) {
            eprintln!(
                "storage consistency: binary has no file record at {}",
                path.display()
            );
        }
    }
}

async fn list_storage_records(pool: &PgPool) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT id, storage_path
        FROM files
        "#,
    )
    .fetch_all(pool)
    .await
}

async fn list_disk_binaries(upload_dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut result = Vec::new();
    let mut users = match fs::read_dir(upload_dir).await {
        Ok(users) => users,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(err) => return Err(err),
    };

    while let Some(user_entry) = users.next_entry().await? {
        if !user_entry.file_type().await?.is_dir() {
            continue;
        }

        let mut files = fs::read_dir(user_entry.path()).await?;
        while let Some(file_entry) = files.next_entry().await? {
            if file_entry.file_type().await?.is_file() {
                let path = file_entry.path();
                if path.extension().and_then(|value| value.to_str()) == Some("bin") {
                    result.push(path);
                }
            }
        }
    }

    Ok(result)
}
