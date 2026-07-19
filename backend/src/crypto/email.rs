use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use rand::Rng;
use rand::distributions::Alphanumeric;
use sha2::{Digest, Sha256};
use std::io::{Error as IoError, ErrorKind};

struct EmailConfig {
    from_email: String,
    smtp_host: String,
    smtp_password: String,
    smtp_username: String,
}

pub fn generate_verification_token() -> String {
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    token
}

pub fn hash_verification_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

fn env_value(name: &str, aliases: &[&str]) -> Option<(String, String)> {
    std::iter::once(name)
        .chain(aliases.iter().copied())
        .find_map(|key| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|value| (value, key.to_string()))
        })
}

fn email_config() -> Result<EmailConfig, Box<dyn std::error::Error + Send + Sync>> {
    let smtp_host = env_value("SMTP_HOST", &[]);
    let smtp_username = env_value("SMTP_USERNAME", &["SMTP_EMAIL"]);
    let smtp_password = env_value("SMTP_PASSWORD", &[]);
    let mut missing = Vec::new();

    if smtp_host.is_none() {
        missing.push("SMTP_HOST");
    }
    if smtp_username.is_none() {
        missing.push("SMTP_USERNAME or SMTP_EMAIL");
    }
    if smtp_password.is_none() {
        missing.push("SMTP_PASSWORD");
    }

    if !missing.is_empty() {
        let message = format!(
            "email delivery is not configured; missing environment variables: {}",
            missing.join(", ")
        );
        return Err(IoError::new(ErrorKind::NotFound, message).into());
    }

    let from_email = env_value("FROM_EMAIL", &[])
        .map(|(value, _)| value)
        .unwrap_or_else(|| "Skysync <bartoszkasyna@gmail.com>".to_string());

    Ok(EmailConfig {
        from_email,
        smtp_host: smtp_host.expect("checked missing SMTP_HOST").0,
        smtp_password: smtp_password.expect("checked missing SMTP_PASSWORD").0,
        smtp_username: smtp_username.expect("checked missing SMTP_USERNAME").0,
    })
}

pub fn log_email_configuration_status() {
    let smtp_host = env_value("SMTP_HOST", &[]);
    let smtp_username = env_value("SMTP_USERNAME", &["SMTP_EMAIL"]);
    let smtp_password = env_value("SMTP_PASSWORD", &[]);
    let from_email = env_value("FROM_EMAIL", &[]);
    let mut missing = Vec::new();

    if smtp_host.is_none() {
        missing.push("SMTP_HOST");
    }
    if smtp_username.is_none() {
        missing.push("SMTP_USERNAME or SMTP_EMAIL");
    }
    if smtp_password.is_none() {
        missing.push("SMTP_PASSWORD");
    }

    if missing.is_empty() {
        let username_source = smtp_username
            .as_ref()
            .map(|(_, source)| source.as_str())
            .unwrap_or("SMTP_USERNAME");
        tracing::info!(
            smtp_host_set = true,
            smtp_username_source = username_source,
            from_email_set = from_email.is_some(),
            "email delivery configured"
        );

        if from_email.is_none() {
            tracing::warn!("FROM_EMAIL is not set; using the default sender address");
        }
    } else {
        tracing::warn!(
            missing = %missing.join(", "),
            "email delivery is disabled until required environment variables are set"
        );
    }
}

pub async fn send_verification_email(
    to_email: &str,
    token: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let frontend_url =
        std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".to_string());
    let link = format!("{}/verify#token={}", frontend_url, token);

    let config = email_config()?;

    let email = Message::builder()
        .from(config.from_email.parse()?)
        .to(to_email.parse()?)
        .subject("Verify your email")
        .header(ContentType::TEXT_HTML)
        .body(format!(
            "<p>Click the link below to verify your email:</p><p><a href=\"{}\">{}</a></p>",
            link, link
        ))?;
    let creds = Credentials::new(config.smtp_username, config.smtp_password);

    let mailer: AsyncSmtpTransport<Tokio1Executor> =
        AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)?
            .credentials(creds)
            .build();

    mailer.send(email).await?;
    Ok(())
}

pub async fn send_password_reset_email(
    to_email: &str,
    token: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let frontend_url =
        std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".to_string());
    let link = format!("{}/reset-password#token={}", frontend_url, token);

    let config = email_config()?;

    let email = Message::builder()
        .from(config.from_email.parse()?)
        .to(to_email.parse()?)
        .subject("Reset your SkysyncR password")
        .header(ContentType::TEXT_HTML)
        .body(format!(
            "<p>Use the link below to reset your password:</p><p><a href=\"{}\">{}</a></p>",
            link, link
        ))?;
    let creds = Credentials::new(config.smtp_username, config.smtp_password);

    let mailer: AsyncSmtpTransport<Tokio1Executor> =
        AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)?
            .credentials(creds)
            .build();

    mailer.send(email).await?;
    Ok(())
}
