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

#[derive(Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMemberRecord {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub role: String,
    pub joined_at: DateTime<Utc>,
    pub is_owner: bool,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupIncomingInviteRecord {
    pub id: Uuid,
    pub group_id: Uuid,
    pub group_name: String,
    pub invited_by_email: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
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
    owner_email: String,
    owned_by_me: bool,
    my_role: String,
}

#[derive(FromRow)]
struct GroupMemberRow {
    group_id: Uuid,
    user_id: Uuid,
    email: String,
    display_name: Option<String>,
    role: String,
    joined_at: DateTime<Utc>,
    is_owner: bool,
}

#[derive(FromRow)]
struct InviteAcceptanceRow {
    group_id: Uuid,
    role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRecord {
    pub id: Uuid,
    pub name: String,
    pub default_role: String,
    pub created_at: DateTime<Utc>,
    pub owner_email: String,
    pub owned_by_me: bool,
    pub my_role: String,
    pub members: Vec<GroupMemberRecord>,
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

pub async fn list_user_groups(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<GroupRecord>, sqlx::Error> {
    let groups = sqlx::query_as::<_, GroupRow>(
        r#"
        SELECT DISTINCT
            groups.id,
            groups.name,
            groups.default_role,
            groups.created_at,
            owner.email AS owner_email,
            groups.owner_id = $1 AS owned_by_me,
            CASE WHEN groups.owner_id = $1 THEN 'admin' ELSE group_members.role END AS my_role
        FROM groups
        JOIN users owner ON owner.id = groups.owner_id
        LEFT JOIN group_members
            ON group_members.group_id = groups.id
           AND group_members.user_id = $1
        WHERE groups.owner_id = $1
           OR group_members.user_id = $1
        ORDER BY groups.created_at DESC
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

    let members = list_group_members_for_groups(pool, &group_ids).await?;

    Ok(groups
        .into_iter()
        .map(|group| GroupRecord {
            id: group.id,
            name: group.name,
            default_role: group.default_role,
            created_at: group.created_at,
            owner_email: group.owner_email,
            owned_by_me: group.owned_by_me,
            my_role: group.my_role,
            members: members
                .iter()
                .filter(|member| member.group_id == group.id)
                .map(|member| GroupMemberRecord {
                    user_id: member.user_id,
                    email: member.email.clone(),
                    display_name: member.display_name.clone(),
                    role: member.role.clone(),
                    joined_at: member.joined_at,
                    is_owner: member.is_owner,
                })
                .collect(),
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
        WITH inserted AS (
            INSERT INTO groups (owner_id, name, default_role)
            VALUES ($1, $2, $3)
            RETURNING id, name, default_role, owner_id, created_at
        )
        SELECT
            inserted.id,
            inserted.name,
            inserted.default_role,
            inserted.created_at,
            owner.email AS owner_email,
            TRUE AS owned_by_me,
            'admin'::TEXT AS my_role
        FROM inserted
        JOIN users owner ON owner.id = inserted.owner_id
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
        owner_email: row.owner_email.clone(),
        owned_by_me: true,
        my_role: "admin".to_string(),
        members: vec![GroupMemberRecord {
            user_id: group.owner_id,
            email: row.owner_email,
            display_name: None,
            role: "admin".to_string(),
            joined_at: row.created_at,
            is_owner: true,
        }],
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
        WITH updated AS (
            UPDATE groups
            SET name = $1,
                default_role = $2,
                updated_at = NOW()
            WHERE id = $3
              AND owner_id = $4
            RETURNING id, name, default_role, owner_id, created_at
        )
        SELECT
            updated.id,
            updated.name,
            updated.default_role,
            updated.created_at,
            owner.email AS owner_email,
            TRUE AS owned_by_me,
            'admin'::TEXT AS my_role
        FROM updated
        JOIN users owner ON owner.id = updated.owner_id
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
        owner_email: group.owner_email.clone(),
        owned_by_me: group.owned_by_me,
        my_role: group.my_role,
        members: vec![GroupMemberRecord {
            user_id,
            email: group.owner_email,
            display_name: None,
            role: "admin".to_string(),
            joined_at: group.created_at,
            is_owner: true,
        }],
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
            group_members.role
        FROM group_members
        JOIN groups ON groups.id = group_members.group_id
        JOIN users recipient ON recipient.id = group_members.user_id
        WHERE groups.id = $1
          AND groups.owner_id = $2
          AND recipient.is_active = TRUE
          AND recipient.public_key IS NOT NULL
          AND recipient.id <> $2
        ORDER BY recipient.email, group_members.joined_at DESC
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

pub async fn list_incoming_group_invites(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<GroupIncomingInviteRecord>, sqlx::Error> {
    sqlx::query_as::<_, GroupIncomingInviteRecord>(
        r#"
        SELECT
            group_invitations.id,
            group_invitations.group_id,
            groups.name AS group_name,
            inviter.email AS invited_by_email,
            group_invitations.role,
            group_invitations.created_at,
            group_invitations.expires_at
        FROM group_invitations
        JOIN groups ON groups.id = group_invitations.group_id
        JOIN users invited ON invited.email = group_invitations.invited_email
        JOIN users inviter ON inviter.id = group_invitations.invited_by_user_id
        WHERE invited.id = $1
          AND group_invitations.status = 'pending'
          AND group_invitations.expires_at > NOW()
        ORDER BY group_invitations.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn accept_group_invite_record(
    pool: &PgPool,
    user_id: Uuid,
    invite_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let invite = sqlx::query_as::<_, InviteAcceptanceRow>(
        r#"
        SELECT group_invitations.group_id, group_invitations.role
        FROM group_invitations
        JOIN users invited ON invited.email = group_invitations.invited_email
        WHERE group_invitations.id = $1
          AND invited.id = $2
          AND group_invitations.status = 'pending'
          AND group_invitations.expires_at > NOW()
        FOR UPDATE OF group_invitations
        "#,
    )
    .bind(invite_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(invite) = invite else {
        tx.commit().await?;
        return Ok(0);
    };

    sqlx::query(
        r#"
        INSERT INTO group_members (group_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (group_id, user_id) DO UPDATE
        SET role = EXCLUDED.role
        "#,
    )
    .bind(invite.group_id)
    .bind(user_id)
    .bind(invite.role)
    .execute(&mut *tx)
    .await?;

    let result = sqlx::query(
        r#"
        UPDATE group_invitations
        SET status = 'accepted'
        WHERE id = $1
        "#,
    )
    .bind(invite_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(result.rows_affected())
}

pub async fn decline_group_invite_record(
    pool: &PgPool,
    user_id: Uuid,
    invite_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE group_invitations
        SET status = 'declined'
        FROM users invited
        WHERE group_invitations.id = $1
          AND invited.id = $2
          AND invited.email = group_invitations.invited_email
          AND group_invitations.status = 'pending'
        "#,
    )
    .bind(invite_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn update_group_member_role_record(
    pool: &PgPool,
    owner_id: Uuid,
    group_id: Uuid,
    member_user_id: Uuid,
    role: String,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE group_members
        SET role = $1
        FROM groups
        WHERE group_members.group_id = $2
          AND group_members.user_id = $3
          AND groups.id = group_members.group_id
          AND groups.owner_id = $4
          AND groups.owner_id <> group_members.user_id
        "#,
    )
    .bind(role)
    .bind(group_id)
    .bind(member_user_id)
    .bind(owner_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn delete_group_member_record(
    pool: &PgPool,
    owner_id: Uuid,
    group_id: Uuid,
    member_user_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM group_members
        USING groups
        WHERE group_members.group_id = $1
          AND group_members.user_id = $2
          AND groups.id = group_members.group_id
          AND groups.owner_id = $3
          AND groups.owner_id <> group_members.user_id
        "#,
    )
    .bind(group_id)
    .bind(member_user_id)
    .bind(owner_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn leave_group_record(
    pool: &PgPool,
    user_id: Uuid,
    group_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM group_members
        USING groups
        WHERE group_members.group_id = $1
          AND group_members.user_id = $2
          AND groups.id = group_members.group_id
          AND groups.owner_id <> $2
        "#,
    )
    .bind(group_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn group_invite_target_available(
    pool: &PgPool,
    group_id: Uuid,
    email: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT NOT EXISTS (
            SELECT 1
            FROM groups
            JOIN users owner ON owner.id = groups.owner_id
            WHERE groups.id = $1
              AND owner.email = $2
        )
        AND NOT EXISTS (
            SELECT 1
            FROM group_invitations
            WHERE group_id = $1
              AND invited_email = $2
              AND status = 'pending'
              AND expires_at > NOW()
        )
        AND NOT EXISTS (
            SELECT 1
            FROM group_members
            JOIN users member ON member.id = group_members.user_id
            WHERE group_members.group_id = $1
              AND member.email = $2
        )
        "#,
    )
    .bind(group_id)
    .bind(email)
    .fetch_one(pool)
    .await
}

async fn list_group_members_for_groups(
    pool: &PgPool,
    group_ids: &[Uuid],
) -> Result<Vec<GroupMemberRow>, sqlx::Error> {
    if group_ids.is_empty() {
        return Ok(Vec::new());
    }

    sqlx::query_as::<_, GroupMemberRow>(
        r#"
        SELECT *
        FROM (
            SELECT
                groups.id AS group_id,
                owner.id AS user_id,
                owner.email,
                owner.display_name,
                'admin'::TEXT AS role,
                groups.created_at AS joined_at,
                TRUE AS is_owner
            FROM groups
            JOIN users owner ON owner.id = groups.owner_id
            WHERE groups.id = ANY($1)

            UNION ALL

            SELECT
                group_members.group_id,
                member.id AS user_id,
                member.email,
                member.display_name,
                group_members.role,
                group_members.joined_at,
                FALSE AS is_owner
            FROM group_members
            JOIN users member ON member.id = group_members.user_id
            JOIN groups ON groups.id = group_members.group_id
            WHERE group_members.group_id = ANY($1)
              AND groups.owner_id <> member.id
        ) members
        ORDER BY group_id, is_owner DESC, joined_at ASC
        "#,
    )
    .bind(group_ids)
    .fetch_all(pool)
    .await
}
