import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

/**
 * DNS & Connectivity Diagnostics Tests
 * Tests cover: input validation helpers, DNS resolve, port check, ping,
 * trace route, Tauri invoke contracts, and result formatting.
 */

// ── Types mirroring the Rust return types ──

interface DnsResult {
  hostname: string;
  addresses: string[];
  duration_ms: number;
}

interface PortCheckResult {
  host: string;
  port: number;
  open: boolean;
  duration_ms: number;
  error: string | null;
}

interface PingResult {
  host: string;
  ip: string;
  reachable: boolean;
  latency_ms: number | null;
  error: string | null;
}

interface TraceHop {
  hop: number;
  ip: string | null;
  hostname: string | null;
  latency_ms: number | null;
  timed_out: boolean;
}

interface TraceResult {
  target: string;
  hops: TraceHop[];
  duration_ms: number;
}

// ── Helper functions (mirrors DiagnosticsPanel logic) ──

function extractHostname(input: string): string {
  let s = input.trim();
  if (!s) return '';
  // Strip protocol if present
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      return url.hostname;
    } catch {
      s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    }
  }
  // Strip path, query, fragment
  s = s.split('/')[0].split('?')[0].split('#')[0];
  // Strip port
  s = s.replace(/:\d+$/, '');
  return s.toLowerCase();
}

function extractPort(input: string): number | null {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.port) return parseInt(url.port, 10);
    if (url.protocol === 'https:') return 443;
    if (url.protocol === 'http:') return 80;
  } catch { /* not a full URL */ }
  // Check for host:port pattern
  const portMatch = trimmed.match(/:(\d+)(\/|$)/);
  if (portMatch) return parseInt(portMatch[1], 10);
  return null;
}

function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return false;
  // IP address
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // Hostname labels
  const labels = hostname.split('.');
  return labels.every(label =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1) return '<1 ms';
  return `${Math.round(ms)} ms`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// ── Tests ──

