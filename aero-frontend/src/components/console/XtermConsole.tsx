import { useEffect, useMemo, useRef } from 'react';
import { FitAddon, init, Terminal } from 'ghostty-web';
import { notifyError } from '../../utils/notify';

type ConsoleEntry = {
  id: string;
  stream: string;
  data: string;
};

type XtermConsoleProps = {
  entries: ConsoleEntry[];
};

const streamColors: Record<string, string> = {
  stdout: '\x1b[38;2;16;185;129m',
  stderr: '\x1b[38;2;244;63;94m',
  system: '\x1b[38;2;14;165;233m',
  stdin: '\x1b[38;2;245;158;11m',
};

const ensureLineEnding = (value: string) => (value.endsWith('\n') || value.endsWith('\r') ? value : `${value}\n`);
const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function XtermConsole({ entries }: XtermConsoleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastEntryIdRef = useRef<string | null>(null);
  const entriesRef = useRef(entries);
  const openRafRef = useRef<number | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const writeEntry = (terminal: Terminal, entry: ConsoleEntry) => {
    const color = streamColors[entry.stream] ?? '';
    const prefix = entry.stream && entry.stream !== 'stdin' ? `[${entry.stream}] ` : '';
    const message = ensureLineEnding(normalizeLineEndings(`${prefix}${entry.data}`));
    if (color) {
      terminal.write(`${color}${message}\x1b[0m`);
    } else {
      terminal.write(message);
    }
  };

  useEffect(() => {
    let active = true;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let resize: (() => void) | null = null;

    if (!containerRef.current) return;
    if (!initPromiseRef.current) {
      initPromiseRef.current = init();
    }

    initPromiseRef.current
      .then(() => {
        if (!active || !containerRef.current) return;
        terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          disableStdin: true,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: 12,
          theme: {
            background: '#020617',
            foreground: '#e2e8f0',
            selectionBackground: '#1e293b',
          },
          scrollback: 2000,
          smoothScrollDuration: 80,
        });
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);

        openRafRef.current = window.requestAnimationFrame(() => {
          if (!containerRef.current || !terminal || !fitAddon) return;
          terminal.open(containerRef.current);
          fitAddon.fit();
          fitAddon.observeResize();
          terminal.focus();
          const initialEntries = entriesRef.current;
          if (initialEntries.length) {
            initialEntries.forEach((entry) => writeEntry(terminal, entry));
            terminal.scrollToBottom();
            lastEntryIdRef.current = initialEntries[initialEntries.length - 1]?.id ?? null;
          }
        });

        resize = () => fitAddon?.fit();
        window.addEventListener('resize', resize);

        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
      })
      .catch((error) => {
        notifyError('Failed to initialize console terminal');
        console.error('ghostty init failed', error);
      });

    return () => {
      active = false;
      if (resize) {
        window.removeEventListener('resize', resize);
      }
      if (openRafRef.current !== null) {
        window.cancelAnimationFrame(openRafRef.current);
        openRafRef.current = null;
      }
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (entries.length === 0) {
      terminal.reset();
      lastEntryIdRef.current = null;
      return;
    }

    const lastEntryId = lastEntryIdRef.current;
    const lastIndex = lastEntryId ? entries.findIndex((entry) => entry.id === lastEntryId) : -1;
    if (lastIndex === -1) {
      terminal.reset();
      entries.forEach((entry) => writeEntry(terminal, entry));
    } else {
      const nextEntries = entries.slice(lastIndex + 1);
      nextEntries.forEach((entry) => writeEntry(terminal, entry));
    }
    if (entries.length) {
      terminal.scrollToBottom();
    }
    lastEntryIdRef.current = entries[entries.length - 1]?.id ?? null;
  }, [entries]);

  const containerClass = useMemo(
    () => 'h-[60vh] w-full rounded-lg border border-slate-800 bg-slate-950',
    [],
  );

  return (
    <div
      ref={containerRef}
      className={containerClass}
      onClick={() => terminalRef.current?.focus()}
      role="presentation"
    />
  );
}

export default XtermConsole;
