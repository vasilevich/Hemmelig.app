import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import {
    bytesToHex,
    derivePasswordVerifier,
    encrypt,
    encryptFile,
    generateEncryptionKey,
    generateSalt,
} from '../lib/crypto';
import {
    createRedirectPayload,
    createSitePayload,
    isSafeRedirectUrl,
    serializeSecurePayload,
} from '../lib/securePayload';
import { prepareSinglePageProject } from '../lib/siteBundle';
import { uploadEncryptedFile } from '../lib/upload';
import { useHemmeligStore } from '../store/hemmeligStore';
import { useSecretStore } from '../store/secretStore';
import { useUserStore } from '../store/userStore';
import { Button } from './Button';
import Editor from './Editor';
import { AttachmentRow, useAttachments } from './FileUpload';
import { Modal } from './Modal';
import { RedirectComposer, type RedirectDraft } from './RedirectComposer';
import { EXPIRATION_OPTIONS, MIN_PASSWORD_LENGTH, SecuritySettings } from './SecuritySettings';
import { SiteComposer, type SiteDraft } from './SiteComposer';

type ComposerMode = 'content' | 'redirect' | 'site';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

const initialRedirectDraft: RedirectDraft = {
    url: '',
    messageHtml: '',
    behavior: 'confirm',
    delaySeconds: 3,
    linkLabel: 'Open secure link',
};

const initialSiteDraft: SiteDraft = {
    source: 'single',
    bodyHtml: '',
    css: '',
    javascript: '',
    archive: null,
    entry: 'index.html',
    display: 'site-only',
    projectName: '',
    fileCount: 0,
    uncompressedBytes: 0,
    paths: [],
};

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer =>
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.slice().buffer as ArrayBuffer);

