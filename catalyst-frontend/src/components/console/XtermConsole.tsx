import { useEffect, useMemo, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

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

  const getTerminalTheme = () => {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark
      ? {
          background: '#050914',
          foreground: '#e8edf7',
          selectionBackground: '#1b2240',
        }
      : {
          background: '#f8fafc',
          foreground: '#0f172a',
          selectionBackground: '#e2e8f0',
        };
  };

  useEffect(() => {
    let active = true;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      theme: getTerminalTheme(),
      scrollback: 2000,
    });
    const fitAddon = new FitAddon();
    let resize: (() => void) | null = null;

    if (!containerRef.current) return;
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    resize = () => fitAddon.fit();
    window.addEventListener('resize', resize);
    terminal.focus();
    const initialEntries = entriesRef.current;
    if (initialEntries.length) {
      initialEntries.forEach((entry) => writeEntry(terminal, entry));
      terminal.scrollToBottom();
      lastEntryIdRef.current = initialEntries[initialEntries.length - 1]?.id ?? null;
    }
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      active = false;
      if (resize) {
        window.removeEventListener('resize', resize);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const observer = new MutationObserver(() => {
      terminal.setOption('theme', getTerminalTheme());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
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
    () =>
      'h-[60vh] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950',
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
