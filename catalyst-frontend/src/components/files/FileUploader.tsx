import { useRef, useState } from 'react';

type Props = {
  path: string;
  isUploading: boolean;
  onUpload: (files: File[]) => void;
  onClose: () => void;
};

function FileUploader({ path, isUploading, onUpload, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    onUpload(Array.from(files));
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-slate-900 dark:text-white">Upload files</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">Target: {path}</div>
        </div>
        <button
          type="button"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div
        className={`mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-all duration-300 ${
          isDragActive
            ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
            : 'border-slate-300 text-slate-500 dark:text-slate-400 dark:border-slate-700 dark:text-slate-400'
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragActive(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <div className="text-sm font-semibold">Drag files here</div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">or select from your device</div>
        <div className="mt-4 flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
          <button
            type="button"
            className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            Choose files
          </button>
          {isUploading ? <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">Uploading...</span> : null}
        </div>
      </div>
    </div>
  );
}

export default FileUploader;
