import * as Y from "yjs";
import { applyLayout, layoutProblem } from "../boards/layout";
import {
  flowchartMermaid,
  flowchartsOn,
  hasPicturesOrLinks,
  isFlowchartSource,
  layoutFlow,
  parseFlowchart,
  readFlowchart,
  rewriteFlowchart,
  type FlowData,
} from "./flowchart";
import {
  checkNote,
  flowchartChecks,
  readFlowchartSource,
} from "./flowchart-checks";

const SOURCE = `---
title: Returns
---
flowchart LR
  subgraph lane_customer["Customer"]
    ask(["Ask For Refund"])
    done(["Refunded"])
    declined(["Refund Declined"])
  end
  subgraph lane_shop["Shop"]
    check{"Within 30 Days?"}
    refund["Refund Payment"]
  end
  ask --> check
  check -->|"Yes"| refund --> done
  check -->|"No"| declined
  n1>"Receipt needed"] -.- check
`;

const data = (source = SOURCE): FlowData => {
  const parsed = parseFlowchart(source);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.data;
};

function place(doc: Y.Doc): string {
  const layout = layoutFlow(data());
  expect(layoutProblem(layout)).toBeNull();
  return applyLayout(doc, layout, { x: 100, y: 100 }, "assistant").get(
    "diagram",
  )!;
}

describe("editable flowcharts (API)", () => {
  it("knows flowchart text, and places one as a tagged diagram frame, lanes, steps and remarks", () => {
    expect(isFlowchartSource(SOURCE)).toBe(true);
    expect(isFlowchartSource("graph TD\n a-->b")).toBe(true);
    expect(isFlowchartSource("sequenceDiagram\n a->>b: hi")).toBe(false);
    expect(hasPicturesOrLinks(SOURCE)).toBe(false);
    expect(
      hasPicturesOrLinks(
        'flowchart\n  a["A"]\n  click a href "https://example.com"',
      ),
    ).toBe(true);
    expect(
      hasPicturesOrLinks(
        'flowchart\n  a@{ img: "https://example.com/a.png", label: "A" }',
      ),
    ).toBe(true);
    const doc = new Y.Doc();
    const id = place(doc);
    expect(flowchartsOn(doc)).toEqual([id]);
    const read = readFlowchart(doc, id)!;
    expect(read.title).toBe("Returns");
    expect(read.lanes.map((l) => l.name)).toEqual(["Customer", "Shop"]);
    expect(read.nodes.find((n) => n.id === "check")).toMatchObject({
      type: "decision",
      laneId: "lane_shop",
    });
    expect(read.notes).toEqual([
      { id: "n1", text: "Receipt needed", nodes: ["check"] },
    ]);
    const text = flowchartMermaid(doc, id)!;
    expect(text).toMatch(/subgraph lane_shop/);
    expect(
      data(text)
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(read.nodes.map((n) => n.id).sort());
  });

  it("rewrites a flowchart in place: kept steps stay the same things, new ones arrive, dropped ones go with their arrows", () => {
    const doc = new Y.Doc();
    const id = place(doc);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const idOf = (key: string) =>
      [...nodes.entries()].find(
        ([, n]) => (n.get("part") as { key?: string } | undefined)?.key === key,
      )?.[0];
    const check = idOf("check");
    const declined = idOf("declined");
    const next = SOURCE.replace('"Within 30 Days?"', '"Within 14 Days?"')
      .replace(
        '  check -->|"No"| declined\n',
        '  check -->|"No"| store_credit\n',
      )
      .replace(
        '    refund["Refund Payment"]\n',
        '    refund["Refund Payment"]\n    store_credit["Offer Store Credit"]\n',
      )
      .replace('    declined(["Refund Declined"])\n', "");
    rewriteFlowchart(doc, id, data(next));
    expect(idOf("check")).toBe(check);
    expect(nodes.get(check!)?.get("label")).toBe("Within 14 Days?");
    expect(idOf("store_credit")).toBeDefined();
    expect(nodes.has(declined!)).toBe(false);
    const arrows = [...nodes.values()].filter(
      (n) => n.get("kind") === "connector",
    );
    expect(arrows.some((a) => a.get("to") === declined)).toBe(false);
    expect(
      arrows
        .find(
          (a) =>
            a.get("from") === check && a.get("to") === idOf("store_credit"),
        )
        ?.get("label"),
    ).toBe("No");
    expect(readFlowchart(doc, id)!.nodes).toHaveLength(5);
  });

  it("finds what the skill would warn about, and says how to fix it", () => {
    expect(flowchartChecks(data())).toEqual([]);
    const messy = data(`flowchart
  subgraph lane_p["Process"]
    a["Do The Whole Thing For The Customer Now"]
    b{"Approved"}
    c["Ship"]
    d["Ship"]
  end
  a -->|"Yes"| b
  b --> c
  b -->|"No"| d
  n1>"Ship"] -.- c
`);
    const checks = flowchartChecks(messy).join("\n");
    expect(checks).toMatch(/Lane "Process" is not an actor/);
    expect(checks).toMatch(/has 8 words/);
    expect(checks).toMatch(/should end with "\?"/);
    expect(checks).toMatch(/1 unlabelled branch/);
    expect(checks).toMatch(/says "Yes" but leaves a task/);
    expect(checks).toMatch(/both "Ship"/);
    expect(checks).toMatch(/no start/);
    expect(checks).toMatch(/repeats its step's label/);
    expect(checkNote([])).toBe("");
    expect(checkNote(["A", "B"])).toMatch(/change_diagram[\s\S]*- A\n- B$/);
    expect(() => readFlowchartSource("flowchart\n  a[[[")).toThrow(
      /couldn't be read/,
    );
  });
});
