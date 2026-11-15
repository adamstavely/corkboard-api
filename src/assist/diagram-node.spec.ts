import * as Y from 'yjs';
import { diagramProblem, diagramsOn, placeDiagram, setDiagramSource } from './diagram-node';

describe('diagrams on the board', () => {
  it('are placed beside the board, read back and changed by id', () => {
    const doc = new Y.Doc();
    const id = placeDiagram(doc, '  flowchart TD\n  a --> b  ');
    expect(diagramsOn(doc)).toEqual([{ id, source: 'flowchart TD\n  a --> b' }]);
    expect(setDiagramSource(doc, id, 'sequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(setDiagramSource(doc, 'nope', 'flowchart TD')).toBe(false);
    expect(diagramsOn(doc)[0].source).toBe('sequenceDiagram\n  A->>B: hi');
  });

  it('take flowcharts and sequence diagrams only', () => {
    expect(diagramProblem('flowchart LR\n a --> b')).toBeNull();
    expect(diagramProblem('graph TD\n a --> b')).toBeNull();
    expect(diagramProblem('sequenceDiagram\n A->>B: x')).toBeNull();
    expect(diagramProblem('pie title Pets')).toMatch(/Start the text/);
    expect(diagramProblem('')).toMatch(/needs/);
    expect(diagramProblem('flowchart TD\n' + 'a'.repeat(9000))).toMatch(/at most/);
  });
});
