import { ATTEMPTS, Attempts, checkPass, checkPassword, hashPassword, issuePass, PASS_MS } from './link-password';

describe('share link passwords', () => {
  it('keeps only a salted hash, and checks against it', async () => {
    const stored = await hashPassword('open sesame');
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain('open sesame');
    expect(await hashPassword('open sesame')).not.toBe(stored);
    expect(await checkPassword('open sesame', stored)).toBe(true);
    expect(await checkPassword('open sesame!', stored)).toBe(false);
    expect(await checkPassword('open sesame', 'plain')).toBe(false);
  });

  it('gives a pass that works for that link and password only, until it runs out', async () => {
    const stored = await hashPassword('open sesame');
    const pass = issuePass('link-1', stored, 1000);
    expect(checkPass(pass, 'link-1', stored, 2000)).toBe(true);
    expect(checkPass(pass, 'link-2', stored, 2000)).toBe(false);
    expect(checkPass(pass, 'link-1', await hashPassword('open sesame'), 2000)).toBe(false);
    expect(checkPass(pass, 'link-1', stored, 1000 + PASS_MS + 1)).toBe(false);
    expect(checkPass(`${Number.MAX_SAFE_INTEGER}.${pass.split('.')[1]}`, 'link-1', stored, 2000)).toBe(false);
    expect(checkPass(undefined, 'link-1', stored, 2000)).toBe(false);
  });

  it('stops taking guesses from one address, and from everyone, for a while', () => {
    const attempts = new Attempts();
    for (let i = 0; i < ATTEMPTS.perAddress; i++) attempts.miss('link', 'a', 0);
    expect(attempts.waitFor('link', 'a', 1)).toBe(15);
    expect(attempts.waitFor('link', 'b', 1)).toBe(0);
    expect(attempts.waitFor('link', 'a', ATTEMPTS.windowMs + 1)).toBe(0);
    for (let i = 0; i < ATTEMPTS.perLink; i++) attempts.miss('other', `addr-${i}`, 0);
    expect(attempts.waitFor('other', 'someone-new', 1)).toBe(15);
  });
});
