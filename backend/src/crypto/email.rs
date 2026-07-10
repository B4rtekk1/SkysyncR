use hickory_resolver::TokioResolver;
use hickory_resolver::proto::rr::RData;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use rand::Rng;
use rand::distributions::Alphanumeric;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::{Duration, timeout};

pub fn generate_verification_token() -> String {
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    token
}

#[derive(Debug, Clone, PartialEq)]
pub enum EmailCheckResult {
    Ok,
    NoMx,
    SmtpRejected,
    Timeout,
    Unknown(String),
}

pub async fn resolve_mx(domain: &str) -> Result<Vec<String>, EmailCheckResult> {
    let resolver = TokioResolver::builder_tokio()
        .and_then(|builder| builder.build())
        .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;

    let response = resolver
        .mx_lookup(domain)
        .await
        .map_err(|_| EmailCheckResult::NoMx)?;

    let mut records: Vec<(u16, String)> = response
        .answers()
        .iter()
        .filter_map(|record| {
            if let RData::MX(mx) = &record.data {
                let host = mx.exchange.to_utf8();
                Some((mx.preference, host.trim_end_matches('.').to_string()))
            } else {
                None
            }
        })
        .collect();

    if records.is_empty() {
        return Err(EmailCheckResult::NoMx);
    }

    records.sort_by_key(|(priority, _)| *priority);
    Ok(records.into_iter().map(|(_, host)| host).collect())
}

pub async fn smtp_probe(mx_host: &str, target_email: &str) -> EmailCheckResult {
    let probe = async {
        let stream = TcpStream::connect((mx_host, 25))
            .await
            .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;

        let (reader, mut writer) = stream.into_split();
        let mut reader = BufReader::new(reader);
        let mut line = String::new();

        // Powitanie serwera (220)
        line.clear();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;
        if !line.starts_with("220") {
            return Err(EmailCheckResult::Unknown(format!(
                "unexpected greeting: {}",
                line
            )));
        }

        writer
            .write_all(b"HELO checker.local\r\n")
            .await
            .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;
        line.clear();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;
        if !line.starts_with("250") {
            return Err(EmailCheckResult::Unknown(format!("HELO failed: {}", line)));
        }

        writer
            .write_all(b"MAIL FROM:<verify@checker.local>\r\n")
            .await
            .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;
        line.clear();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;
        if !line.starts_with("250") {
            return Err(EmailCheckResult::Unknown(format!(
                "MAIL FROM failed: {}",
                line
            )));
        }

        let rcpt_cmd = format!("RCPT TO:<{}>\r\n", target_email);
        writer
            .write_all(rcpt_cmd.as_bytes())
            .await
            .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;
        line.clear();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| EmailCheckResult::Unknown(e.to_string()))?;

        // Zawsze zamknij grzecznie połączenie
        let _ = writer.write_all(b"QUIT\r\n").await;

        if line.starts_with("250") {
            Ok(EmailCheckResult::Ok)
        } else if line.starts_with("550") || line.starts_with("551") || line.starts_with("553") {
            Ok(EmailCheckResult::SmtpRejected)
        } else {
            Err(EmailCheckResult::Unknown(format!(
                "unexpected RCPT response: {}",
                line
            )))
        }
    };

    match timeout(Duration::from_secs(8), probe).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => e,
        Err(_) => EmailCheckResult::Timeout,
    }
}

pub async fn verify_email_exists(email: &str) -> EmailCheckResult {
    let domain = match email.split('@').nth(1) {
        Some(d) => d,
        None => return EmailCheckResult::Unknown("malformed email".to_string()),
    };

    let mx_hosts = match resolve_mx(domain).await {
        Ok(hosts) => hosts,
        Err(e) => return e,
    };

    for host in mx_hosts {
        let result = smtp_probe(&host, email).await;
        // Jeśli dostaliśmy jednoznaczną odpowiedź, nie próbuj kolejnych MX
        match result {
            EmailCheckResult::Ok | EmailCheckResult::SmtpRejected => return result,
            _ => continue,
        }
    }

    EmailCheckResult::Timeout
}

pub async fn send_verification_email(
    to_email: &str,
    token: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let frontend_url =
        std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".to_string());
    let link = format!("{}/verify?token={}", frontend_url, token);

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
