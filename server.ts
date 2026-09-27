import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import 'dotenv/config';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import api, { securityHeadersMiddleware } from './api/app';
import config from './api/config';
import { buildSecurityTxt } from './api/lib/security-txt';

const port = config.get('server.port')!;

const app = new Hono();

// Apply security headers to API responses and to frontend documents.
app.use('*', securityHeadersMiddleware);

// Mount the API first (before static files)
app.route('/api', api);

// Tell people where to report a security issue (RFC 9116).
app.get('/.well-known/security.txt', (c) => c.text(buildSecurityTxt()));

const defaultDescription =
    'Share secrets securely with encrypted messages that automatically self-destruct after being read.';

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const indexTemplate =
    process.env.NODE_ENV === 'production' ? readFileSync('./dist/index.html', 'utf8') : null;

const replaceMeta = (html: string, pattern: RegExp, replacement: string) =>
    pattern.test(html) ? html.replace(pattern, replacement) : html;

const renderBrandedIndex = () => {
    if (!indexTemplate) return '';

    const title =
        process.env.HEMMELIG_META_TITLE ||
        process.env.HEMMELIG_INSTANCE_NAME ||
        'Hemmelig - Share Secrets Securely';
    const description =
        process.env.HEMMELIG_META_DESCRIPTION ||
        process.env.HEMMELIG_INSTANCE_DESCRIPTION ||
        defaultDescription;
    const baseUrl = (process.env.HEMMELIG_BASE_URL || process.env.BETTER_AUTH_URL || '').replace(
        /\/$/,
        ''
    );
    const pageUrl = baseUrl ? `${baseUrl}/` : '';
    const imageUrl =
        process.env.HEMMELIG_META_IMAGE ||
        (baseUrl ? `${baseUrl}/icons/icon-512x512.png` : '/icons/icon-512x512.png');

    let html = indexTemplate;

    html = replaceMeta(html, /<title>.*?<\/title>/is, `<title>${escapeHtml(title)}</title>`);
    html = replaceMeta(
        html,
        /<meta\s+name="title"\s+content="[^"]*"\s*\/>/i,
        `<meta name="title" content="${escapeHtml(title)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+name="description"\s+content="[^"]*"\s*\/>/i,
        `<meta name="description" content="${escapeHtml(description)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/i,
        `<meta property="og:title" content="${escapeHtml(title)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/i,
        `<meta property="og:description" content="${escapeHtml(description)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/i,
        `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/i,
        `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+property="twitter:card"\s+content="[^"]*"\s*\/>/i,
        '<meta property="twitter:card" content="summary_large_image" />'
    );
    html = replaceMeta(
        html,
        /<meta\s+property="twitter:title"\s+content="[^"]*"\s*\/>/i,
        `<meta property="twitter:title" content="${escapeHtml(title)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+property="twitter:description"\s+content="[^"]*"\s*\/>/i,
        `<meta property="twitter:description" content="${escapeHtml(description)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+property="twitter:url"\s+content="[^"]*"\s*\/>/i,
        `<meta property="twitter:url" content="${escapeHtml(pageUrl)}" />`
    );
    html = replaceMeta(
        html,
        /<meta\s+property="twitter:image"\s+content="[^"]*"\s*\/>/i,
        `<meta property="twitter:image" content="${escapeHtml(imageUrl)}" />`
    );

    return html;
};

const isSpaDocumentPath = (path: string) =>
    !path.startsWith('/api') &&
    path !== '/.well-known/security.txt' &&
    path !== '/sandbox.html' &&
    !/\.[a-z0-9]{1,12}$/i.test(path);

// Serve the branded SPA shell for route documents before static file handling.
// This makes Telegram/Open Graph previews configurable per deployment while
// keeping the encrypted secret path and fragment-key model unchanged.
app.get('*', async (c, next) => {
    if (indexTemplate && isSpaDocumentPath(c.req.path)) {
        return c.html(renderBrandedIndex());
    }
    return next();
});

// Serve static files from the 'dist' directory
app.use('/*', serveStatic({ root: './dist' }));

// SPA fallback
app.get('*', serveStatic({ path: './dist/index.html' }));

// Graceful shutdown handler
function gracefulShutdown(signal: string, server: ReturnType<typeof serve>) {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // Force exit after 10 seconds if graceful shutdown fails
    const forceExitTimeout = setTimeout(() => {
        console.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 10000);

    server.close((err) => {
        clearTimeout(forceExitTimeout);
        if (err) {
            console.error('Error during shutdown:', err);
            process.exit(1);
        }
        console.log('Server closed successfully.');
        process.exit(0);
    });
}

// Start server in production
if (process.env.NODE_ENV === 'production') {
    const server = serve({
        fetch: app.fetch,
        port: port,
    });
    console.log(`Server is running on port ${port}`);

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server));
    process.on('SIGINT', () => gracefulShutdown('SIGINT', server));
}

export default app;
