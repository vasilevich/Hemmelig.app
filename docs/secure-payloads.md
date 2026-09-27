# Secure payload extensions

This fork keeps Hemmelig's existing client-side encryption, secret URL shape, password/view/expiry/IP controls, and authenticated file storage, while adding two encrypted payload types beside normal content.

The public URL does **not** change. Content, redirects, and mini-sites all use the existing forms:

```text
/secret/<id>#<key>
/s/<id>#<key>
```

The server still receives the secret id and encrypted bytes. The fragment key stays in the browser.

## Composer modes

### Content

The original Hemmelig rich-text secret behavior. Existing plaintext-encrypted secrets stay backward compatible: if decrypted text is not a recognized secure-payload envelope, it renders as ordinary content.

### Redirect URL

The destination and optional rich message are serialized into the encrypted secret payload.

Supported recipient behaviors:

- redirect immediately
- show message, then redirect after a configurable delay
- show message with a Continue button
- show content plus a clickable link in a new tab

The destination is never used as a server-side 302. Decryption and navigation happen in the recipient browser, preserving the zero-knowledge model.

Top-level redirect destinations are limited to HTTP/HTTPS so decrypted payloads cannot use `javascript:` or similar navigation schemes against the trusted parent page.

### Mini-site

Mini-site creation is authenticated because it reuses the existing Hemmelig file-upload API, which is already behind `authMiddleware`.

There are two authoring paths:

1. **Single page**
    - existing Hemmelig WYSIWYG editor for page content
    - arbitrary CSS
    - arbitrary JavaScript
2. **ZIP / project folder**
    - upload a ZIP, or choose a browser folder
    - files are normalized and ZIPped client-side
    - one HTML file (normally `index.html`) is selected as the entry point

The project is compressed **before** encryption and uploaded as **one encrypted attachment** named generically as `project.bundle`.

The encrypted secret payload contains only encrypted metadata such as:

```json
{
    "marker": "hemmelig.secure-payload",
    "version": 1,
    "type": "site",
    "bundleFileId": "<opaque file id>",
    "entry": "index.html",
    "display": "site-only",
    "projectName": "Temporary checkout demo"
}
```

All of that JSON is encrypted with the same secret key before it reaches the server.

## Recipient mini-site flow

After the normal Hemmelig unlock/reveal step:

1. download the encrypted project attachment using Hemmelig's existing capability token
2. decrypt it locally with the secret key
3. unzip it locally
4. construct a temporary in-memory project filesystem
5. rewrite local static references where required
6. launch the selected HTML entry in a sandboxed iframe

The UI shows progress such as:

- Downloading encrypted project…
- Decrypting project…
- Extracting project…
- Launching secure demo…

Nothing is extracted server-side.

## Sandbox model

The outer iframe intentionally does **not** include `allow-same-origin`. The uploaded JavaScript therefore runs in an opaque origin and cannot access the Hemmelig parent DOM, cookies, localStorage, session, or authenticated API authority.

The sandbox allows normal demo capabilities such as scripts, forms, popups, downloads, presentation APIs, payment APIs, WebAuthn requests, clipboard permissions, and user-activated top navigation.

Nested external iframes and external network calls are not domain-allowlisted by this fork. The goal is to let temporary payment/PSP demos behave like normal web applications while keeping their code outside the trusted Hemmelig origin authority.

The sandbox bootstrap is served at `/sandbox.html` on the same hostname. It is loaded inside an iframe with the sandbox attribute and no `allow-same-origin`. The trusted parent then transfers the decrypted, rewritten document via `postMessage`.

Hemmelig's normal restrictive CSP is deliberately not attached to `/sandbox.html`, because that would block arbitrary demo JavaScript/CSS. The browser iframe sandbox is the isolation boundary for demo code.

## Project runtime

The browser runtime currently handles common static-project behavior:

- HTML/CSS/JS
- images, fonts, media, JSON and other assets
- CSS `url(...)`
- CSS `@import`
- normal scripts and basic local ES-module imports
- local HTML navigation
- local nested HTML iframes
- relative `fetch()` for files inside the encrypted project bundle
- untouched external URLs, API calls, iframes and resources

This is a static-project runtime. Source repositories that require Node/Vite/Webpack compilation should be built first and the resulting static output uploaded.

## Project archive sanity limits

These are browser-stability checks, not a content security policy:

- reject archive paths that contain `..`
- strip common junk such as `__MACOSX`, `.DS_Store`, and `Thumbs.db`
- maximum 5,000 files
- maximum 250 MB uncompressed client-side project size

The server upload limit remains Hemmelig's existing `maxSecretSize` setting. The supplied deployment examples set it to 100 MB so realistic encrypted demo bundles fit.

## Runtime branding / Telegram previews

This fork removes the need for a bind-mounted patched `index.html`.

In production, the server renders the SPA metadata from environment values:

- `HEMMELIG_META_TITLE`
- `HEMMELIG_META_DESCRIPTION`
- `HEMMELIG_META_IMAGE`
- `HEMMELIG_BASE_URL`

When explicit meta values are not set, the instance name/description are used.

Because SPA route documents, including `/secret/:id`, receive the same branded shell, Telegram/Open Graph previews can show AmyPay/Affipay branding without leaking decrypted secret information.

## Docker

This fork includes:

- `.github/workflows/publish-secure-v7.yml` to build multi-arch images at `ghcr.io/vasilevich/hemmelig-secure:v7`
- `deploy/amypay/docker-compose.yml`
- `deploy/affipay/docker-compose.yml`
- `deploy/.env.example`

The deployment examples preserve the existing live container names, LAN-only ports, and named data/upload volumes.

## Future Git import

A Git import feature is intentionally not part of this first implementation.

Recommended secure design:

```text
git clone using the developer's local SSH agent
build if necessary
bundle static output locally
encrypt locally
upload ciphertext
print /secret/<id>#<key>
```

That can become a CLI command such as `hemmelig site push ./dist` or `hemmelig site push git@github.com:owner/private.git`.

An optional server-side private Git import could generate a temporary read-only deploy key, but that mode is not zero-knowledge because the Hemmelig server would temporarily see repository plaintext.
