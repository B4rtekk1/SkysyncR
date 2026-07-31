use serde::Serialize;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::db::notifications::{NewNotification, NotificationRecord, create_notification};

#[derive(Clone)]
pub struct NotificationBroadcaster {
    sender: broadcast::Sender<NotificationEvent>,
}

#[derive(Clone, Serialize)]
pub struct NotificationEvent {
    pub user_id: Uuid,
    pub notification: NotificationRecord,
}

impl NotificationBroadcaster {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<NotificationEvent> {
        self.sender.subscribe()
    }

    pub fn publish(&self, user_id: Uuid, notification: NotificationRecord) {
        if self.sender.receiver_count() == 0 {
            return;
        }

        let _ = self.sender.send(NotificationEvent {
            user_id,
            notification,
        });
    }
}

pub async fn create_and_publish_notification(
    state: &crate::state::AppState,
    notification: NewNotification,
) -> Result<NotificationRecord, sqlx::Error> {
    let user_id = notification.user_id;
    let created = create_notification(&state.db_pool, notification).await?;
    state
        .notification_broadcaster
        .publish(user_id, created.clone());
    Ok(created)
}
