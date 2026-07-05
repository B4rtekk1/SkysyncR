const MIN_PASSWORD_LEN: usize = 8;
const MAX_PASSWORD_LEN: usize = 128;
const MAX_EMAIL_LEN: usize = 254;
const MAX_DISPLAY_NAME_LEN: usize = 100;
const MAX_PUBLIC_KEY_LEN: usize = 10_000;

pub fn validate_email(email: &str) -> Result<(), &'static str> {
    let email = email.trim();
    if email.is_empty() || email.len() > MAX_EMAIL_LEN {
        return Err("Invalid email address");
    }
    let Some((local, domain)) = email.split_once('@') else {
        return Err("Invalid email address");
    };
    if local.is_empty() || domain.is_empty() || !domain.contains('.') {
        return Err("Invalid email address");
    }
    if email.chars().any(|c| c.is_control()) {
        return Err("Invalid email address");
    }
    Ok(())
}

pub fn validate_password(password: &str) -> Result<(), &'static str> {
    if password.len() < MIN_PASSWORD_LEN {
        return Err("Password must be at least 8 characters");
    }
    if password.len() > MAX_PASSWORD_LEN {
        return Err("Password is too long");
    }
    Ok(())
}

pub fn validate_display_name(name: &str) -> Result<(), &'static str> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Display name is required");
    }
    if name.len() > MAX_DISPLAY_NAME_LEN {
        return Err("Display name is too long");
    }
    Ok(())
}

pub fn validate_public_key(public_key: &str) -> Result<(), &'static str> {
    if public_key.is_empty() {
        return Err("Public key is required");
    }
    if public_key.len() > MAX_PUBLIC_KEY_LEN {
        return Err("Public key is too long");
    }
    Ok(())
}
