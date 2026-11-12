import { ConfigService } from '@nestjs/config';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { TokenVerifier } from './token-verifier';

const ISSUER = 'https://idp.test/realms/corkboard';

async function setup(audience?: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
  const keySource = jest.fn(() => Promise.resolve(jwks));
  const config = new ConfigService({ oidc: { issuer: ISSUER, audience } });
  const verifier = new TokenVerifier(config, keySource);
  const sign = (claims: Record<string, unknown>, sub = 'abc') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience('corkboard-ui')
      .setExpirationTime('5m')
      .sign(privateKey);
  return { verifier, sign, keySource };
}

describe('TokenVerifier', () => {
  it('reads who the caller is, falling back from name to username, email and subject', async () => {
    const { verifier, sign } = await setup();
    expect(await verifier.verify(await sign({ name: ' Ada ', email: 'ada@x.test', email_verified: true }))).toEqual({
      subject: 'abc',
      name: 'Ada',
      email: 'ada@x.test',
      emailVerified: true,
    });
    expect((await verifier.verify(await sign({ preferred_username: 'ada', email: 'a@x.test' }))).name).toBe('ada');
    expect((await verifier.verify(await sign({ email: 'a@x.test' }))).name).toBe('a@x.test');
    expect(await verifier.verify(await sign({}))).toEqual({ subject: 'abc', name: 'abc', email: undefined, emailVerified: false });
    expect((await verifier.verify(await sign({ email: 'a@x.test', email_verified: 'true' }))).emailVerified).toBe(false);
  });

  it('checks the audience only when one is configured', async () => {
    const strict = await setup('another-app');
    await expect(strict.verifier.verify(await strict.sign({}))).rejects.toThrow();
    const open = await setup();
    await expect(open.verifier.verify(await open.sign({}))).resolves.toBeDefined();
  });

  it('looks the keys up once, and again after a failed lookup', async () => {
    const { verifier, sign, keySource } = await setup();
    keySource.mockImplementationOnce(() => Promise.reject(new Error('IdP down')));
    await expect(verifier.verify(await sign({}))).rejects.toThrow('IdP down');
    await verifier.verify(await sign({}));
    await verifier.verify(await sign({}));
    expect(keySource).toHaveBeenCalledTimes(2);
  });
});
