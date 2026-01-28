import { useMemo } from 'react';
import Editor from '@monaco-editor/react';

type FileDraft = {
  path: string;
  name: string;
  content: string;
  originalContent: string;
};

type Props = {
  file: FileDraft | null;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  isSuspended?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onDownload?: () => void;
  onReset: () => void;
  onClose: () => void;
  height?: string;
};

const resolveLanguage = (fileName: string) => {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'json':
      return 'json';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'js':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'sh':
      return 'shell';
    case 'properties':
      return 'ini';
    case 'toml':
      return 'toml';
    default:
      return 'plaintext';
  }
};

function FileEditor({
  file,
  isLoading,
  isSaving,
  isDirty,
  isSuspended = false,
  onChange,
  onSave,
  onDownload,
  onReset,
  onClose,
  height = '360px',
}: Props) {
  const language = useMemo(() => (file ? resolveLanguage(file.name) : 'plaintext'), [file]);

  if (!file) {
    return null;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">{file.name}</div>
          <div className="text-xs text-slate-500">{file.path}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isDirty ? <span className="text-amber-300">Unsaved changes</span> : null}
          {isSuspended ? <span className="text-rose-300">Suspended</span> : null}
          <button
            type="button"
            className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700 disabled:opacity-60"
            onClick={onReset}
            disabled={!isDirty || isSaving || isLoading || isSuspended}
          >
            Revert
          </button>
          {onDownload ? (
            <button
              type="button"
              className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700 disabled:opacity-60"
              onClick={onDownload}
              disabled={isSaving || isLoading}
            >
              Download
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
            onClick={onSave}
            disabled={!isDirty || isSaving || isLoading || isSuspended}
          >
            Save
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
        style={{ height }}
      >
        {isLoading ? (
          <div className="px-4 py-6 text-sm text-slate-400">Loading file contents...</div>
        ) : (
          <Editor
            height="100%"
            theme="vs-dark"
            language={language}
            value={file.content}
            onChange={(value) => onChange(value ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
            }}
          />
        )}
      </div>
    </div>
  );
}

export default FileEditor;
