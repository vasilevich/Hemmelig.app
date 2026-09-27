import { useEffect, useMemo, useState } from 'react';
import type { RedirectPayload } from '../lib/securePayload';
import { Button } from './Button';
import Editor from './Editor';

interface RedirectViewProps {
    payload: RedirectPayload;
    title?: string | null;
}

export function RedirectView({ payload, title }: RedirectViewProps) {
    const [secondsLeft, setSecondsLeft] = useState(
        payload.behavior === 'delay' ? Math.max(1, payload.delaySeconds ?? 3) : 0
    );

    const destination = useMemo(() => payload.url, [payload.url]);

    useEffect(() => {
        if (payload.behavior === 'immediate') {
            window.location.replace(destination);
            return;
        }

        if (payload.behavior !== 'delay') return;

        const delay = Math.max(1, payload.delaySeconds ?? 3);
        setSecondsLeft(delay);

        const interval = window.setInterval(() => {
            setSecondsLeft((current) => Math.max(0, current - 1));
        }, 1000);

        const timeout = window.setTimeout(() => {
            window.location.replace(destination);
        }, delay * 1000);

        return () => {
            window.clearInterval(interval);
            window.clearTimeout(timeout);
        };
    }, [destination, payload.behavior, payload.delaySeconds]);

    if (payload.behavior === 'immediate') {
        return (
            <main className="max-w-reading mx-auto px-6 py-24 flex flex-col items-center gap-3">
                <div className="h-6 w-6 rounded-full border-2 border-line border-t-accent animate-spin" />
                <p className="m-0 font-mono text-ui text-muted">Opening secure link…</p>
            </main>
        );
    }

    return (
        <main className="max-w-reading mx-auto px-6 py-14">
            <div className="border border-line rounded-md bg-surface overflow-hidden">
                <div className="px-4.5 py-3.5 border-b border-line-soft font-medium">
                    {title || 'Secure link'}
                </div>

                {payload.messageHtml ? (
                    <Editor value={payload.messageHtml} editable={false} />
                ) : (
                    <div className="px-5 py-7 text-fg-3">This encrypted link is ready to open.</div>
                )}

                <div className="p-4 border-t border-line-soft flex flex-wrap items-center gap-3">
                    {payload.behavior === 'delay' && (
                        <span className="font-mono text-xs text-muted flex-1">
                            Redirecting in {secondsLeft}s…
                        </span>
                    )}

                    {payload.behavior === 'confirm' && (
                        <Button
                            variant="primary"
                            onClick={() => window.location.replace(destination)}
                            className="ml-auto"
                        >
                            Continue
                        </Button>
                    )}

                    {payload.behavior === 'link' && (
                        <a
                            href={destination}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-canvas hover:opacity-90"
                        >
                            {payload.linkLabel?.trim() || 'Open secure link'}
                        </a>
                    )}
                </div>
            </div>
        </main>
    );
}
