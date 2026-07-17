use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInviteRecord {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
pub struct GroupShareRecipientRecord {
    pub email: String,
    pub public_key: String,
    pub role: String,
}

#[derive(FromRow)]
struct GroupInviteRow {
    id: Uuid,
    group_id: Uuid,
    email: String,
    role: String,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct GroupRow {
    id: Uuid,
    name: String,
    default_role: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRecord {
    pub id: Uuid,
    pub name: String,
    pub default_role: String,
    pub created_at: DateTime<Utc>,
    pub invites: Vec<GroupInviteRecord>,
}

pub struct NewGroup {
    pub owner_id: Uuid,
    pub name: String,
    pub default_role: String,
}

pub struct GroupUpdate {
    pub name: String,
    pub default_role: String,
}

pub struct NewGroupInvite {
    pub group_id: Uuid,
    pub invited_email: String,
    pub invited_by_user_id: Uuid,
    pub role: String,
}

pub async fn ensure_groups_tables(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS groups
        (
            id           UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
            name         TEXT        NOT NULL,
            default_role TEXT        NOT NULL DEFAULT 'viewer',
            owner_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            created_at   timestamptz NOT NULL DEFAULT NOW(),
            updated_at   timestamptz NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "ALTER TABLE groups ADD COLUMN IF NOT EXISTS default_role TEXT NOT NULL DEFAULT 'viewer'",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS group_invitations
        (
            id                 UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
            group_id           UUID        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
            invited_email      TEXT        NOT NULL,
            invited_by_user_id UUID        NOT NULL REFERENCES users (id),
            role               TEXT        NOT NULL DEFAULT 'viewer',
            token              TEXT        NOT NULL UNIQUE,
            status             TEXT        NOT NULL DEFAULT 'pending',
            expires_at         timestamptz NOT NULL,
            created_at         timestamptz NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("ALTER TABLE group_invitations ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer'")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups (owner_id)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_group_invitations_group_id ON group_invitations (group_id)",
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn list_user_groups(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<GroupRecord>, sqlx::Error> {
    let groups = sqlx::query_as::<_, GroupRow>(
        r#"
        SELECT id, name, default_role, created_at
        FROM groups
        WHERE owner_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    if groups.is_empty() {
        return Ok(Vec::new());
    }

    let group_ids = groups.iter().map(|group| group.id).collect::<Vec<_>>();
    let invites = sqlx::query_as::<_, GroupInviteRow>(
        r#"
        SELECT id, group_id, invited_email AS email, role, created_at
        FROM group_invitations
        WHERE group_id = ANY($1)
          AND status = 'pending'
        ORDER BY created_at DESC
        "#,
    )
    .bind(&group_ids)
    .fetch_all(pool)
    .await?;

    Ok(groups
        .into_iter()
        .map(|group| GroupRecord {
            id: group.id,
            name: group.name,
            default_role: group.default_role,
            created_at: group.created_at,
            invites: invites
                .iter()
                .filter(|invite| invite.group_id == group.id)
                .map(|invite| GroupInviteRecord {
                    id: invite.id,
                    email: invite.email.clone(),
                    role: invite.role.clone(),
                    created_at: invite.created_at,
                })
                .collect(),
        })
        .collect())
}

pub async fn create_group_record(
    pool: &PgPool,
    group: NewGroup,
) -> Result<GroupRecord, sqlx::Error> {
    let row = sqlx::query_as::<_, GroupRow>(
        r#"
        INSERT INTO groups (owner_id, name, default_role)
        VALUES ($1, $2, $3)
        RETURNING id, name, default_role, created_at
        "#,
    )
    .bind(group.owner_id)
    .bind(group.name)
    .bind(group.default_role)
    .fetch_one(pool)
    .await?;

    Ok(GroupRecord {
        id: row.id,
        name: row.name,
        default_role: row.default_role,
        created_at: row.created_at,
        invites: Vec::new(),
    })
}

pub async fn update_group_record(
    pool: &PgPool,
    user_id: Uuid,
    group_id: Uuid,
    update: GroupUpdate,
) -> Result<Option<GroupRecord>, sqlx::Error> {
    let row = sqlx::query_as::<_, GroupRow>(
        r#"
        UPDATE groups
        SET name = $1,
            default_role = $2,
            updated_at = NOW()
        WHERE id = $3
          AND owner_id = $4
        RETURNING id, name, default_role, created_at
        "#,
    )
    .bind(update.name)
    .bind(update.default_role)
    .bind(group_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|group| GroupRecord {
        id: group.id,
        name: group.name,
        default_role: group.default_role,
        created_at: group.created_at,
        invites: Vec::new(),
    }))
}

pub async fn delete_group_record(
    pool: &PgPool,
    user_id: Uuid,
    group_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM groups
        WHERE id = $1
          AND owner_id = $2
        "#,
    )
    .bind(group_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn group_belongs_to_user(
    pool: &PgPool,
    user_id: Uuid,
    group_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM groups
            WHERE id = $1
              AND owner_id = $2
        )
        "#,
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
}

pub async fn list_group_share_recipients(
    pool: &PgPool,
    user_id: Uuid,
    group_id: Uuid,
) -> Result<Vec<GroupShareRecipientRecord>, sqlx::Error> {
    sqlx::query_as::<_, GroupShareRecipientRecord>(
        r#"
        SELECT DISTINCT ON (recipient.email)
            recipient.email,
            recipient.public_key AS public_key,
            group_invitations.role
        FROM group_invitations
        JOIN groups ON groups.id = group_invitations.group_id
        JOIN users recipient ON recipient.email = group_invitations.invited_email
        WHERE groups.id = $1
          AND groups.owner_id = $2
          AND group_invitations.status = 'pending'
          AND recipient.is_active = TRUE
          AND recipient.public_key IS NOT NULL
          AND recipient.id <> $2
        ORDER BY recipient.email, group_invitations.created_at DESC
        "#,
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn create_group_invite_record(
    pool: &PgPool,
    invite: NewGroupInvite,
) -> Result<GroupInviteRecord, sqlx::Error> {
    sqlx::query_as::<_, GroupInviteRecord>(
        r#"
        INSERT INTO group_invitations (
            group_id,
            invited_email,
            invited_by_user_id,
            role,
            token,
            expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, invited_email AS email, role, created_at
        "#,
    )
    .bind(invite.group_id)
    .bind(invite.invited_email)
    .bind(invite.invited_by_user_id)
    .bind(invite.role)
    .bind(Uuid::new_v4().to_string())
    .bind(Utc::now() + Duration::days(14))
    .fetch_one(pool)
    .await
}

pub async fn delete_group_invite_record(
    pool: &PgPool,
    user_id: Uuid,
    group_id: Uuid,
    invite_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM group_invitations
        USING groups
        WHERE group_invitations.id = $1
          AND group_invitations.group_id = $2
          AND groups.id = group_invitations.group_id
          AND groups.owner_id = $3
        "#,
    )
    .bind(invite_id)
    .bind(group_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}
