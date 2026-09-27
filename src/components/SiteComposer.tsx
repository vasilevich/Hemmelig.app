import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { prepareFolderProject, prepareZipProject, type PreparedProject } from '../lib/siteBundle';
import { useUserStore } from '../store/userStore';
import Editor from './Editor';
import { inputClassName } from './Input';

export type SiteSourceMode = 'single' | 'bundle';

export interface SiteDraft {
    source: SiteSourceMode;
    bodyHtml: string;
    css: string;
    javascript: string;
    archive: Uint8Array | null;
    entry: string;
    display: 'site-only' | 'wrapped';
    projectName: string;
    fileCount: number;
    uncompressedBytes: number;
    paths: string[];
}

interface SiteComposerProps {
    value: SiteDraft;
    onChange: (value: SiteDraft) => void;
}

const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export function SiteComposer({ value, onChange }: SiteComposerProps) {
    const user = useUserStore((state) => state.user);
    const folderInput = useRef<HTMLInputElement>(null);
    const [isPreparing, setIsPreparing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const update = (patch: Partial<SiteDraft>) => onChange({ ...value, ...patch });

    useEffect(() => {
        folderInput.current?.setAttribute('webkitdirectory', '');
        folderInput.current?.setAttribute('directory', '');
    }, []);

    if (!user) {
        return (
            <div className="p-5 grid gap-3">
                <div className="font-medium">Mini-sites require an account</div>
                <p className="m-0 text-sm text-muted max-w-2xl">
                    Project bundles use Hemmelig's existing encrypted file upload storage, which is
                    already protected behind sign-in.
                </p>
                <Link
                    to="/login"
                    className="w-fit inline-flex items-center rounded-md border border-line px-3 py-2 text-sm hover:bg-raised"
                >
                    Sign in to create a mini-site
                </Link>
            </div>
        );
    }

    const applyPreparedProject = (project: PreparedProject, projectName: string) => {
        update({
            source: 'bundle',
            archive: project.archive,
            entry: project.entry,
            projectName,
            fileCount: project.fileCount,
            uncompressedBytes: project.uncompressedBytes,
            paths: project.paths,
        });
    };

    const handleZip = async (file: File) => {
        setIsPreparing(true);
        setError(null);
        try {
            applyPreparedProject(await prepareZipProject(file), file.name.replace(/\.zip$/i, ''));
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not read project ZIP.');
        } finally {
            setIsPreparing(false);
        }
    };

    const handleFolder = async (files: FileList) => {
        setIsPreparing(true);
        setError(null);
        try {
            const first = files[0] as (File & { webkitRelativePath?: string }) | undefined;
            const folderName = first?.webkitRelativePath?.split('/')[0] || 'project';
            applyPreparedProject(await prepareFolderProject(files), folderName);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not read project folder.');
        } finally {
            setIsPreparing(false);
        }
    };

    const htmlEntries = value.paths.filter((path) => /\.html?$/i.test(path));

    return (
        <div className="grid gap-4 p-4.5">
            <div className="flex gap-1 border-b border-line-soft pb-3">
                <button
                    type="button"
                    onClick={() => update({ source: 'single' })}
                    className={`px-3 py-1.5 rounded-sm text-sm ${value.source === 'single' ? 'bg-accent text-canvas' : 'text-muted hover:bg-raised'}`}
                >
                    Single page
                </button>
                <button
                    type="button"
                    onClick={() => update({ source: 'bundle' })}
                    className={`px-3 py-1.5 rounded-sm text-sm ${value.source === 'bundle' ? 'bg-accent text-canvas' : 'text-muted hover:bg-raised'}`}
                >
                    ZIP / project folder
                </button>
            </div>

            <label className="grid gap-1.5">
                <span className="text-ui text-muted">Project name (encrypted)</span>
                <input
                    type="text"
                    value={value.projectName}
                    onChange={(event) => update({ projectName: event.target.value })}
                    placeholder="Temporary checkout demo"
                    className={inputClassName()}
                />
            </label>

            {value.source === 'single' ? (
                <>
                    <div className="grid gap-1.5">
                        <span className="text-ui text-muted">Page content (WYSIWYG)</span>
                        <div className="border border-line rounded-md overflow-hidden">
                            <Editor
                                value={value.bodyHtml}
                                onChange={(bodyHtml) => update({ bodyHtml })}
                                placeholder="Build the temporary page here."
                            />
                        </div>
                    </div>

                    <label className="grid gap-1.5">
                        <span className="text-ui text-muted">CSS</span>
                        <textarea
                            value={value.css}
                            onChange={(event) => update({ css: event.target.value })}
                            placeholder="body { margin: 0; font-family: sans-serif; }"
                            spellCheck={false}
                            rows={7}
                            className={inputClassName({ mono: true, className: 'resize-y' })}
                        />
                    </label>

                    <label className="grid gap-1.5">
                        <span className="text-ui text-muted">JavaScript</span>
                        <textarea
                            value={value.javascript}
                            onChange={(event) => update({ javascript: event.target.value })}
                            placeholder="// Runs inside the opaque-origin sandbox."
                            spellCheck={false}
                            rows={7}
                            className={inputClassName({ mono: true, className: 'resize-y' })}
                        />
                    </label>
                </>
            ) : (
                <>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <label className="cursor-pointer border border-dashed border-line rounded-md p-5 text-center hover:bg-raised">
                            <span className="block font-medium">Upload ZIP</span>
                            <span className="block text-xs text-muted mt-1">
                                The project is normalized, compressed, then encrypted.
                            </span>
                            <input
                                type="file"
                                accept=".zip,application/zip"
                                className="sr-only"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void handleZip(file);
                                    event.currentTarget.value = '';
                                }}
                            />
                        </label>

                        <label className="cursor-pointer border border-dashed border-line rounded-md p-5 text-center hover:bg-raised">
                            <span className="block font-medium">Select project folder</span>
                            <span className="block text-xs text-muted mt-1">
                                Folder contents are zipped locally in the browser.
                            </span>
                            <input
                                ref={folderInput}
                                type="file"
                                multiple
                                className="sr-only"
                                onChange={(event) => {
                                    if (event.target.files?.length)
                                        void handleFolder(event.target.files);
                                    event.currentTarget.value = '';
                                }}
                            />
                        </label>
                    </div>

                    {isPreparing && <p className="m-0 text-sm text-muted">Preparing project…</p>}
                    {error && <p className="m-0 text-sm text-danger">{error}</p>}

                    {value.archive && (
                        <div className="border border-line-soft rounded-md p-3 grid gap-2">
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                <span>{value.fileCount} files</span>
                                <span className="text-muted">
                                    {formatBytes(value.uncompressedBytes)} unpacked
                                </span>
                                <span className="text-muted">
                                    {formatBytes(value.archive.byteLength)} zipped
                                </span>
                            </div>

                            <label className="grid gap-1">
                                <span className="text-xs text-muted">Entry page</span>
                                <select
                                    value={value.entry}
                                    onChange={(event) => update({ entry: event.target.value })}
                                    className={inputClassName({ mono: true })}
                                >
                                    {htmlEntries.map((path) => (
                                        <option key={path} value={path}>
                                            {path}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    )}
                </>
            )}

            <label className="grid gap-1.5">
                <span className="text-ui text-muted">Recipient display</span>
                <select
                    value={value.display}
                    onChange={(event) =>
                        update({ display: event.target.value as SiteDraft['display'] })
                    }
                    className={inputClassName()}
                >
                    <option value="site-only">Demo only (hide Hemmelig UI after unlock)</option>
                    <option value="wrapped">Demo inside Hemmelig wrapper</option>
                </select>
            </label>

            <p className="m-0 text-xs text-muted">
                The whole project becomes one encrypted ZIP attachment. It is downloaded, decrypted,
                extracted, and launched only in the recipient's browser.
            </p>
        </div>
    );
}
