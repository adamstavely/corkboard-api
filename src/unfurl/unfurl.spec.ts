import { isPrivateAddress, readPreview, unfurl } from './unfurl';

describe('link previews', () => {
  it('refuses private, loopback and metadata addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) expect(isPrivateAddress(a)).toBe(false);
  });

  it('never fetches a private address, written out or not', async () => {
    await expect(unfurl('http://127.0.0.1/')).rejects.toThrow('not allowed');
    await expect(unfurl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('not allowed');
    await expect(unfurl('http://localhost:3700/')).rejects.toThrow('not allowed');
    await expect(unfurl('ftp://example.com/')).rejects.toThrow('Only web links');
  });

  it("reads a page's Open Graph tags, falling back to its title", () => {
    const html = `<html><head><title>Fallback &amp; title</title>
      <meta property="og:title" content="The &quot;real&quot; title">
      <meta name="description" content="What it&#39;s about">
      <meta property="og:image" content="/pic.png"><meta property="og:site_name" content="Example"></head></html>`;
    expect(readPreview(html, new URL('https://example.com/a'))).toEqual({
      url: 'https://example.com/a',
      title: 'The "real" title',
      description: "What it's about",
      image: 'https://example.com/pic.png',
      site: 'Example',
    });
    expect(readPreview('<title>Only a title</title>', new URL('http://www.example.org/'))).toMatchObject({ title: 'Only a title', image: null, site: 'example.org' });
  });
});
