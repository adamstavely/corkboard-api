import { fetchImage, imageType, isPrivateAddress, readPreview, unfurl, readableText } from './unfurl';

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

describe("a page's readable text", () => {
  it('keeps the main content, a line per block, without scripts, navigation or markup', () => {
    const filler = 'The pilot runs for twelve weeks with three teams. '.repeat(6);
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
      <nav><a href="/">Home</a></nav>
      <header>Site header</header>
      <main><h1>Pilot plan</h1><p>${filler}</p><ul><li>One &amp; two</li><li>Three</li></ul><script>alert(1)</script></main>
      <footer>Footer</footer></body></html>`;
    expect(readableText(html)).toBe(`Pilot plan\n${filler.trim()}\n- One & two\n- Three`);
  });

  it('reads the whole body when there is no main part worth taking, and stops at the limit', () => {
    expect(readableText('<html><head><title>Example Domain</title></head><body><p>Hello</p><div>World</div></body></html>')).toBe('Hello\nWorld');
    expect(readableText(`<p>${'a '.repeat(30_000)}</p>`).length).toBe(20_000);
  });
});

describe('pictures for diagrams', () => {
  it('are told apart by their own bytes', () => {
    expect(imageType(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'))).toBe('image/png');
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(imageType(Buffer.from('GIF89a......', 'latin1'))).toBe('image/gif');
    expect(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageType(Buffer.from('<html></html>'))).toBeNull();
    expect(imageType(Buffer.alloc(0))).toBeNull();
  });

  it('come only from public https addresses', async () => {
    await expect(fetchImage('http://example.com/a.png')).rejects.toThrow('Only https');
    await expect(fetchImage('https://127.0.0.1/a.png')).rejects.toThrow('not allowed');
    await expect(fetchImage('https://169.254.169.254/a.png')).rejects.toThrow('not allowed');
    await expect(fetchImage('https://localhost/a.png')).rejects.toThrow('not allowed');
  });
});
