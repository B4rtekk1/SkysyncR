use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use rand::Rng;
use rand::distributions::Alphanumeric;
use sha2::{Digest, Sha256};

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

pub async fn send_verification_email(
    to_email: &str,
    token: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let frontend_url =
        std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".to_string());
    let link = format!("{}/verify#token={}", frontend_url, token);

    let smtp_host = std::env::var("SMTP_HOST")?;
    let smtp_username = std::env::var("SMTP_USERNAME")?;
    let smtp_password = std::env::var("SMTP_PASSWORD")?;
    let from_email = std::env::var("FROM_EMAIL")
        .unwrap_or_else(|_| "Skysync <bartoszkasyna@gmail.com>".to_string());

    let email = Message::builder()
        .from(from_email.parse()?)
        .to(to_email.parse()?)
        .subject("Verify your email")
        .header(ContentType::TEXT_HTML)
        .body(format!(
            "<p>Click the link below to verify your email:</p><p><a href=\"{}\">{}</a></p>",
            link, link
        ))?;
    let creds = Credentials::new(smtp_username, smtp_password);

    let mailer: AsyncSmtpTransport<Tokio1Executor> =
        AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_host)?
            .credentials(creds)
            .build();

    mailer.send(email).await?;
    Ok(())
}
