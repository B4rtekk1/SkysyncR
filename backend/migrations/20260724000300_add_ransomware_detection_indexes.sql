CREATE INDEX IF NOT EXISTS idx_audit_logs_file_mutations_window
    ON audit_logs (user_id, device_label, created_at DESC)
    WHERE resource_type = 'file'
      AND action IN ('file.delete', 'file.rename', 'file.update');

CREATE INDEX IF NOT EXISTS idx_notifications_ransomware_alert_dedupe
    ON notifications (user_id, type, created_at DESC)
    WHERE type = 'security.ransomware_suspected';
