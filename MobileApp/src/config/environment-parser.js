const DEVELOPMENT_API_BASE_URL = 'http://localhost:8000';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseEnvironment(rawApiBaseUrl, options = {}) {
  const isDevelopment = options.isDevelopment ?? false;
  const candidate = rawApiBaseUrl?.trim() || (isDevelopment ? DEVELOPMENT_API_BASE_URL : '');

  if (!candidate) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is required outside development.');
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be a valid absolute URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use HTTP or HTTPS.');
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be an origin without credentials or a path.');
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !isDevelopment && !isLoopback) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use HTTPS outside development or localhost.');
  }

  const normalizedUrl = url.toString().replace(/\/$/, '');
  return Object.freeze({ apiBaseUrl: normalizedUrl });
}

module.exports = { parseEnvironment };
