import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type ProjectFiles = Record<string, Uint8Array>;

export interface PreparedProject {
    archive: Uint8Array;
    entry: string;
    fileCount: number;
    uncompressedBytes: number;
    paths: string[];
}

const MAX_PROJECT_FILES = 5000;
const MAX_PROJECT_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;

const textExtensions = new Set([
    'html',
    'htm',
    'css',
    'js',
    'mjs',
    'cjs',
    'json',
    'txt',
    'svg',
    'xml',
    'md',
    'map',
    'webmanifest',
]);

const mimeTypes: Record<string, string> = {
    html: 'text/html;charset=utf-8',
    htm: 'text/html;charset=utf-8',
    css: 'text/css;charset=utf-8',
    js: 'text/javascript;charset=utf-8',
    mjs: 'text/javascript;charset=utf-8',
    cjs: 'text/javascript;charset=utf-8',
    json: 'application/json;charset=utf-8',
    txt: 'text/plain;charset=utf-8',
    svg: 'image/svg+xml',
    xml: 'application/xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    pdf: 'application/pdf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    wasm: 'application/wasm',
};

const extensionOf = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';

export const mimeForPath = (path: string) =>
    mimeTypes[extensionOf(path)] ?? 'application/octet-stream';

export const normalizeProjectPath = (raw: string): string | null => {
    const cleaned = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!cleaned || cleaned.includes('\0')) return null;

    const output: string[] = [];
    for (const segment of cleaned.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            if (!output.length) return null;
            output.pop();
            continue;
        }
        output.push(segment);
    }

    return output.join('/');
};

const isArchiveJunk = (path: string) =>
    path.startsWith('__MACOSX/') ||
    path.endsWith('/.DS_Store') ||
    path === '.DS_Store' ||
    path.endsWith('/Thumbs.db') ||
    path === 'Thumbs.db';

const validateProjectFiles = (files: ProjectFiles): ProjectFiles => {
    const normalized: ProjectFiles = {};
    let total = 0;

    for (const [rawPath, bytes] of Object.entries(files)) {
        if (rawPath.split(/[\\/]/).includes('..')) {
            throw new Error(`Project contains an unsafe path: ${rawPath}`);
        }

        const path = normalizeProjectPath(rawPath);
        if (!path || isArchiveJunk(path) || rawPath.endsWith('/')) continue;
        if (normalized[path]) {
            throw new Error(`Project contains duplicate path: ${path}`);
        }

        normalized[path] = bytes;
        total += bytes.byteLength;

        if (Object.keys(normalized).length > MAX_PROJECT_FILES) {
            throw new Error(`Project has more than ${MAX_PROJECT_FILES} files.`);
        }
        if (total > MAX_PROJECT_UNCOMPRESSED_BYTES) {
            throw new Error('Project expands beyond 250 MB.');
        }
    }

    if (!Object.keys(normalized).length) {
        throw new Error('Project does not contain any files.');
    }

    return normalized;
};

const stripCommonFolder = (files: ProjectFiles): ProjectFiles => {
    const paths = Object.keys(files);
    const roots = new Set(paths.map((path) => path.split('/')[0]));

    if (roots.size !== 1 || paths.some((path) => !path.includes('/'))) {
        return files;
    }

    const root = [...roots][0] + '/';
    return Object.fromEntries(paths.map((path) => [path.slice(root.length), files[path]]));
};

const chooseEntry = (paths: string[], preferred?: string) => {
    if (preferred) {
        const normalized = normalizeProjectPath(preferred);
        if (normalized && paths.includes(normalized)) return normalized;
    }

    for (const candidate of ['index.html', 'index.htm']) {
        if (paths.includes(candidate)) return candidate;
    }

    const firstHtml = paths.find((path) => /\.html?$/i.test(path));
    if (firstHtml) return firstHtml;

    throw new Error('Project needs an HTML entry file (normally index.html).');
};

const prepareFiles = (input: ProjectFiles, preferredEntry?: string): PreparedProject => {
    const files = stripCommonFolder(validateProjectFiles(input));
    const paths = Object.keys(files).sort();
    const entry = chooseEntry(paths, preferredEntry);
    const uncompressedBytes = Object.values(files).reduce(
        (sum, bytes) => sum + bytes.byteLength,
        0
    );
    const archive = zipSync(files, { level: 6 });

    return { archive, entry, fileCount: paths.length, uncompressedBytes, paths };
};

export const prepareZipProject = async (file: File, preferredEntry?: string) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(bytes);
    return prepareFiles(files, preferredEntry);
};

