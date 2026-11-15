import * as Y from 'yjs';
import { lockProblem } from './locks';
import { nodeProblem } from './node-schema';
import { rootProblem } from './root-schema';
import { serverOwnedIn } from './server-owned';

/** Every guard a client's update passes before the server applies it (CollabService's beforeSync), in order. */
const admit = (doc: Y.Doc, update: Uint8Array) => serverOwnedIn(doc, update) ?? nodeProblem(doc, update) ?? rootProblem(doc, update) ?? lockProblem(doc, update);

describe('admitting a large update', () => {
  it('checks thousands of new items quickly and quietly, without holding the server up', () => {
    const board = new Y.Doc();
    const client = new Y.Doc();
    client.transact(() => {
      for (let i = 0; i < 4000; i++) {
        const frame = new Y.Map<unknown>();
        client.getMap('nodes').set(`f${i}`, frame);
        frame.set('kind', 'frame');
        frame.set('title', `Frame ${i}`);
        frame.set('x', i);
        frame.set('y', i);
        frame.set('w', 100);
        frame.set('h', 100);
      }
    });
    const update = Y.encodeStateAsUpdate(client);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const started = performance.now();
      expect(admit(board, update)).toBeNull();
      // Took about 3 s before the update was decoded once and indexed; now well under half a second. The bound is loose
      // so a slow CI machine doesn't fail it, but quadratic work would.
      expect(performance.now() - started).toBeLessThan(1_500);
      // Reading new, not-yet-attached maps used to warn once per field.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
