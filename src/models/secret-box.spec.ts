import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

const box = (secret?: string) => new SecretBox(new ConfigService({ modelKeySecret: secret }));
const key = () => randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('opens what it sealed, differently each time', () => {
    const b = box(key());
    const a = b.seal('sk-ant-123');
    expect(a).not.toContain('sk-ant');
    expect(b.seal('sk-ant-123')).not.toBe(a);
    expect(b.open(a)).toBe('sk-ant-123');
  });

  it('refuses tampered secrets and other keys', () => {
    const b = box(key());
    const sealed = b.seal('secret');
    const [v, iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => b.open([v, iv, tag, flipped.toString('base64')].join('.'))).toThrow();
    expect(() => box(key()).open(sealed)).toThrow();
  });

  it('works only with a 32-byte secret', () => {
    expect(box().ready).toBe(false);
    expect(() => box().seal('x')).toThrow(/MODEL_KEY_SECRET/);
    expect(() => box(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
