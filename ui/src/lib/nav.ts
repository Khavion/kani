import { isMock } from '../api/client.ts';

export function withMock(path: string): string {
  return isMock ? `${path}${path.includes('?') ? '&' : '?'}mock=1` : path;
}

export function navigate(path: string): void {
  history.pushState(null, '', withMock(path));
  window.dispatchEvent(new PopStateEvent('popstate'));
}
