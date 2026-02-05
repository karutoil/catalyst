import { useEffect, useMemo, useRef, useState } from 'react';
import AnsiToHtml from 'ansi-to-html';

type ConsoleEntry = {
  id: string;
  stream: string;
  data: string;
  timestamp?: string;
};

type CustomConsoleProps = {
  entries: ConsoleEntry[];
  autoScroll?: boolean;
  scrollback?: number;
  searchQuery?: string;
  onUserScroll?: () => void;
};

const streamStyles: Record<string, string> = {
  stdout: 'text-emerald-500',
  stderr: 'text-rose-500',
  system: 'text-primary-500',
  stdin: 'text-amber-500',
};

const ensureLineEnding = (value: string) => (value.endsWith('\n') || value.endsWith('\r') ? value : `${value}\n`);
const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const ansiConverter = new AnsiToHtml({
  escapeXML: true,
  newline: true,
  stream: true,
});

const timestampPattern = /^\s*(?:\\x07)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s*/;
const padTwo = (value: number) => String(value).padStart(2, '0');
const formatTimestamp = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const hours = padTwo(parsed.getHours());
  const minutes = padTwo(parsed.getMinutes());
  const month = padTwo(parsed.getMonth() + 1);
  const day = padTwo(parsed.getDate());
  const year = String(parsed.getFullYear());
  return `${hours}:${minutes} - ${month}-${day}-${year}`;
};

function CustomConsole({
  entries,
  autoScroll = true,
  scrollback = 2000,
  searchQuery,
  onUserScroll,
}: CustomConsoleProps) {
  const outputRef = useRef<HTMLDivElement | null>(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set<string>());
  const programmaticScrollRef = useRef(false);

  const normalizedEntries = useMemo(() => {
    const trimmed = entries.slice(-scrollback);
    if (!searchQuery) return trimmed;
    const query = searchQuery.toLowerCase();
    return trimmed.filter((entry) => entry.data.toLowerCase().includes(query));
  }, [entries, scrollback, searchQuery]);

  useEffect(() => {
    if (!outputRef.current || !autoScroll) return;
    programmaticScrollRef.current = true;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 100);
  }, [autoScroll, normalizedEntries]);

  const handleScroll = () => {
    if (!outputRef.current || programmaticScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 24;
    if (!nearBottom && onUserScroll) {
      onUserScroll();
    }
  };

  return (
    <div
      ref={outputRef}
      onScroll={handleScroll}
      className="max-h-[60vh] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed text-slate-600 dark:text-slate-200"
    >
      {normalizedEntries.length === 0 ? (
        <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">No console output yet.</div>
      ) : (
        normalizedEntries.map((entry) => {
          const message = normalizeLineEndings(ensureLineEnding(entry.data));
          const timestampMatch = message.match(timestampPattern);
          const displayTimestamp = entry.timestamp ?? timestampMatch?.[1];
          const cleanedMessage = timestampMatch ? message.replace(timestampPattern, '') : message;
          const lines = cleanedMessage
            .split('\n')
            .filter((line, index, list) => !(index === list.length - 1 && line === ''));
            return (
              <div key={entry.id} className="flex gap-3">
                <span
                  className={`mt-[2px] min-w-[64px] text-[10px] uppercase tracking-wide ${
                    streamStyles[entry.stream] ?? 'text-slate-500 dark:text-slate-500'
                  }`}
                >
                  {entry.stream}
                </span>
                {displayTimestamp ? (
                  <span className="mt-[2px] min-w-[120px] text-xs font-mono text-slate-500 dark:text-slate-400">
                    {formatTimestamp(displayTimestamp)}
                  </span>
                ) : null}
                <div className="flex-1 space-y-0.5">
                {lines.map((line, lineIndex) => {
                  const content = ansiConverter.toHtml(line || ' ');
                  const isLong = line.length > 800;
                  const lineKey = `${entry.id}-${lineIndex}`;
                  const expanded = expandedIds.has(lineKey);
                  const display = isLong && !expanded ? line.slice(0, 800) : line;
                  return (
                    <div key={lineKey} className="space-y-1">
                      <span
                        className="whitespace-pre-wrap break-words"
                        dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(display || ' ') }}
                      />
                      {isLong ? (
                        <button
                          type="button"
                          className="text-[10px] font-semibold text-slate-500 hover:text-primary-500"
                          onClick={() =>
                            setExpandedIds((current) => {
                              const next = new Set(current);
                              if (next.has(lineKey)) {
                                next.delete(lineKey);
                              } else {
                                next.add(lineKey);
                              }
                              return next;
                            })
                          }
                        >
                          {expanded ? 'Show less' : 'Show more'}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default CustomConsole;
