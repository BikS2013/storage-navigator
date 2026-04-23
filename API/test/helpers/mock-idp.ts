import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
import { v7 as uuidv7 } from 'uuid';

export type MockIdp = {
  issuer: string;
  jwksUri: string;
  signToken: (claims: Record<string, unknown>, opts?: SignOpts) => Promise<string>;
  rotate: () => Promise<void>;
  close: () => Promise<void>;
};

export type SignOpts = {
  audience?: string | string[];
  expiresInSec?: number;
  notBeforeSec?: number;
  alg?: 'RS256';
};

export async function startMockIdp(): Promise<MockIdp> {
  let { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  let kid = uuidv7();
  let jwks: { keys: JWK[] } = {
    keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }],
  };

  const server: Server = createServer((req, res) => {
    if (req.url?.endsWith('/jwks')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(jwks));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('mock-idp: bad address');
  const issuer = `http://127.0.0.1:${addr.port}`;
  const jwksUri = `${issuer}/jwks`;

  const signToken: MockIdp['signToken'] = async (claims, opts = {}) => {
    const now = Math.floor(Date.now() / 1000);
    let jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid })
      .setIssuer(issuer)
      .setIssuedAt(now)
      .setNotBefore(opts.notBeforeSec ?? now)
      .setExpirationTime(now + (opts.expiresInSec ?? 300));
    if (opts.audience) jwt = jwt.setAudience(opts.audience);
    return jwt.sign(privateKey);
  };

  const rotate = async (): Promise<void> => {
    const next = await generateKeyPair('RS256', { extractable: true });
    privateKey = next.privateKey;
    publicKey = next.publicKey;
    kid = uuidv7();
    jwks = {
      keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }],
    };
  };

  const close = (): Promise<void> =>
    new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );

  return { issuer, jwksUri, signToken, rotate, close };
}
