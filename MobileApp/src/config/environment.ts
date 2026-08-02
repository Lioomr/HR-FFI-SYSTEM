import { parseEnvironment } from './environment-parser';

export type { Environment } from './environment-parser';
export { parseEnvironment } from './environment-parser';

export const environment = parseEnvironment(process.env.EXPO_PUBLIC_API_BASE_URL, {
  isDevelopment: typeof __DEV__ !== 'undefined' && __DEV__,
});
