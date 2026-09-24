import type http from 'node:http';
import { verifyTenantToken, type AuthSession, type ActorType } from '../../../packages/core/src/index.js';

export type { AuthSession };

const isProduction = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim().toLowerCase())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Authenticates request based on Bearer token or API key using Core Tenant Auth.
 * In production, all tenant-scoped operations strictly require a verified AuthSession.
 */
export function authenticateRequest(req: http.IncomingMessage): AuthSession | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  if (!token) return null;

  return verifyTenantToken(token);
}

/**
 * Calculates CORS headers enforcing strict origins in production (no wildcard).
 */
export function getCorsHeaders(req: http.IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  let allowOrigin = '';

  if (!isProduction) {
    allowOrigin = origin || '*';
  } else {
    if (origin && ALLOWED_ORIGINS.includes(origin.toLowerCase())) {
      allowOrigin = origin;
    } else {
      allowOrigin = ALLOWED_ORIGINS[0] || 'null';
    }
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-tenant-id, Authorization',
    'Vary': 'Origin',
  };
}
