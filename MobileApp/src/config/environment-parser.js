const DEVELOPMENT_API_BASE_URL = 'http://localhost:8000';

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

  if (url.protocol !== 'https:' && !isDevelopment) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use HTTPS outside development.');
  }

  const normalizedUrl = url.toString().replace(/\/$/, '');
  return Object.freeze({ apiBaseUrl: normalizedUrl });
}

module.exports = { parseEnvironment };