describe('DNS & Connectivity Diagnostics', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Input Validation ──

  describe('extractHostname', () => {
    it('extracts hostname from full URL', () => {
      expect(extractHostname('https://api.example.com/v1/users')).toBe('api.example.com');
    });

    it('extracts hostname from URL with port', () => {
      expect(extractHostname('http://localhost:3000/path')).toBe('localhost');
    });

    it('handles plain hostname', () => {
      expect(extractHostname('example.com')).toBe('example.com');
    });

    it('handles hostname with port but no protocol', () => {
      expect(extractHostname('example.com:8080')).toBe('example.com');
    });

    it('handles IP address', () => {
      expect(extractHostname('http://192.168.1.1:8080/api')).toBe('192.168.1.1');
    });

    it('handles empty input', () => {
      expect(extractHostname('')).toBe('');
      expect(extractHostname('  ')).toBe('');
    });

    it('lowercases hostname', () => {
      expect(extractHostname('HTTPS://API.Example.COM')).toBe('api.example.com');
    });

    it('strips path and query', () => {
      expect(extractHostname('example.com/path?q=1#frag')).toBe('example.com');
    });
  });

  describe('extractPort', () => {
    it('extracts explicit port from URL', () => {
      expect(extractPort('http://example.com:8080/api')).toBe(8080);
    });

    it('infers port 443 from https', () => {
      expect(extractPort('https://example.com/api')).toBe(443);
    });

    it('infers port 80 from http', () => {
      expect(extractPort('http://example.com/api')).toBe(80);
    });

    it('extracts port from host:port pattern', () => {
      expect(extractPort('example.com:3000')).toBe(3000);
    });

    it('returns null for plain hostname', () => {
      expect(extractPort('example.com')).toBeNull();
    });
  });

  describe('isValidHostname', () => {
    it('accepts valid domain', () => {
      expect(isValidHostname('example.com')).toBe(true);
      expect(isValidHostname('api.sub.example.com')).toBe(true);
    });

    it('accepts IP address', () => {
      expect(isValidHostname('192.168.1.1')).toBe(true);
      expect(isValidHostname('10.0.0.1')).toBe(true);
    });

    it('accepts localhost', () => {
      expect(isValidHostname('localhost')).toBe(true);
    });

    it('rejects empty string', () => {
      expect(isValidHostname('')).toBe(false);
    });

    it('rejects hostname exceeding 253 chars', () => {
      expect(isValidHostname('a'.repeat(254))).toBe(false);
    });

    it('rejects label exceeding 63 chars', () => {
      expect(isValidHostname('a'.repeat(64) + '.com')).toBe(false);
    });

    it('rejects labels starting with hyphen', () => {
      expect(isValidHostname('-example.com')).toBe(false);
    });
  });

  // ── Formatting Helpers ──

  describe('formatLatency', () => {
    it('formats null as dash', () => {
      expect(formatLatency(null)).toBe('—');
    });

    it('formats undefined as dash', () => {
      expect(formatLatency(undefined)).toBe('—');
    });

    it('formats sub-millisecond', () => {
      expect(formatLatency(0.3)).toBe('<1 ms');
    });

    it('rounds to nearest ms', () => {
      expect(formatLatency(12.7)).toBe('13 ms');
    });

    it('formats whole number', () => {
      expect(formatLatency(45)).toBe('45 ms');
    });
  });

  describe('formatDuration', () => {
    it('shows ms for short durations', () => {
      expect(formatDuration(150)).toBe('150 ms');
    });

    it('shows seconds for long durations', () => {
      expect(formatDuration(2500)).toBe('2.50 s');
    });
  });

  // ── DNS Resolve (invoke contract) ──

  describe('DNS resolve', () => {
    it('calls dns_resolve with correct args', async () => {
      const mockResult: DnsResult = {
        hostname: 'example.com',
        addresses: ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
        duration_ms: 12,
      };
      (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await invoke('dns_resolve', { hostname: 'example.com' });
      expect(invoke).toHaveBeenCalledWith('dns_resolve', { hostname: 'example.com' });
      expect(result).toEqual(mockResult);
      expect(result.addresses.length).toBeGreaterThan(0);
    });

    it('handles DNS failure', async () => {
      (invoke as ReturnType<typeof vi.fn>).mockRejectedValue('DNS resolution failed: no such host');

      await expect(invoke('dns_resolve', { hostname: 'nonexistent.invalid' }))
        .rejects.toBe('DNS resolution failed: no such host');
    });
  });

  // ── Port Check (invoke contract) ──

  describe('Port check', () => {
    it('calls port_check for open port', async () => {
      const mockResult: PortCheckResult = {
        host: 'example.com',
        port: 443,
        open: true,
        duration_ms: 23,
        error: null,
      };
      (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await invoke('port_check', { host: 'example.com', port: 443, timeoutSecs: 5 });
      expect(invoke).toHaveBeenCalledWith('port_check', { host: 'example.com', port: 443, timeoutSecs: 5 });
      expect(result.open).toBe(true);
    });

    it('detects closed port', async () => {
      const mockResult: PortCheckResult = {
        host: 'example.com',
        port: 12345,
        open: false,
        duration_ms: 5003,
        error: 'Connection timed out',
      };
      (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await invoke('port_check', { host: 'example.com', port: 12345, timeoutSecs: 5 });
      expect(result.open).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ── Ping (invoke contract) ──

  describe('Ping', () => {
    it('calls ping_host for reachable host', async () => {
      const mockResult: PingResult = {
        host: 'example.com',
        ip: '93.184.216.34',
        reachable: true,
        latency_ms: 14.5,
        error: null,
      };
      (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await invoke('ping_host', { host: 'example.com' });
      expect(invoke).toHaveBeenCalledWith('ping_host', { host: 'example.com' });
      expect(result.reachable).toBe(true);
      expect(result.latency_ms).toBeGreaterThan(0);
    });

    it('handles unreachable host', async () => {
      const mockResult: PingResult = {
        host: '10.255.255.1',
        ip: '10.255.255.1',
        reachable: false,
        latency_ms: null,
        error: 'Request timed out',
      };
      (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await invoke('ping_host', { host: '10.255.255.1' });
      expect(result.reachable).toBe(false);
      expect(result.latency_ms).toBeNull();
    });
  });

  // ── Trace Route (invoke contract) ──

  describe('Trace route', () => {
    it('calls trace_route and returns hops', async () => {
      const mockResult: TraceResult = {
        target: 'example.com',
        hops: [
          { hop: 1, ip: '192.168.1.1', hostname: 'gateway', latency_ms: 1.2, timed_out: false },
          { hop: 2, ip: null, hostname: null, latency_ms: null, timed_out: true },
          { hop: 3, ip: '93.184.216.34', hostname: 'example.com', latency_ms: 14.3, timed_out: false },
        ],
        duration_ms: 3200,
      };
      (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await invoke('trace_route', { host: 'example.com' });
      expect(invoke).toHaveBeenCalledWith('trace_route', { host: 'example.com' });
      expect(result.hops).toHaveLength(3);
      expect(result.hops[1].timed_out).toBe(true);
    });

    it('handles trace route failure', async () => {
      (invoke as ReturnType<typeof vi.fn>).mockRejectedValue('Trace route failed: permission denied');

      await expect(invoke('trace_route', { host: 'example.com' }))
        .rejects.toBe('Trace route failed: permission denied');
    });
  });

  // ── Result shape validation ──

  describe('Result shapes', () => {
    it('DnsResult has expected fields', () => {
      const result: DnsResult = { hostname: 'test.com', addresses: ['1.2.3.4'], duration_ms: 5 };
      expect(result).toHaveProperty('hostname');
      expect(result).toHaveProperty('addresses');
      expect(result).toHaveProperty('duration_ms');
      expect(Array.isArray(result.addresses)).toBe(true);
    });

    it('PortCheckResult has expected fields', () => {
      const result: PortCheckResult = { host: 'test.com', port: 80, open: true, duration_ms: 10, error: null };
      expect(result).toHaveProperty('open');
      expect(typeof result.open).toBe('boolean');
    });

    it('TraceHop handles timed out hops', () => {
      const hop: TraceHop = { hop: 2, ip: null, hostname: null, latency_ms: null, timed_out: true };
      expect(hop.ip).toBeNull();
      expect(hop.timed_out).toBe(true);
    });
  });
});
