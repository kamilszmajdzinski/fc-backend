import { createRemoteJWKSet, jwtVerify } from 'jose';
import { UnauthorizedError } from '../lib/errors.js';

/**
 * Checks a Supabase Auth access token (a signed JWT) against `keys` and returns the user
 * ({ id, email }). Throws when the token is not valid, has expired or comes from another issuer.
 */
export function tokenVerifier({ issuer, keys }) {
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, { issuer, audience: 'authenticated' });
    return { id: payload.sub, email: payload.email ?? null };
  };
}

// Uses the public signing keys the Supabase project publishes (fetched once, then cached).
export function supabaseTokenVerifier(supabaseUrl) {
  const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  return tokenVerifier({ issuer, keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) });
}

// Puts the logged-in user in req.user. Requests without a valid Bearer token get a 401.
export function requireAuth(verifyToken) {
  return async (req, res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedError();

    let user;
    try {
      user = await verifyToken(token);
    } catch {
      throw new UnauthorizedError('Your session has expired. Log in again.');
    }
    if (!user?.id) throw new UnauthorizedError();
    req.user = user;
    next();
  };
}
