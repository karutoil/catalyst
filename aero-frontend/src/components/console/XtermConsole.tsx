import { useEffect, useMemo, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

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
const formatForXterm = (value: string) => value.replace(/\r?\n/g, '\r\n');

function XtermConsole({ entries }: XtermConsoleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastEntryCount = useRef(0);
  const openRafRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      theme: {
        background: '#020617',
        foreground: '#e2e8f0',
        selectionBackground: '#1e293b',
      },
      scrollback: 2000,
    });
    const fitAddon = new FitAddon();
    const linkAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(linkAddon);

    openRafRef.current = window.requestAnimationFrame(() => {
      if (!containerRef.current) return;
      terminal.open(containerRef.current);
      fitAddon.fit();
      terminal.focus();
    });

    const resize = () => fitAddon.fit();
    window.addEventListener('resize', resize);

    if (containerRef.current && 'ResizeObserver' in window) {
      resizeObserverRef.current = new ResizeObserver(() => fitAddon.fit());
      resizeObserverRef.current.observe(containerRef.current);
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      window.removeEventListener('resize', resize);
      if (openRafRef.current !== null) {
        window.cancelAnimationFrame(openRafRef.current);
        openRafRef.current = null;
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const writeEntry = (terminal: Terminal, entry: ConsoleEntry) => {
    const color = streamColors[entry.stream] ?? '';
    const prefix = entry.stream && entry.stream !== 'stdin' ? `[${entry.stream}] ` : '';
    const message = formatForXterm(ensureLineEnding(`${prefix}${entry.data}`));
    if (color) {
      terminal.write(`${color}${message}\x1b[0m`);
    } else {
      terminal.write(message);
    }
  };

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (entries.length < lastEntryCount.current) {
      terminal.reset();
      lastEntryCount.current = 0;
    }

    const nextEntries = entries.slice(lastEntryCount.current);
    nextEntries.forEach((entry) => writeEntry(terminal, entry));
    if (nextEntries.length) {
      terminal.scrollToBottom();
    }
    lastEntryCount.current = entries.length;
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
