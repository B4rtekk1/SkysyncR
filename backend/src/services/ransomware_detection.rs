use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::notifications::{NewNotification, create_ransomware_alert_notification_if_absent};
use crate::db::ransomware_detection::{
    SuspiciousFileActivitySummary, summarize_recent_file_mutations,
};

const WINDOW_MINUTES: i32 = 10;
const DEDUPE_MINUTES: i32 = 30;
const DELETE_THRESHOLD: i64 = 10;
const RENAME_THRESHOLD: i64 = 15;
const UPDATE_THRESHOLD: i64 = 20;
const MIXED_MUTATION_THRESHOLD: i64 = 30;
const AFFECTED_FILE_THRESHOLD: i64 = 20;

#[derive(Debug, PartialEq, Eq)]
pub enum RansomwareSignal {
    MassDeletes,
    MassRenames,
    MassOverwrites,
    MixedMassMutation,
}

impl RansomwareSignal {
    fn as_str(&self) -> &'static str {
        match self {
            Self::MassDeletes => "mass_deletes",
            Self::MassRenames => "mass_renames",
            Self::MassOverwrites => "mass_overwrites",
            Self::MixedMassMutation => "mixed_mass_mutation",
        }
    }
}

pub fn classify_suspicious_file_activity(
    summary: &SuspiciousFileActivitySummary,
) -> Vec<RansomwareSignal> {
    let mut signals = Vec::new();
    let total_mutations = summary.delete_count + summary.rename_count + summary.update_count;
    let changed_action_types = [
        summary.delete_count > 0,
        summary.rename_count > 0,
        summary.update_count > 0,
    ]
    .into_iter()
    .filter(|active| *active)
    .count();

    if summary.delete_count >= DELETE_THRESHOLD {
        signals.push(RansomwareSignal::MassDeletes);
    }
    if summary.rename_count >= RENAME_THRESHOLD {
        signals.push(RansomwareSignal::MassRenames);
    }
    if summary.update_count >= UPDATE_THRESHOLD {
        signals.push(RansomwareSignal::MassOverwrites);
    }
    if changed_action_types >= 2
        && total_mutations >= MIXED_MUTATION_THRESHOLD
        && summary.affected_file_count >= AFFECTED_FILE_THRESHOLD
    {
        signals.push(RansomwareSignal::MixedMassMutation);
    }

    signals
}

pub async fn detect_and_alert_after_file_mutation(
    pool: &PgPool,
    user_id: Uuid,
    device_label: Option<&str>,
) -> Result<(), sqlx::Error> {
    let summary =
        summarize_recent_file_mutations(pool, user_id, device_label, WINDOW_MINUTES).await?;
    let signals = classify_suspicious_file_activity(&summary);
    if signals.is_empty() {
        return Ok(());
    }

    let signal_names: Vec<&str> = signals.iter().map(RansomwareSignal::as_str).collect();
    let payload = json!({
        "severity": "high",
        "signals": signal_names,
        "device_label": summary.device_label,
        "window_minutes": WINDOW_MINUTES,
        "window_started_at": summary.window_started_at,
        "window_ended_at": summary.window_ended_at,
        "delete_count": summary.delete_count,
        "rename_count": summary.rename_count,
        "overwrite_count": summary.update_count,
        "affected_file_count": summary.affected_file_count,
        "message": "Detected a burst of file deletes, renames, or encrypted content overwrites that may indicate ransomware activity."
    });

    create_ransomware_alert_notification_if_absent(
        pool,
        NewNotification {
            user_id: summary.user_id,
            r#type: "security.ransomware_suspected".to_string(),
            payload,
        },
        device_label,
        DEDUPE_MINUTES,
    )
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn summary(
        delete_count: i64,
        rename_count: i64,
        update_count: i64,
    ) -> SuspiciousFileActivitySummary {
        SuspiciousFileActivitySummary {
            user_id: Uuid::new_v4(),
            device_label: Some("test-device".to_string()),
            window_started_at: Utc::now(),
            window_ended_at: Utc::now(),
            delete_count,
            rename_count,
            update_count,
            affected_file_count: delete_count + rename_count + update_count,
        }
    }

    #[test]
    fn classifies_mass_action_bursts() {
        assert_eq!(
            classify_suspicious_file_activity(&summary(10, 0, 0)),
            vec![RansomwareSignal::MassDeletes]
        );
        assert_eq!(
            classify_suspicious_file_activity(&summary(0, 15, 0)),
            vec![RansomwareSignal::MassRenames]
        );
        assert_eq!(
            classify_suspicious_file_activity(&summary(0, 0, 20)),
            vec![RansomwareSignal::MassOverwrites]
        );
    }

    #[test]
    fn classifies_mixed_mass_mutations() {
        assert_eq!(
            classify_suspicious_file_activity(&summary(9, 14, 7)),
            vec![RansomwareSignal::MixedMassMutation]
        );
    }

    #[test]
    fn ignores_small_activity() {
        assert!(classify_suspicious_file_activity(&summary(2, 3, 4)).is_empty());
    }
}
