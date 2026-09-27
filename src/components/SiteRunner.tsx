import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { decryptFile } from '../lib/crypto';
import type { SitePayload } from '../lib/securePayload';
import {
    buildSandboxDocument,
    normalizeProjectPath,
    unpackProject,
    type ProjectFiles,
} from '../lib/siteBundle';

interface SiteFile {
    id: string;
    filename: string;
    token: string;
    displayName?: string;
}

interface SiteRunnerProps {
    payload: SitePayload;
    files: SiteFile[];
    encryptionKey: string;
    salt: string;
}

const SANDBOX_PERMISSIONS = [
    // Deliberately broad: temporary demos may exercise real PSP/browser flows.
    // The one security boundary we keep is the deliberate absence of
    // allow-same-origin, so demo JS never gains Hemmelig's origin authority.
    'allow-scripts',
    'allow-forms',
    'allow-popups',
    'allow-popups-to-escape-sandbox',
    'allow-downloads',
    'allow-modals',
    'allow-orientation-lock',
    'allow-pointer-lock',
    'allow-presentation',
    'allow-top-navigation',
].join(' ');

const FEATURE_PERMISSIONS = [
    'autoplay *',
    'camera *',
    'clipboard-read *',
    'clipboard-write *',
    'fullscreen *',
    'geolocation *',
    'microphone *',
    'payment *',
    'publickey-credentials-get *',
].join('; ');

export function SiteRunner({ payload, files, encryptionKey, salt }: SiteRunnerProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [projectFiles, setProjectFiles] = useState<ProjectFiles | null>(null);
    const [currentEntry, setCurrentEntry] = useState(payload.entry);
    const [srcDoc, setSrcDoc] = useState<string | null>(null);
    const [status, setStatus] = useState('Downloading encrypted project…');
    const [error, setError] = useState<string | null>(null);

    const bundle = useMemo(
        () => files.find((file) => file.id === payload.bundleFileId),
        [files, payload.bundleFileId]
    );

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setError(null);
            setStatus('Downloading encrypted project…');

            if (!bundle) {
                setError('The encrypted project bundle is missing.');
                return;
            }

            try {
                const response = await api.files[':id'].$get(
                    { param: { id: bundle.id } },
                    { headers: { 'x-hemmelig-file-token': bundle.token } }
                );

                if (!response.ok) {
                    throw new Error('Could not download encrypted project.');
                }

                setStatus('Decrypting project…');
                const encrypted = new Uint8Array(await response.arrayBuffer());
                const decrypted = await decryptFile(encrypted, encryptionKey, salt);
                if (cancelled) return;

                setStatus('Extracting project…');
                const unpacked = unpackProject(decrypted);
                const entry = normalizeProjectPath(payload.entry);
                if (!entry || !unpacked[entry]) {
                    throw new Error(`Project entry not found: ${payload.entry}`);
                }

                if (cancelled) return;
                setProjectFiles(unpacked);
                setCurrentEntry(entry);
                setStatus('Launching secure demo…');
                setSrcDoc(buildSandboxDocument(unpacked, entry));
            } catch (caught) {
                if (!cancelled) {
                    console.error('Failed to prepare encrypted mini-site:', caught);
                    setError(
                        caught instanceof Error
                            ? caught.message
                            : 'Could not prepare encrypted project.'
                    );
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [bundle, encryptionKey, payload.entry, salt]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data as { type?: string; path?: string } | null;
            if (!data || data.type !== 'hemmelig-site:navigate' || typeof data.path !== 'string') {
                return;
            }

            const path = normalizeProjectPath(data.path);
            if (!path || !projectFiles?.[path]) return;

            try {
                setStatus('Opening page…');
                setCurrentEntry(path);
                setSrcDoc(buildSandboxDocument(projectFiles, path));
            } catch (caught) {
                console.error('Failed to navigate encrypted mini-site:', caught);
            }
        };

        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [projectFiles]);

    const loading = !srcDoc && !error;

    const body = (
        <div className="w-full h-full bg-white">
            {loading && (
                <div className="w-full h-full min-h-80 grid place-items-center bg-canvas text-fg">
                    <div className="grid justify-items-center gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-accent" />
                        <div className="font-mono text-ui text-muted">{status}</div>
                    </div>
                </div>
            )}

            {error && (
                <div className="w-full h-full min-h-80 grid place-items-center bg-canvas text-fg px-6">
                    <div className="max-w-lg text-center grid gap-2">
                        <div className="font-medium">Could not launch secure demo</div>
                        <div className="text-sm text-danger">{error}</div>
                    </div>
                </div>
            )}

            {srcDoc && (
                <iframe
                    ref={iframeRef}
                    key={currentEntry}
                    title={payload.projectName || 'Encrypted mini-site'}
                    src="/sandbox.html"
                    sandbox={SANDBOX_PERMISSIONS}
                    allow={FEATURE_PERMISSIONS}
                    referrerPolicy="no-referrer"
                    onLoad={() => {
                        iframeRef.current?.contentWindow?.postMessage(
                            { type: 'hemmelig-site:load', html: srcDoc },
                            '*'
                        );
                    }}
                    className="block w-full h-full border-0 bg-white"
                />
            )}
        </div>
    );

    if (payload.display === 'site-only') {
        return <div className="fixed inset-0 z-[100] bg-white">{body}</div>;
    }

    return (
        <main className="max-w-content mx-auto px-6 py-8">
            <div className="border border-line rounded-md overflow-hidden bg-surface">
                <div className="px-4 py-3 border-b border-line-soft flex items-center gap-3">
                    <span className="font-medium">
                        {payload.projectName || 'Encrypted mini-site'}
                    </span>
                    <span className="ml-auto font-mono text-xs text-muted">{currentEntry}</span>
                </div>
                <div className="h-[75vh]">{body}</div>
            </div>
        </main>
    );
}
