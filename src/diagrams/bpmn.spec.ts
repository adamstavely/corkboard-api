import * as Y from 'yjs';
import { applyLayout, layoutProblem } from '../boards/layout';
import { layoutFlow, mainFlow, partsOf, placeSubprocesses } from './flowchart';
import { bpmnBoard, bpmnChecks, bpmnsOn, BPMN_STARTER, parseBpmn, readBpmnSource, rewriteBpmn } from './bpmn';

const place = (doc: Y.Doc, text: string) => {
  const { data } = readBpmnSource(text);
  const layout = layoutFlow(mainFlow(data), 'bpmn');
  expect(layoutProblem(layout)).toBeNull();
  const id = applyLayout(doc, layout, { x: 100, y: 100 }, 'assistant').get('diagram')!;
  placeSubprocesses(doc, id, data);
  return id;
};

describe('BPMN processes (API)', () => {
  it('draws one with markers, reads it back as BPMN XML with its layout, and rewrites it', () => {
    expect(readBpmnSource(BPMN_STARTER).checks).toEqual([]);
    const doc = new Y.Doc();
    const id = place(doc, BPMN_STARTER);
    expect(bpmnsOn(doc)).toEqual([id]);
    const steps = new Map(partsOf(doc, id).flatMap((p) => (p.part.role === 'step' ? [[p.part.key, `${String(p.node.get('shape'))}:${(p.node.get('icon') as string | undefined) ?? ''}`]] : [])));
    expect(steps.get('received')).toBe('ellipse:bpmn-message');
    expect(steps.get('check')).toBe('rounded:bpmn-user');
    expect(steps.get('paid')).toBe('diamond:bpmn-exclusive');
    const xml = bpmnBoard(doc, id)!;
    expect(xml).toContain('<bpmn:timerEventDefinition />');
    expect(xml).toContain('<bpmn:lane id="warehouse" name="Warehouse">');
    expect(xml).toMatch(/<bpmndi:BPMNShape id="check_di" bpmnElement="check"><dc:Bounds x="\d+" y="\d+"/);
    rewriteBpmn(doc, id, readBpmnSource(BPMN_STARTER.replace('name="Book courier"', 'name="Book a courier"')).data);
    expect(bpmnBoard(doc, id)).toContain('name="Book a courier"');
  });

  it('says what to fix: missing ends, loose steps, unlabelled choices, idle gateways, messages inside a pool', () => {
    const parsed = parseBpmn(`<definitions>
  <collaboration id="c"><participant id="p" name="Shop" processRef="shop" /><participant id="q" name="Bank" processRef="bank" /><messageFlow id="m" sourceRef="a" targetRef="b" /></collaboration>
  <process id="shop">
    <startEvent id="s" />
    <task id="a" name="Take the order" />
    <exclusiveGateway id="g" name="OK?" />
    <task id="b" name="Ship" />
    <task id="c" name="Refund" />
    <parallelGateway id="idle" />
    <task id="lost" name="Forgotten" />
    <sequenceFlow id="f1" sourceRef="s" targetRef="a" />
    <sequenceFlow id="f2" sourceRef="a" targetRef="g" />
    <sequenceFlow id="f3" sourceRef="g" targetRef="b" />
    <sequenceFlow id="f4" name="No" sourceRef="g" targetRef="c" />
    <sequenceFlow id="f5" sourceRef="b" targetRef="idle" />
    <sequenceFlow id="f6" sourceRef="idle" targetRef="c" />
  </process>
  <process id="bank"><task id="x" name="Authorise" /></process>
</definitions>`);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(bpmnChecks(parsed.data)).toEqual(
      expect.arrayContaining([
        'The process has no end event.',
        '"Forgotten" is never reached: add a sequence flow into it.',
        'Label each way out of the gateway "OK?" with its condition.',
        'The gateway "idle" neither splits nor merges: remove it.',
        'The message flow m stays inside one pool: use a sequence flow there.',
      ]),
    );
  });
});
