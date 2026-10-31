import { expect } from 'bun:test';

export interface SetCookie {
  name: string;
  value: string;
  attributes: Map<string, string>;
}

export function parseSetCookie(header: string): SetCookie {
  const [pair = '', ...attributes] = header.split(';').map((part) => part.trim());
  const separator = pair.indexOf('=');
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    attributes: new Map(
      attributes.map((attribute) => {
        const [key = '', ...value] = attribute.split('=');
        return [key.toLowerCase(), value.join('=')];
      }),
    ),
  };
}

export const setCookiesOf = (response: Response): SetCookie[] => response.headers.getSetCookie().map(parseSetCookie);

export const cookieHeaderOf = (response: Response): string =>
  setCookiesOf(response)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

// What a browser needs to keep and send the session cookie on the origin the server answers from: scripts cannot read
// it, a cross-site request does not carry it, and `Secure` is set only on https, because a browser on plain http
// drops a Secure cookie (Safari does so even on localhost).
export function expectSessionCookieKeptOn(response: Response, origin: string): void {
  const cookies = setCookiesOf(response);
  expect(cookies.some((cookie) => cookie.name.endsWith('session_token'))).toBe(true);
  const isHttps = new URL(origin).protocol === 'https:';
  for (const cookie of cookies) {
    expect([cookie.name, cookie.attributes.has('httponly')]).toEqual([cookie.name, true]);
    expect([cookie.name, cookie.attributes.get('samesite')?.toLowerCase()]).toEqual([cookie.name, 'lax']);
    expect([cookie.name, cookie.attributes.has('secure')]).toEqual([cookie.name, isHttps]);
    expect([cookie.name, cookie.attributes.get('path')]).toEqual([cookie.name, '/']);
  }
}
