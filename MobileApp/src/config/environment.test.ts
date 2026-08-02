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

  it('allows HTTP only when development is explicit', () => {
    expect(parseEnvironment('http://localhost:8000', { isDevelopment: true }).apiBaseUrl).toBe(
      'http://localhost:8000',
    );
    expect(parseEnvironment('http://192.168.1.20:8000', { isDevelopment: true }).apiBaseUrl).toBe(
      'http://192.168.1.20:8000',
    );
  });

  it.each([
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://[::1]:8000',
    'http://hr.example.com',
  ])('rejects HTTP in release mode: %s', (apiBaseUrl) => {
    expect(() => parseEnvironment(apiBaseUrl)).toThrow('must use HTTPS outside development');
  });

  it('rejects an unbracketed IPv6 HTTP URL in release mode', () => {
    expect(() => parseEnvironment('http://::1')).toThrow('must be a valid absolute URL');
  });

  it('allows HTTPS in release', () => {
    expect(parseEnvironment('https://hr.example.com').apiBaseUrl).toBe('https://hr.example.com');
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

  it('rejects malformed URLs', () => {
    expect(() => parseEnvironment('not-an-origin')).toThrow('must be a valid absolute URL');
  });
});