export function SecretForm() {
    const {
        secret,
        title,
        password,
        expiresAt,
        views,
        isBurnable,
        ipRange,
        setSecretIdAndKeys,
        setSecretData,
    } = useSecretStore();
    const { settings } = useHemmeligStore();
    const user = useUserStore((state) => state.user);
    const { t } = useTranslation();

    const [mode, setMode] = useState<ComposerMode>('content');
    const [redirectDraft, setRedirectDraft] = useState<RedirectDraft>(initialRedirectDraft);
    const [siteDraft, setSiteDraft] = useState<SiteDraft>(initialSiteDraft);
    const [isLoading, setIsLoading] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const [showOptions, setShowOptions] = useState(true);
    const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const attachments = useAttachments(setFiles);

    const passwordInvalid = password !== null && password.length < MIN_PASSWORD_LENGTH;
    const hasSiteSource =
        siteDraft.source === 'single'
            ? Boolean(
                  siteDraft.bodyHtml.trim() || siteDraft.css.trim() || siteDraft.javascript.trim()
              )
            : Boolean(siteDraft.archive);

    const modeValid =
        mode === 'content'
            ? secret.trim().length > 0
            : mode === 'redirect'
              ? isSafeRedirectUrl(redirectDraft.url)
              : Boolean(user && hasSiteSource);

    const isFormValid = modeValid && !passwordInvalid;

    const uploadBytes = async (
        bytes: ArrayBuffer,
        filename: string,
        encryptionKey: string,
        salt: string
    ) => {
        const encryptedFile = await encryptFile(bytes, encryptionKey, salt);
        return uploadEncryptedFile(
            encryptedFile,
            bytesToHex(await encrypt(filename, encryptionKey, salt))
        );
    };

    const handleSubmit = async () => {
        if (!isFormValid || isLoading) return;
        setIsLoading(true);

        const secretPassword = password || null;
        const encryptionKey = generateEncryptionKey(secretPassword ?? undefined);
        const salt = generateSalt();
        const attachedFiles: { id: string; token: string }[] = [];
        let plaintextPayload = secret;

        try {
            if (mode === 'content') {
                if (files.length > 0) {
                    for (const file of files) {
                        try {
                            attachedFiles.push(
                                await uploadBytes(
                                    await file.arrayBuffer(),
                                    file.name,
                                    encryptionKey,
                                    salt
                                )
                            );
                        } catch (error) {
                            setErrorMessage(
                                t('secret_form.failed_to_upload_file', { fileName: file.name })
                            );
                            setIsErrorModalOpen(true);
                            console.error('File upload failed:', error);
                            return;
                        }
                    }
                }
            } else if (mode === 'redirect') {
                plaintextPayload = serializeSecurePayload(
                    createRedirectPayload({
                        url: redirectDraft.url.trim(),
                        messageHtml: redirectDraft.messageHtml || undefined,
                        behavior: redirectDraft.behavior,
                        delaySeconds:
                            redirectDraft.behavior === 'delay'
                                ? Math.max(1, redirectDraft.delaySeconds)
                                : undefined,
                        linkLabel:
                            redirectDraft.behavior === 'link'
                                ? redirectDraft.linkLabel.trim() || 'Open secure link'
                                : undefined,
                    })
                );
            } else {
                if (!user) {
                    throw new Error('Sign in before uploading an encrypted mini-site.');
                }

                const prepared =
                    siteDraft.source === 'single'
                        ? prepareSinglePageProject(
                              siteDraft.bodyHtml,
                              siteDraft.css,
                              siteDraft.javascript
                          )
                        : siteDraft.archive
                          ? {
                                archive: siteDraft.archive,
                                entry: siteDraft.entry,
                            }
                          : null;

                if (!prepared) {
                    throw new Error('Choose a project ZIP/folder or create a single-page demo.');
                }

                const uploaded = await uploadBytes(
                    arrayBufferOf(prepared.archive),
                    'project.bundle',
                    encryptionKey,
                    salt
                );
                attachedFiles.push(uploaded);

                plaintextPayload = serializeSecurePayload(
                    createSitePayload({
                        bundleFileId: uploaded.id,
                        entry: prepared.entry,
                        display: siteDraft.display,
                        projectName: siteDraft.projectName.trim() || undefined,
                    })
                );
            }

            const encryptedSecret = await encrypt(plaintextPayload, encryptionKey, salt);
            const encryptedTitle = await encrypt(title, encryptionKey, salt);

            const passwordVerifier = secretPassword
                ? await derivePasswordVerifier(secretPassword, salt)
                : undefined;

            const dataToSend = {
                secret: encryptedSecret,
                title: encryptedTitle,
                salt,
                passwordVerifier,
                expiresAt,
                views: isBurnable ? null : views,
                isBurnable: false,
                ipRange: ipRange === '' ? null : ipRange,
                files: attachedFiles,
            };

            const response = await api.secrets.$post({ json: dataToSend });
            const data = await response.json();

            if (response.ok && data?.id) {
                setSecretData({ fileCount: attachedFiles.length });
                const deleteToken =
                    'deleteToken' in data && typeof data.deleteToken === 'string'
                        ? data.deleteToken
                        : null;
                setSecretIdAndKeys(data.id, encryptionKey, secretPassword, deleteToken);
            } else {
                const creationError =
                    data?.error?.issues?.[0]?.message ||
                    data?.error?.message ||
                    'An unknown error occurred.';
                setErrorMessage(
                    t('secret_form.failed_to_create_secret', { errorMessage: creationError })
                );
                setIsErrorModalOpen(true);
            }
        } catch (error: unknown) {
            const creationError =
                error instanceof Error ? error.message : 'An unknown error occurred.';
            setErrorMessage(
                t('secret_form.failed_to_create_secret', { errorMessage: creationError })
            );
            setIsErrorModalOpen(true);
            console.error('Failed to create secret:', creationError);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            void handleSubmit();
        }
    };

    const expiration = EXPIRATION_OPTIONS.find((option) => option.value === expiresAt);
    const summary = [
        mode === 'redirect' ? 'redirect' : mode === 'site' ? 'mini-site' : null,
        expiration
            ? t(`expiration.${expiration.key}`)
            : t('expiration.default_hours', { hours: Math.round(expiresAt / 3600) }),
        isBurnable
            ? t('composer.summary.burn_after_time')
            : t('composer.summary.views', { count: views }),
        password ? t('composer.summary.password') : null,
        ipRange ? t('composer.summary.ip', { range: ipRange }) : null,
        mode === 'content' && files.length
            ? t('composer.summary.files', { count: files.length })
            : null,
        mode === 'site' && siteDraft.source === 'bundle' && siteDraft.fileCount
            ? `${siteDraft.fileCount} project files`
            : null,
    ]
        .filter(Boolean)
        .join(' · ');

    const tabClass = (tab: ComposerMode) =>
        `px-3 py-2 text-sm rounded-sm transition-colors ${
            mode === tab ? 'bg-accent text-canvas' : 'text-muted hover:text-fg hover:bg-raised'
        }`;

    return (
        <div className="grid gap-4" onKeyDownCapture={handleKeyDown}>
            <div className="flex gap-1" role="tablist" aria-label="Secret type">
                <button
                    type="button"
                    className={tabClass('content')}
                    onClick={() => setMode('content')}
                >
                    Content
                </button>
                <button
                    type="button"
                    className={tabClass('redirect')}
                    onClick={() => setMode('redirect')}
                >
                    Redirect URL
                </button>
                <button type="button" className={tabClass('site')} onClick={() => setMode('site')}>
                    Mini-site
                </button>
            </div>

            <div
                {...(mode === 'content' ? attachments.getRootProps() : {})}
                className={`border rounded-md bg-surface overflow-hidden transition-colors ${
                    mode === 'content' && attachments.isDragActive ? 'border-accent' : 'border-line'
                }`}
            >
                {mode === 'content' && <input {...attachments.getInputProps()} />}

                <input
                    type="text"
                    value={title}
                    onChange={(event) => setSecretData({ title: event.target.value })}
                    placeholder={t('composer.title_placeholder')}
                    aria-label={t('title_field.placeholder')}
                    className="w-full bg-transparent border-0 border-b border-line-soft px-4.5 py-3.5 text-sm text-fg placeholder:text-faint outline-none"
                />

                {mode === 'content' && (
                    <>
                        <Editor
                            value={secret}
                            onChange={(value) => setSecretData({ secret: value })}
                            placeholder={t('composer.placeholder')}
                        />
                        {settings.allowFileUploads !== false && (
                            <AttachmentRow attachments={attachments} />
                        )}
                    </>
                )}

                {mode === 'redirect' && (
                    <RedirectComposer value={redirectDraft} onChange={setRedirectDraft} />
                )}

                {mode === 'site' && <SiteComposer value={siteDraft} onChange={setSiteDraft} />}

                <div className="flex flex-wrap items-center gap-2.5 py-2.5 pl-4.5 pr-3 border-t border-line-soft">
                    <span className="flex-1 min-w-50 font-mono text-xs text-muted">{summary}</span>
                    <Button
                        variant="secondary"
                        onClick={() => setShowOptions(!showOptions)}
                        aria-expanded={showOptions}
                    >
                        {showOptions ? t('composer.options_hide') : t('composer.options_show')}
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => void handleSubmit()}
                        loading={isLoading}
                        disabled={!isFormValid}
                        title={t('composer.shortcut_hint', { shortcut: isMac ? '⌘↵' : 'Ctrl+↵' })}
                    >
                        {isLoading ? (
                            t('create_button.creating_secret')
                        ) : (
                            <>
                                {t('composer.create_link')}
                                <span className="hidden opacity-70 pointer-fine:inline">
                                    {isMac ? '⌘↵' : 'Ctrl ↵'}
                                </span>
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {showOptions && <SecuritySettings />}

            <Modal
                isOpen={isErrorModalOpen}
                onClose={() => setIsErrorModalOpen(false)}
                title={t('common.error')}
                confirmText={t('common.ok')}
                confirmVariant="primary"
                onConfirm={() => setIsErrorModalOpen(false)}
            >
                <p>{errorMessage}</p>
            </Modal>
        </div>
    );
}
