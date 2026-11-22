import * as Y from 'yjs';
import { diagramImageUrls, diagramLinkUrl, diagramProblem, diagramsOn, placeDiagram, setDiagramSource } from './diagram-node';

describe('diagrams on the board', () => {
  it('are placed beside the board, read back and changed by id', () => {
    const doc = new Y.Doc();
    const id = placeDiagram(doc, '  flowchart TD\n  a --> b  ');
    expect(diagramsOn(doc)).toEqual([{ id, source: 'flowchart TD\n  a --> b' }]);
    expect(setDiagramSource(doc, id, 'sequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(setDiagramSource(doc, 'nope', 'flowchart TD')).toBe(false);
    expect(diagramsOn(doc)[0].source).toBe('sequenceDiagram\n  A->>B: hi');
  });

  it('take the kinds Corkboard draws, and no others', () => {
    for (const text of [
      'flowchart LR\n a --> b',
      'graph TD\n a --> b',
      'sequenceDiagram\n A->>B: x',
      'stateDiagram-v2\n [*] --> Draft',
      'stateDiagram\n [*] --> Draft',
      'classDiagram\n class Board',
      'erDiagram\n BOARD ||--o{ NOTE : holds',
      'gantt\n title Plan\n dateFormat YYYY-MM-DD\n Design :a1, 2026-01-05, 7d',
      'pie title Pets\n "Dogs" : 3',
      'journey\n title Day\n section Work\n Code: 5: Me',
      'timeline\n 2026 : Launch',
      'mindmap\n  root((Plan))',
      'quadrantChart\n title Value',
      'xychart\n x-axis [a, b]\n bar [1, 2]',
      'xychart-beta\n bar [1, 2]',
      'gitGraph\n commit',
      'kanban\n todo[To do]',
      'requirementDiagram\n requirement r {\n id: 1\n }',
      'sankey\n a,b,1',
      'block\n a b',
      'packet\n 0-15: "Port"',
      '%% a comment first\nflowchart TD\n a --> b',
    ]) {
      expect(diagramProblem(text)).toBeNull();
    }
    for (const text of ['flowchart-elk TD\n a --> b', 'architecture-beta\n service a(server)[A]', 'C4Context\n Person(a, "A")', 'zenuml\n A.b()', 'hello']) {
      expect(diagramProblem(text)).toMatch(/Start the text with the kind/);
    }
    expect(diagramProblem('')).toMatch(/needs/);
    expect(diagramProblem('flowchart TD\n' + 'a'.repeat(9000))).toMatch(/at most/);
  });

  it("refuse Mermaid's settings, and take a title in front matter but nothing else", () => {
    expect(diagramProblem("%%{init: {'securityLevel': 'loose'}}%%\nflowchart TD\n a --> b")).toMatch(/settings/);
    expect(diagramProblem("flowchart TD\n %%{init: {'theme': 'dark'}}%%\n a --> b")).toMatch(/settings/);
    expect(diagramProblem('---\ntitle: The plan\n---\nflowchart TD\n a --> b')).toBeNull();
    expect(diagramProblem('---\nconfig:\n  securityLevel: loose\n---\nflowchart TD\n a --> b')).toMatch(/Only a title/);
    expect(diagramProblem('---\ntitle: A\ntheme: dark\n---\nflowchart TD\n a --> b')).toMatch(/Only a title/);
    expect(diagramProblem('---\ntitle: never closed\nflowchart TD\n a --> b')).toMatch(/Only a title/);
  });

  it('take links to web pages and emails, and nothing else', () => {
    expect(diagramProblem('flowchart TD\n A --> B\n click A href "https://example.com/a" "Tip" _blank\n click B "mailto:ada@example.com"')).toBeNull();
    expect(diagramProblem('flowchart TD\n A --> B\n click A href "javascript:alert(1)"')).toMatch(/must start with https/);
    expect(diagramProblem('flowchart TD\n A --> B\n click A href "ftp://example.com"')).toMatch(/must start with https/);
    expect(diagramProblem('flowchart TD\n A --> B\n click A call doIt()')).toMatch(/goes to a web address/);
    expect(diagramLinkUrl(' https://example.com ')).toBe('https://example.com/');
    expect(diagramLinkUrl('data:text/html,hi')).toBeNull();
  });

  it("take images from the board's files and https addresses only", () => {
    const file = 'corkboard-file:0b6f3c9e-4a1d-4c3e-9f7a-2d5e8b1c6a40';
    const ok = `flowchart TD\n A@{ img: "${file}", label: "Logo", pos: "t", w: 60, h: 60 }\n B@{ img: 'https://example.com/b.png' }\n C@{ shape: rect, img: https://example.com/c.png }\n A --> B --> C`;
    expect(diagramProblem(ok)).toBeNull();
    expect(diagramImageUrls(ok)).toEqual(['https://example.com/b.png', 'https://example.com/c.png']);
    expect(diagramProblem('flowchart TD\n A@{ img: "http://example.com/a.png" }')).toMatch(/Images in a diagram/);
    expect(diagramProblem('flowchart TD\n A@{ img: "data:image/png;base64,AAAA" }')).toMatch(/Images in a diagram/);
    expect(diagramProblem('flowchart TD\n A@{ img: "corkboard-file:not-an-id" }')).toMatch(/Images in a diagram/);
    // "img:" in a label is just words.
    expect(diagramProblem('flowchart TD\n A["img: here"]')).toBeNull();
  });
});
