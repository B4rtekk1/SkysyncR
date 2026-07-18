const MIN_PASSWORD_LEN: usize = 12;
const MAX_PASSWORD_LEN: usize = 128;
const MAX_EMAIL_LEN: usize = 254;
const MAX_DISPLAY_NAME_LEN: usize = 100;
const MAX_PUBLIC_KEY_LEN: usize = 10_000;
const COMMON_PASSWORDS: &[&str] = &[
    "password",
    "password123",
    "password123!",
    "12345678",
    "123456789",
    "qwerty123",
    "letmein",
    "welcome123",
    "admin123",
    "iloveyou",
    "monkey123",
    "dragon123",
    "football",
    "baseball",
    "trustno1",
    "sunshine",
    "princess",
    "qwertyuiop",
    "password1",
    "abc123456",
    "1q2w3e4r",
];

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
        return Err("Password must be at least 12 characters");
    }
    if password.len() > MAX_PASSWORD_LEN {
        return Err("Password is too long");
    }
    if !password.chars().any(|c| c.is_ascii_uppercase()) {
        return Err("Password must include an uppercase letter");
    }
    if !password.chars().any(|c| c.is_ascii_lowercase()) {
        return Err("Password must include a lowercase letter");
    }
    if !password.chars().any(|c| c.is_ascii_digit()) {
        return Err("Password must include a number");
    }
    if !password.chars().any(|c| !c.is_ascii_alphanumeric()) {
        return Err("Password must include a special character");
    }
    if has_repeated_chars(password) {
        return Err("Password must not contain 3 or more repeated characters");
    }
    if has_sequential_chars(password) {
        return Err("Password must not contain sequential patterns");
    }
    if COMMON_PASSWORDS
        .iter()
        .any(|common| password.eq_ignore_ascii_case(common))
    {
        return Err("Password is too common");
    }
    Ok(())
}

fn has_repeated_chars(password: &str) -> bool {
    let mut previous = None;
    let mut count = 0;

    for ch in password.chars() {
        if Some(ch) == previous {
            count += 1;
        } else {
            previous = Some(ch);
            count = 1;
        }

        if count >= 3 {
            return true;
        }
    }

    false
}

fn has_sequential_chars(password: &str) -> bool {
    let lower = password.to_ascii_lowercase();
    let sequences = [
        "abcdefghijklmnopqrstuvwxyz",
        "0123456789",
        "qwertyuiop",
        "asdfghjkl",
        "zxcvbnm",
    ];

    sequences.iter().any(|sequence| {
        sequence.as_bytes().windows(4).any(|chunk| {
            let chunk = std::str::from_utf8(chunk).expect("static sequence is valid UTF-8");
            let reversed: String = chunk.chars().rev().collect();

            lower.contains(chunk) || lower.contains(&reversed)
        })
    })
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

#[cfg(test)]
mod tests {
    use super::validate_password;

    #[test]
    fn password_accepts_policy_compliant_value() {
        assert_eq!(validate_password("Safer!Phrase92"), Ok(()));
    }

    #[test]
    fn password_rejects_values_outside_backend_policy() {
        let cases = [
            "Short1!",
            "lowercase-only1!",
            "UPPERCASE-ONLY1!",
            "NoNumberHere!",
            "NoSpecialHere1",
            "Repeeeated1!",
            "Abcdsafe123!",
            "Password123!",
        ];

        for password in cases {
            assert!(validate_password(password).is_err(), "{password} passed");
        }
    }
}