export const prepareFolderProject = async (files: FileList | File[], preferredEntry?: string) => {
    const entries = Array.from(files);
    const rawPaths = entries.map((file) => {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        return relative || file.name;
    });

    const commonRoot =
        rawPaths.length > 0 &&
        rawPaths.every((path) => path.includes('/')) &&
        new Set(rawPaths.map((path) => path.split('/')[0])).size === 1
            ? rawPaths[0].split('/')[0] + '/'
            : '';

    const project: ProjectFiles = {};
    for (let index = 0; index < entries.length; index++) {
        const path = commonRoot ? rawPaths[index].slice(commonRoot.length) : rawPaths[index];
        if (!path) continue;
        project[path] = new Uint8Array(await entries[index].arrayBuffer());
    }

    return prepareFiles(project, preferredEntry);
};

export const prepareSinglePageProject = (bodyHtml: string, css: string, javascript: string) => {
    const safeCss = css.replace(/<\/style/gi, '<\\/style');
    const safeJavaScript = javascript.replace(/<\/script/gi, '<\\/script');
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${safeCss}</style>
</head>
<body>
${bodyHtml}
<script>${safeJavaScript}<\/script>
</body>
</html>`;

    return prepareFiles({ 'index.html': strToU8(html) }, 'index.html');
};

export const unpackProject = (archive: Uint8Array): ProjectFiles =>
    stripCommonFolder(validateProjectFiles(unzipSync(archive)));

const bytesToBase64 = (bytes: Uint8Array) => {
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
};

const dataUrlFor = (path: string, bytes: Uint8Array) =>
    `data:${mimeForPath(path)};base64,${bytesToBase64(bytes)}`;

const isExternalReference = (value: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value.trim());

const dirname = (path: string) => {
    const index = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index);
};

export const resolveProjectReference = (currentPath: string, reference: string) => {
    const value = reference.trim();
    if (!value || isExternalReference(value)) return null;

    const withoutHash = value.split('#', 1)[0].split('?', 1)[0];
    const combined = withoutHash.startsWith('/')
        ? withoutHash
        : [dirname(currentPath), withoutHash].filter(Boolean).join('/');

    return normalizeProjectPath(combined);
};

const textOf = (files: ProjectFiles, path: string) => {
    const bytes = files[path];
    if (!bytes) return null;
    return strFromU8(bytes);
};

const rewriteCss = (
    source: string,
    currentPath: string,
    files: ProjectFiles,
    stack = new Set<string>()
): string =>
    source
        .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _quote, reference: string) => {
            const path = resolveProjectReference(currentPath, reference);
            if (!path || !files[path]) return full;
            return `url("${dataUrlFor(path, files[path])}")`;
        })
        .replace(
            /@import\s+(?:url\()?\s*(['"])([^'"]+)\1\s*\)?\s*;?/gi,
            (full, _quote, reference: string) => {
                const path = resolveProjectReference(currentPath, reference);
                if (!path || !files[path] || extensionOf(path) !== 'css' || stack.has(path))
                    return full;
                const nextStack = new Set(stack);
                nextStack.add(path);
                return rewriteCss(textOf(files, path) ?? '', path, files, nextStack);
            }
        );

const moduleDataUrl = (path: string, files: ProjectFiles, stack = new Set<string>()): string => {
    const source = textOf(files, path);
    if (source === null) return '';

    if (stack.has(path)) {
        return dataUrlFor(path, files[path]);
    }

    const nextStack = new Set(stack);
    nextStack.add(path);

    const rewritten = source.replace(
        /((?:from\s*|import\s*\(\s*)['"])([^'"]+)(['"]\s*\)?)/g,
        (full, prefix: string, reference: string, suffix: string) => {
            const target = resolveProjectReference(path, reference);
            if (!target || !files[target] || !/\.(?:m?js|cjs)$/i.test(target)) return full;
            return `${prefix}${moduleDataUrl(target, files, nextStack)}${suffix}`;
        }
    );

    return `data:text/javascript;charset=utf-8;base64,${bytesToBase64(strToU8(rewritten))}`;
};

const virtualFileManifest = (files: ProjectFiles) =>
    Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [
            path,
            { mime: mimeForPath(path), data: bytesToBase64(bytes) },
        ])
    );

const bootstrapScript = (files: ProjectFiles, currentPath: string) => `
(() => {
    const files = ${JSON.stringify(virtualFileManifest(files))};
    const currentPath = ${JSON.stringify(currentPath)};
    const nativeFetch = window.fetch.bind(window);

    const normalize = (raw) => {
        const parts = [];
        for (const segment of raw.replace(/\\\\/g, '/').replace(/^\\/+/, '').split('/')) {
            if (!segment || segment === '.') continue;
            if (segment === '..') {
                if (!parts.length) return null;
                parts.pop();
            } else {
                parts.push(segment);
            }
        }
        return parts.join('/');
    };

    const dirname = (path) => {
        const index = path.lastIndexOf('/');
        return index === -1 ? '' : path.slice(0, index);
    };

    const resolve = (reference) => {
        if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(reference)) return null;
        const bare = reference.split('#', 1)[0].split('?', 1)[0];
        return normalize(bare.startsWith('/') ? bare : [dirname(currentPath), bare].filter(Boolean).join('/'));
    };

    const decode = (base64) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    };

    window.fetch = (input, init) => {
        const reference = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const path = resolve(reference);
        const file = path && files[path];
        if (file) {
            return Promise.resolve(new Response(decode(file.data), {
                status: 200,
                headers: { 'Content-Type': file.mime },
            }));
        }
        return nativeFetch(input, init);
    };

    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target instanceof Element ? event.target.closest('a[data-hemmelig-nav]') : null;
        if (!target) return;
        event.preventDefault();
        parent.postMessage({ type: 'hemmelig-site:navigate', path: target.getAttribute('data-hemmelig-nav') }, '*');
    });
})();
`;

const rewriteSrcset = (value: string, currentPath: string, files: ProjectFiles) =>
    value
        .split(',')
        .map((item) => {
            const [reference, descriptor] = item.trim().split(/\s+/, 2);
            const path = resolveProjectReference(currentPath, reference);
            return path && files[path]
                ? `${dataUrlFor(path, files[path])}${descriptor ? ' ' + descriptor : ''}`
                : item.trim();
        })
        .join(', ');

export const buildSandboxDocument = (files: ProjectFiles, entry: string, depth = 0): string => {
    const normalizedEntry = normalizeProjectPath(entry);
    if (!normalizedEntry || !files[normalizedEntry]) {
        throw new Error(`Project entry not found: ${entry}`);
    }

    const source = textOf(files, normalizedEntry);
    if (source === null) throw new Error('Project entry is not text.');

    const parser = new DOMParser();
    const document = parser.parseFromString(source, 'text/html');

    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.prepend(referrer);

    for (const style of Array.from(document.querySelectorAll('style'))) {
        style.textContent = rewriteCss(style.textContent ?? '', normalizedEntry, files);
    }

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[style]'))) {
        element.setAttribute(
            'style',
            rewriteCss(element.getAttribute('style') ?? '', normalizedEntry, files)
        );
    }

    for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[href]'))) {
        const href = link.getAttribute('href') ?? '';
        const path = resolveProjectReference(normalizedEntry, href);
        if (!path || !files[path]) continue;

        if (link.rel.toLowerCase() === 'stylesheet' && extensionOf(path) === 'css') {
            const style = document.createElement('style');
            style.textContent = rewriteCss(textOf(files, path) ?? '', path, files);
            link.replaceWith(style);
        } else {
            link.href = dataUrlFor(path, files[path]);
        }
    }

    for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) {
        const src = script.getAttribute('src') ?? '';
        const path = resolveProjectReference(normalizedEntry, src);
        if (!path || !files[path]) continue;

        const sourceText = textOf(files, path) ?? '';
        if ((script.type || '').toLowerCase() === 'module' || /\.m?js$/i.test(path)) {
            script.src = moduleDataUrl(path, files);
        } else {
            script.removeAttribute('src');
            script.textContent = sourceText;
        }
        script.removeAttribute('integrity');
        script.removeAttribute('crossorigin');
    }

    const assetSelectors = [
        ['img[src]', 'src'],
        ['source[src]', 'src'],
        ['video[src]', 'src'],
        ['audio[src]', 'src'],
        ['input[type="image"][src]', 'src'],
        ['object[data]', 'data'],
        ['embed[src]', 'src'],
    ] as const;

    for (const [selector, attribute] of assetSelectors) {
        for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
            const reference = element.getAttribute(attribute) ?? '';
            const path = resolveProjectReference(normalizedEntry, reference);
            if (path && files[path]) element.setAttribute(attribute, dataUrlFor(path, files[path]));
        }
    }

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[srcset]'))) {
        element.setAttribute(
            'srcset',
            rewriteSrcset(element.getAttribute('srcset') ?? '', normalizedEntry, files)
        );
    }

    for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = anchor.getAttribute('href') ?? '';
        const path = resolveProjectReference(normalizedEntry, href);
        if (!path || !files[path]) continue;

        if (/\.html?$/i.test(path)) {
            anchor.setAttribute('href', '#');
            anchor.setAttribute('data-hemmelig-nav', path);
        } else {
            anchor.href = dataUrlFor(path, files[path]);
        }
    }

    if (depth < 4) {
        for (const frame of Array.from(
            document.querySelectorAll<HTMLIFrameElement>('iframe[src]')
        )) {
            const src = frame.getAttribute('src') ?? '';
            const path = resolveProjectReference(normalizedEntry, src);
            if (path && files[path] && /\.html?$/i.test(path)) {
                frame.removeAttribute('src');
                frame.srcdoc = buildSandboxDocument(files, path, depth + 1);
            }
        }
    }

    const bootstrap = document.createElement('script');
    bootstrap.textContent = bootstrapScript(files, normalizedEntry);
    document.head.prepend(bootstrap);

    return '<!doctype html>\n' + document.documentElement.outerHTML;
};
