use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct OperationLogRecord {
    pub id: Uuid,
    pub operation: String,
    pub resource_id: Option<Uuid>,
    pub resource_type: Option<String>,
    pub device_label: Option<String>,
    pub details: Value,
    pub created_at: DateTime<Utc>,
}

pub struct NewAuditLog<'a> {
    pub user_id: Uuid,
    pub action: &'a str,
    pub resource_id: Option<Uuid>,
    pub resource_type: Option<&'a str>,
    pub device_label: Option<&'a str>,
    pub details: Value,
}

pub async fn insert_user_audit_log(
    pool: &PgPool,
    encryption_key: &str,
    log: NewAuditLog<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO audit_logs (
            user_id,
            action,
            resource_id,
            resource_type,
            device_label,
            details,
            encrypted_details
        )
        VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, pgp_sym_encrypt($6::text, $7))
        "#,
    )
    .bind(log.user_id)
    .bind(log.action)
    .bind(log.resource_id)
    .bind(log.resource_type)
    .bind(log.device_label)
    .bind(log.details.to_string())
    .bind(encryption_key)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn list_user_operation_logs(
    pool: &PgPool,
    encryption_key: &str,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<OperationLogRecord>, sqlx::Error> {
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            Option<Uuid>,
            Option<String>,
            Option<String>,
            Option<String>,
            Value,
            DateTime<Utc>,
        ),
    >(
        r#"
        SELECT
            id,
            action,
            resource_id,
            resource_type,
            device_label,
            CASE
                WHEN encrypted_details IS NULL THEN NULL
                ELSE pgp_sym_decrypt(encrypted_details, $2)
            END AS decrypted_details,
            details,
            created_at
        FROM audit_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(user_id)
    .bind(encryption_key)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                operation,
                resource_id,
                resource_type,
                device_label,
                decrypted_details,
                legacy_details,
                created_at,
            )| {
                let details = decrypted_details
                    .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                    .unwrap_or_else(|| {
                        if legacy_details == json!({}) {
                            json!({ "encrypted": true })
                        } else {
                            legacy_details
                        }
                    });

                OperationLogRecord {
                    id,
                    operation,
                    resource_id,
                    resource_type,
                    device_label,
                    details,
                    created_at,
                }
            },
        )
        .collect())
}
