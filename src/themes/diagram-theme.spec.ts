import { contrast, fromOklch, MIN_CONTRAST, nearestFont, normHex, readLook, themeFromBrand, themeProblems, toOklch, TRENCH_COAT } from './diagram-theme';

describe('diagram themes', () => {
  it('reads colours, and measures contrast as WCAG does', () => {
    expect(normHex('#ABC')).toBe('#aabbcc');
    expect(normHex('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(normHex('rgba(0,0,0,0.5)')).toBeNull();
    expect(normHex('red')).toBeNull();
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    const [L, C, H] = toOklch('#2f6fde');
    expect(fromOklch(L, C, H)).toBe('#2f6fde');
  });

  it('accepts Trench Coat, and refuses malformed looks or fills text can’t be read on', () => {
    expect(themeProblems(TRENCH_COAT)).toEqual([]);
    expect(themeProblems({ ...TRENCH_COAT, light: ['#000'] })).toContain('Give six light fills as #rrggbb.');
    expect(themeProblems({ ...TRENCH_COAT, radius: 40 })).toContain('Corners are 0 to 24 px.');
    const dim = themeProblems({ ...TRENCH_COAT, light: ['#555555', ...TRENCH_COAT.light.slice(1)] });
    expect(dim).toEqual([expect.stringContaining('Text on the light blue fill (#555555)')]);
  });

  it('builds a readable look from brand colours, in light and dark', () => {
    const theme = themeFromBrand(['#e4002b', '#00205b'], { name: 'Acme', radius: 4 });
    expect(themeProblems(theme)).toEqual([]);
    expect(theme).toMatchObject({ name: 'Acme', font: 'inter', radius: 4 });
    for (const mode of ['light', 'dark'] as const) for (const fill of theme[mode]) expect(contrast(fill, theme.ink[mode])).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // The first fill keeps the first brand colour's hue.
    expect(Math.abs(toOklch(theme.light[0])[2] - toOklch('#e4002b')[2])).toBeLessThan(15);
    expect(themeProblems(themeFromBrand([]))).toEqual([]);
  });

  it('reads a site’s look from its CSS: named brand colours first, greys aside, font and button corners', () => {
    const look = readLook(`
      :root { --brand-primary: #6d28d9; --text: #111111; --bg: #ffffff; }
      body { font-family: "Merriweather", Georgia, serif; color: #333; }
      a { color: #6d28d9 } .btn { background: rgb(234, 88, 12); border-radius: 6px }
      button { border-radius: 0.5rem } footer { background: #f5f5f5 }`);
    expect(look.brand).toEqual(['#6d28d9', '#ea580c']);
    expect(look.font).toBe('serif');
    expect(look.radius).toBe(8);
    expect(nearestFont('JetBrains Mono')).toBe('mono');
    expect(nearestFont('Open Sans')).toBe('inter');
  });
});
