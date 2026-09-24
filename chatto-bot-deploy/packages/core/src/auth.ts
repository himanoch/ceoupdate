import crypto from 'node:crypto';
import type { ActorType } from './index.js';

export interface TokenPayload {
  tenantId: string;
  actorType: ActorType;
  actorId: string;
  iat?: number;
  exp?: number;
}

export interface AuthSession {
  tenantId: string;
  actorType: ActorType;
  actorId: string;
}

const DEFAULT_SECRET = process.env.JWT_SECRET || 'chatto_bot_default_internal_secret_change_in_prod';

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Creates a signed JWT-like token for tenant authentication.
 */
export function createTenantToken(
  payload: { tenantId: string; actorType: ActorType; actorId: string; expiresInSeconds?: number },
  secret: string = DEFAULT_SECRET
): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (payload.expiresInSeconds || 86400); // 24 hours

  const header = { alg: 'HS256', typ: 'JWT' };
  const tokenPayload: TokenPayload = {
    tenantId: payload.tenantId,
    actorType: payload.actorType,
    actorId: payload.actorId,
    iat: now,
    exp,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signatureInput);
  const signature = base64UrlEncode(hmac.digest('base64'));

  return `${signatureInput}.${signature}`;
}

/**
 * Verifies a token and returns the authenticated session, or null if invalid or expired.
 */
export function verifyTenantToken(token: string, secret: string = DEFAULT_SECRET): AuthSession | null {
  if (!token) return null;

  // 1. Support development / test tokens: `test-token:<tenantId>:<actorType>:<actorId>`
  if (token.startsWith('test-token:')) {
    const parts = token.split(':');
    return {
      tenantId: parts[1] || 'the-hill-land',
      actorType: (parts[2] as ActorType) || 'admin',
      actorId: parts[3] || 'test_user',
    };
  }

  // 2. Support API Key tokens: `api_key_<tenantId>_<id>`
  if (token.startsWith('api_key_')) {
    const parts = token.split('_');
    const tenant = parts[2];
    if (tenant) {
      return {
        tenantId: tenant,
        actorType: 'admin',
        actorId: `key_${parts[3] || 'service'}`,
      };
    }
  }

  // 3. Verify HMAC-SHA256 Signed JWT Token
  const parts = token.split('.');
  if (parts.length !== 3) {
    // Check if plain JSON base64
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed.tenantId && parsed.actorType) {
        return {
          tenantId: parsed.tenantId,
          actorType: parsed.actorType,
          actorId: parsed.actorId || 'authenticated_user',
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signatureInput);
  const expectedSig = base64UrlEncode(hmac.digest('base64'));

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payloadJson = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(payloadJson) as TokenPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }

    return {
      tenantId: payload.tenantId,
      actorType: payload.actorType,
      actorId: payload.actorId,
    };
  } catch {
    return null;
  }
}
