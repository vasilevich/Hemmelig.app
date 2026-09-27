export const SECURE_PAYLOAD_MARKER = 'hemmelig.secure-payload' as const;

export type RedirectBehavior = 'immediate' | 'delay' | 'confirm' | 'link';

export interface RedirectPayload {
    marker: typeof SECURE_PAYLOAD_MARKER;
    version: 1;
    type: 'redirect';
    url: string;
    messageHtml?: string;
    behavior: RedirectBehavior;
    delaySeconds?: number;
    linkLabel?: string;
}

export interface SitePayload {
    marker: typeof SECURE_PAYLOAD_MARKER;
    version: 1;
    type: 'site';
    bundleFileId: string;
    entry: string;
    display: 'site-only' | 'wrapped';
    projectName?: string;
}

export type SecurePayload = RedirectPayload | SitePayload;

export type DecodedSecretPayload =
    | { type: 'content'; content: string }
    | RedirectPayload
    | SitePayload;

export const serializeSecurePayload = (payload: SecurePayload): string => JSON.stringify(payload);

export const createRedirectPayload = (
    data: Omit<RedirectPayload, 'marker' | 'version' | 'type'>
): RedirectPayload => ({
    marker: SECURE_PAYLOAD_MARKER,
    version: 1,
    type: 'redirect',
    ...data,
});

export const createSitePayload = (
    data: Omit<SitePayload, 'marker' | 'version' | 'type'>
): SitePayload => ({
    marker: SECURE_PAYLOAD_MARKER,
    version: 1,
    type: 'site',
    ...data,
});

export const parseSecurePayload = (plaintext: string): DecodedSecretPayload => {
    try {
        const parsed = JSON.parse(plaintext) as Partial<SecurePayload> | null;

        if (
            !parsed ||
            parsed.marker !== SECURE_PAYLOAD_MARKER ||
            parsed.version !== 1 ||
            typeof parsed.type !== 'string'
        ) {
            return { type: 'content', content: plaintext };
        }

        if (
            parsed.type === 'redirect' &&
            typeof parsed.url === 'string' &&
            typeof parsed.behavior === 'string' &&
            ['immediate', 'delay', 'confirm', 'link'].includes(parsed.behavior)
        ) {
            return parsed as RedirectPayload;
        }

        if (
            parsed.type === 'site' &&
            typeof parsed.bundleFileId === 'string' &&
            typeof parsed.entry === 'string' &&
            (parsed.display === 'site-only' || parsed.display === 'wrapped')
        ) {
            return parsed as SitePayload;
        }
    } catch {
        // Normal secrets are arbitrary text and can look like malformed JSON.
    }

    return { type: 'content', content: plaintext };
};

export const isSafeRedirectUrl = (value: string): boolean => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
};
