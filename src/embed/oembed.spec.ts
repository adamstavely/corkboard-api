import { embedIframe, embedSize, embedToken } from './oembed';

describe('oEmbed for embed pages', () => {
  const origins = ['https://cork.test'];
  const token = 'abcdefghijklmnopqrstuvwxyz012345';

  it("takes only embed pages on Corkboard's own address", () => {
    expect(embedToken(`https://cork.test/embed/${token}`, origins)).toBe(token);
    expect(embedToken(`https://cork.test/embed/${token}/`, origins)).toBe(token);
    expect(embedToken(`https://evil.test/embed/${token}`, origins)).toBeNull();
    expect(embedToken(`https://cork.test/shared/${token}`, origins)).toBeNull();
    expect(embedToken(`https://cork.test/embed/short`, origins)).toBeNull();
    expect(embedToken('not a url', origins)).toBeNull();
  });

  it('scales the frame down to fit, keeping its shape', () => {
    expect(embedSize()).toEqual({ width: 800, height: 500 });
    expect(embedSize(400)).toEqual({ width: 400, height: 250 });
    expect(embedSize(1600, 250)).toEqual({ width: 400, height: 250 });
  });

  it('escapes what goes in the iframe', () => {
    expect(embedIframe('https://cork.test/embed/x', 'Plans <"Q3">', { width: 800, height: 500 })).toBe(
      '<iframe src="https://cork.test/embed/x" width="800" height="500" style="border:0" loading="lazy" allowfullscreen title="Plans &lt;&quot;Q3&quot;&gt; (Corkboard board)"></iframe>',
    );
  });
});
