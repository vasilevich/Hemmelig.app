import type { Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { expect, test } from './fixtures';

const createdSecretUrl = async (page: Page) => {
    await expect(page.getByText(/secret.*created/i)).toBeVisible({ timeout: 15000 });
    const url = (await page.getByTestId('secret-url').textContent()) ?? '';
    expect(url).toMatch(/\/s\/[^/#]+#.+/);
    return url;
};

test.describe('Secure payload extensions', () => {
    test('creates and reveals an encrypted redirect payload', async ({
        authenticatedPage: page,
    }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'Redirect URL' }).click();

        await page
            .getByPlaceholder('https://example.com/secure-checkout')
            .fill('http://localhost:5173/privacy?from=secure-redirect');

        await page.getByRole('button', { name: /create link/i }).click();
        const secretUrl = await createdSecretUrl(page);

        await page.goto(secretUrl);
        await page.getByRole('button', { name: /unlock|view/i }).click();

        await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible({
            timeout: 10000,
        });
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page).toHaveURL(/\/privacy\?from=secure-redirect$/);
    });

    test('runs WYSIWYG HTML, CSS and JavaScript in the opaque mini-site sandbox', async ({
        authenticatedPage: page,
    }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'Mini-site' }).click();

        await page.getByLabel('Project name (encrypted)').fill('Payment Demo');

        const editor = page.locator('.ProseMirror');
        await editor.click();
        await editor.fill('Temporary payment demo');

        await page.getByLabel('CSS').fill('body { background: rgb(1, 2, 3); color: white; }');
        await page.getByLabel('JavaScript').fill(`
            document.body.dataset.demoJs = 'ran';
            const proof = document.createElement('div');
            proof.id = 'js-proof';
            proof.textContent = 'Sandbox JS ran';
            document.body.appendChild(proof);
            try {
                void window.parent.document.body;
                document.body.dataset.parentDom = 'accessible';
            } catch {
                document.body.dataset.parentDom = 'blocked';
            }
        `);

        await page.getByRole('button', { name: /create link/i }).click();
        const secretUrl = await createdSecretUrl(page);

        await page.goto(secretUrl);
        await page.getByRole('button', { name: /unlock|view/i }).click();

        const frame = page.frameLocator('iframe[title="Payment Demo"]');
        await expect(frame.getByText('Temporary payment demo')).toBeVisible({ timeout: 15000 });
        await expect(frame.getByText('Sandbox JS ran')).toBeVisible({ timeout: 15000 });

        const body = frame.locator('body');
        await expect(body).toHaveAttribute('data-demo-js', 'ran');
        await expect(body).toHaveAttribute('data-parent-dom', 'blocked');

        const background = await body.evaluate(
            (element) => getComputedStyle(element).backgroundColor
        );
        expect(background).toBe('rgb(1, 2, 3)');
    });

    test('uploads one encrypted ZIP bundle and runs a multi-file project', async ({
        authenticatedPage: page,
    }) => {
        const archive = zipSync(
            {
                'index.html': strToU8(`<!doctype html>
<html>
<head>
    <link rel="stylesheet" href="./assets/style.css">
</head>
<body>
    <h1 id="zip-title">ZIP Payment Demo</h1>
    <div id="config-value">waiting</div>
    <iframe id="local-frame" src="./second.html"></iframe>
    <script src="./assets/app.js"></script>
</body>
</html>`),
                'assets/style.css': strToU8(
                    '#zip-title { color: rgb(10, 20, 30); } body { font-family: sans-serif; }'
                ),
                'assets/app.js': strToU8(`
                    fetch('./config.json')
                        .then((response) => response.json())
                        .then((data) => {
                            document.getElementById('config-value').textContent = data.status;
                        });
                    document.body.dataset.zipJs = 'ran';
                `),
                'config.json': strToU8(JSON.stringify({ status: 'relative fetch works' })),
                'second.html': strToU8(
                    '<!doctype html><html><body><p id="second-page">Nested local iframe works</p></body></html>'
                ),
            },
            { level: 6 }
        );

        await page.goto('/');
        await page.getByRole('button', { name: 'Mini-site' }).click();
        await page.getByRole('button', { name: 'ZIP / project folder' }).click();
        await page.getByLabel('Project name (encrypted)').fill('ZIP PSP Demo');

        const zipInput = page.locator('input[accept*=".zip"]');
        await zipInput.setInputFiles({
            name: 'psp-demo.zip',
            mimeType: 'application/zip',
            buffer: Buffer.from(archive),
        });

        await expect(page.getByText(/5 files/)).toBeVisible({ timeout: 10000 });
        await expect(page.getByLabel('Entry page')).toHaveValue('index.html');

        await page.getByRole('button', { name: /create link/i }).click();
        const secretUrl = await createdSecretUrl(page);

        await page.goto(secretUrl);
        await page.getByRole('button', { name: /unlock|view/i }).click();

        const frame = page.frameLocator('iframe').first();
        await expect(frame.getByText('ZIP Payment Demo')).toBeVisible({ timeout: 15000 });
        await expect(frame.getByText('relative fetch works')).toBeVisible({ timeout: 15000 });

        const titleColor = await frame
            .locator('#zip-title')
            .evaluate((element) => getComputedStyle(element).color);
        expect(titleColor).toBe('rgb(10, 20, 30)');
        await expect(frame.locator('body')).toHaveAttribute('data-zip-js', 'ran');

        const nested = frame.frameLocator('#local-frame');
        await expect(nested.getByText('Nested local iframe works')).toBeVisible({
            timeout: 15000,
        });
    });
});
