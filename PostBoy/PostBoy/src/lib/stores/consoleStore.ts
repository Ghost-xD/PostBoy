import { writable } from 'svelte/store';

export type LogType = 'info' | 'warn' | 'error' | 'debug' | 'system';

export interface LogEntry {
  timestamp: string;
  type: LogType;
  message: string;
}

export const logs = writable<LogEntry[]>([]);

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

export function addLog(message: string, type: LogType = 'info') {
  logs.update(current => [
    ...current,
    {
      timestamp: formatTimestamp(),
      type,
      message
    }
  ]);
}

export function clearLogs() {
  logs.set([]);
  addLog('Console cleared', 'system');
}

export function formatLogLine(entry: LogEntry): string {
  const prefix = entry.type === 'system' ? '⚙' : 
                 entry.type === 'error' ? '✗' :
                 entry.type === 'warn' ? '⚠' :
                 entry.type === 'debug' ? '🔍' : '•';
  return `[${entry.timestamp}] ${prefix} ${entry.message}`;
}
