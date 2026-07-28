import { describe, expect, it } from '@jest/globals';

import { parseEnvironment } from './environment';

describe('parseEnvironment', () => {
  it('uses a loopback default only in development', () => {
    expect(parseEnvironment(undefined, { isDevelopment: true })).toEqual({
      apiBaseUrl: 'http://localhost:8000',
    });
  });

  it('normalizes a trailing slash', () => {
    expect(parseEnvironment('https://hr.example.com/')).toEqual({
      apiBaseUrl: 'https://hr.example.com',
    });
  });

  it('rejects an absent release URL', () => {
    expect(() => parseEnvironment(undefined)).toThrow('required outside development');
  });

  it('rejects insecure non-loopback release URLs', () => {
    expect(() => parseEnvironment('http://hr.example.com')).toThrow(
      'must use HTTPS outside development or localhost',
    );
  });

  it('allows HTTPS in release and HTTP loopback for local tooling', () => {
    expect(parseEnvironment('https://hr.example.com').apiBaseUrl).toBe('https://hr.example.com');
    expect(parseEnvironment('http://127.0.0.1:8000').apiBaseUrl).toBe('http://127.0.0.1:8000');
  });

  it('rejects credentials, query strings, fragments, and path prefixes', () => {
    expect(() => parseEnvironment('https://user:pass@hr.example.com')).toThrow('an origin');
    expect(() => parseEnvironment('https://hr.example.com?tenant=1')).toThrow('an origin');
    expect(() => parseEnvironment('https://hr.example.com#fragment')).toThrow('an origin');
    expect(() => parseEnvironment('https://hr.example.com/api')).toThrow('an origin');
  });

  it('rejects non-HTTP protocols', () => {
    expect(() => parseEnvironment('file:///tmp/api')).toThrow('must use HTTP or HTTPS');
  });
});
