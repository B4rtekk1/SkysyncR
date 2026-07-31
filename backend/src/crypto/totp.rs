use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload, generic_array::typenum::U12},
};
use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, Mac};
use rand::{RngCore, rngs::OsRng};
use sha1::Sha1;
use uuid::Uuid;

const SECRET_BYTES: usize = 20;
const STEP_SECONDS: i64 = 30;

pub fn generate_secret() -> Vec<u8> {
    let mut secret = vec![0; SECRET_BYTES];
    OsRng.fill_bytes(&mut secret);
    secret
}

pub fn secret_base32(secret: &[u8]) -> String {
    BASE32_NOPAD.encode(secret)
}

pub fn otpauth_url(email: &str, secret: &[u8]) -> String {
    // The application name is fixed ASCII. E-mail addresses accepted by this application
    // do not contain URI-reserved characters other than '@'. SHA1, 6 digits, and a
    // 30-second period are the TOTP defaults, so omitting them keeps the QR payload
    // small enough for the frontend generator.
    format!(
        "otpauth://totp/SkysyncR:{email}?secret={}&issuer=SkysyncR",
        secret_base32(secret),
    )
}

pub fn encrypt_secret(
    key: &[u8; 32],
    user_id: Uuid,
    secret: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "invalid TOTP encryption key")?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let nonce_value: Nonce<U12> = nonce.into();
    let ciphertext = cipher
        .encrypt(
            &nonce_value,
            Payload {
                msg: secret,
                aad: user_id.as_bytes(),
            },
        )
        .map_err(|_| "could not encrypt TOTP secret")?;
    Ok((ciphertext, nonce.to_vec()))
}

pub fn decrypt_secret(
    key: &[u8; 32],
    user_id: Uuid,
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, String> {
    let nonce_bytes: [u8; 12] = nonce.try_into().map_err(|_| "invalid TOTP secret nonce")?;
    let nonce_value: Nonce<U12> = nonce_bytes.into();
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "invalid TOTP encryption key")?;
    cipher
        .decrypt(
            &nonce_value,
            Payload {
                msg: ciphertext,
                aad: user_id.as_bytes(),
            },
        )
        .map_err(|_| "could not decrypt TOTP secret".into())
}

pub fn verify_code(
    secret: &[u8],
    code: &str,
    now: i64,
    last_used_counter: Option<i64>,
) -> Option<i64> {
    let code = code.trim();
    if code.len() != 6 || !code.bytes().all(|value| value.is_ascii_digit()) {
        return None;
    }
    let current = now / STEP_SECONDS;
    for counter in [current - 1, current, current + 1] {
        if last_used_counter.is_some_and(|last| counter <= last) {
            continue;
        }
        if totp_code(secret, counter).is_some_and(|expected| expected == code) {
            return Some(counter);
        }
    }
    None
}

fn totp_code(secret: &[u8], counter: i64) -> Option<String> {
    let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(secret).ok()?;
    mac.update(&(counter as u64).to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = usize::from(digest[19] & 0x0f);
    let value = ((u32::from(digest[offset]) & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    Some(format!("{:06}", value % 1_000_000))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_rfc6238_test_vector() {
        let secret = b"12345678901234567890";
        assert_eq!(totp_code(secret, 1), Some("287082".into()));
    }

    #[test]
    fn creates_compact_otpauth_url_for_qr_generation() {
        let secret = b"12345678901234567890";

        assert_eq!(
            otpauth_url("user@example.com", secret),
            "otpauth://totp/SkysyncR:user@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=SkysyncR",
        );
    }
}
