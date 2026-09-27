import type { RedirectBehavior } from '../lib/securePayload';
import Editor from './Editor';
import { inputClassName } from './Input';

export interface RedirectDraft {
    url: string;
    messageHtml: string;
    behavior: RedirectBehavior;
    delaySeconds: number;
    linkLabel: string;
}

interface RedirectComposerProps {
    value: RedirectDraft;
    onChange: (value: RedirectDraft) => void;
}

export function RedirectComposer({ value, onChange }: RedirectComposerProps) {
    const update = (patch: Partial<RedirectDraft>) => onChange({ ...value, ...patch });

    return (
        <div className="grid gap-4 p-4.5">
            <label className="grid gap-1.5">
                <span className="text-ui text-muted">Destination URL</span>
                <input
                    type="url"
                    value={value.url}
                    onChange={(event) => update({ url: event.target.value })}
                    placeholder="https://example.com/secure-checkout"
                    className={inputClassName({ mono: true })}
                    autoComplete="url"
                    spellCheck={false}
                />
            </label>

            <div className="grid gap-1.5">
                <span className="text-ui text-muted">Optional message / content</span>
                <div className="border border-line rounded-md overflow-hidden">
                    <Editor
                        value={value.messageHtml}
                        onChange={(messageHtml) => update({ messageHtml })}
                        placeholder="Optional instructions shown before the redirect or beside the link."
                    />
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <label className="grid gap-1.5">
                    <span className="text-ui text-muted">Behavior</span>
                    <select
                        value={value.behavior}
                        onChange={(event) =>
                            update({ behavior: event.target.value as RedirectBehavior })
                        }
                        className={inputClassName()}
                    >
                        <option value="immediate">Redirect immediately</option>
                        <option value="delay">Show message, then redirect</option>
                        <option value="confirm">Show message + Continue button</option>
                        <option value="link">Show content + clickable link</option>
                    </select>
                </label>

                {value.behavior === 'delay' && (
                    <label className="grid gap-1.5">
                        <span className="text-ui text-muted">Delay (seconds)</span>
                        <input
                            type="number"
                            min={1}
                            max={300}
                            value={value.delaySeconds}
                            onChange={(event) =>
                                update({
                                    delaySeconds: Math.min(
                                        300,
                                        Math.max(1, Number(event.target.value) || 1)
                                    ),
                                })
                            }
                            className={inputClassName({ mono: true })}
                        />
                    </label>
                )}
            </div>

            {value.behavior === 'link' && (
                <label className="grid gap-1.5">
                    <span className="text-ui text-muted">Link label</span>
                    <input
                        type="text"
                        value={value.linkLabel}
                        onChange={(event) => update({ linkLabel: event.target.value })}
                        placeholder="Open secure link"
                        className={inputClassName()}
                    />
                </label>
            )}

            <p className="m-0 text-xs text-muted">
                The destination and message are encrypted in the browser. The server stores
                ciphertext, just like a normal Hemmelig secret.
            </p>
        </div>
    );
}
