# Privacy Threat Model

## Scope

This model covers SkysyncR browser-side vault encryption for private file keys, encrypted metadata, and the locally stored encrypted account private key.

## Assets

- User password.
- Encrypted private key stored in IndexedDB.
- Active decrypted private key held as a non-extractable `CryptoKey`.
- Per-file symmetric keys wrapped for recipients.
- Plaintext file content and metadata while being viewed or edited.
- Access and refresh session cookies or tokens.

## Trust Boundaries

- Browser runtime: trusted to enforce Web Crypto non-extractability and origin isolation.
- IndexedDB: persistent but not trusted for plaintext secrets.
- Application backend: trusted for authentication, authorization, public key distribution, and ciphertext storage, but not trusted with private keys.
- Network: untrusted; transport security is required.
- Third-party scripts and browser extensions: untrusted and treated as possible script execution risks.

## Main Threats

- Persistent key disclosure: a local attacker, malware, or compromised browser profile reads IndexedDB.
- XSS or supply-chain script execution: injected code uses currently unlocked keys or plaintext data.
- Session left unlocked: a user walks away while the vault remains open.
- Device lock or page suspension: the browser keeps sensitive state live longer than expected.
- Logout bypass: active secrets survive an application logout.
- Server compromise: stored ciphertext, wrapped file keys, and public keys are exposed.

## Current Controls

- IndexedDB stores only the password-encrypted private key.
- Decrypted private keys are imported with `extractable: false`.
- Active private keys are held only in memory.
- Active private keys are cleared on logout.
- Active private keys are cleared after 15 minutes of browser inactivity.
- Active private keys are cleared when the page is hidden, unloaded, or frozen.
- Legacy `active-private-key:*` IndexedDB entries are removed on unlock and cleanup.
- File content and metadata decryption require the active private key.

## Residual Risks

- Web Crypto non-extractability does not stop malicious same-origin JavaScript from invoking decrypt operations while the vault is unlocked.
- Browser extensions, compromised dependencies, or XSS can read plaintext rendered in the DOM.
- Memory can be inspected by malware or a compromised operating system.
- Device lock detection in browsers is indirect; page visibility, unload, and freeze events are used as practical signals.
- Encrypted private key strength depends on password quality and KDF parameters.

## Required Follow-ups

- Maintain a strict Content Security Policy that blocks inline script and restricts third-party sources.
- Audit dependencies used in the web client.
- Keep password rules and KDF parameters under review.
- Add automated tests for active-key lifecycle behavior.
- Consider an explicit in-app lock action and short-lived unlock prompts for high-risk operations.
