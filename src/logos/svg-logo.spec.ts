import { cleanLogo } from './svg-logo';

describe('logos from icon packs', () => {
  it('keeps plain drawings: paths, shapes, groups, gradients and references inside the logo', () => {
    const body =
      '<defs><linearGradient id="a" x1="0" x2="1"><stop offset="0" stop-color="#f90"/><stop offset="1" stop-color="#c60"/></linearGradient></defs>' +
      '<g fill="url(#a)"><path d="M0 0h64v64H0z"/><circle cx="32" cy="32" r="8" style="fill:#fff;opacity:0.8"/></g><use href="#a"/>';
    expect(cleanLogo({ vb: '0 0 64 64', body })).toEqual({ vb: '0 0 64 64', body });
    expect(cleanLogo({ vb: '0,0,64,64', body: '<rect width="64" height="64"/>' })).toEqual({ vb: '0 0 64 64', body: '<rect width="64" height="64"/>' });
  });

  it('refuses anything that is not plain drawing', () => {
    const refused = (body: string) => 'error' in cleanLogo({ vb: '0 0 10 10', body });
    expect(refused('<script>alert(1)</script>')).toBe(true);
    expect(refused('<path d="M0 0" onload="alert(1)"/>')).toBe(true);
    expect(refused('<image href="https://evil.example/x.png"/>')).toBe(true);
    expect(refused('<use href="https://evil.example/x.svg#a"/>')).toBe(true);
    expect(refused('<path fill="url(https://evil.example/x)"/>')).toBe(true);
    expect(refused('<path style="background:url(#a)"/>')).toBe(true);
    expect(refused('<path fill="&#106;avascript:x"/>')).toBe(true);
    expect(refused('<style>path{fill:red}</style>')).toBe(true);
    expect(refused('<!-- hi --><path d="M0 0"/>')).toBe(true);
    expect(refused('<text>Hi</text>')).toBe(true);
    expect(refused('<g><path d="M0 0"/>')).toBe(true);
    expect(refused('<foreignObject><div/></foreignObject>')).toBe(true);
    expect('error' in cleanLogo({ vb: 'none', body: '<path d="M0 0"/>' })).toBe(true);
  });
});
