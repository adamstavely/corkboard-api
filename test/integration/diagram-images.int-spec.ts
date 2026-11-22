import { randomUUID } from "node:crypto";
import { HocuspocusProvider } from "@hocuspocus/provider";
import request from "supertest";
import * as Y from "yjs";
import {
  fetchImage,
  IMAGE_FETCH,
  type ImageFetch,
} from "../../src/unfurl/unfurl";
import { createTestApp, type TestApp } from "./app";

// The smallest PNG: one transparent pixel.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const fetched: string[] = [];

/** The web as tests see it: one picture; every other address is fetched for real, so private ones are refused. */
const images: ImageFetch = (url) => {
  fetched.push(url);
  return url === "https://pics.example/logo.png"
    ? Promise.resolve({ type: "image/png", data: PNG })
    : fetchImage(url);
};

describe("Pictures for diagrams", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ providers: [[IMAGE_FETCH, images]] });
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function setup() {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID());
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get("/me").set(auth);
    const { body: board } = await request(server)
      .post(`/orgs/${me.orgs[0].id}/boards`)
      .set(auth)
      .send({ title: "B" });
    return { server, auth, token, board };
  }

  /** Puts a diagram on the board as the board does. */
  async function drawOn(boardId: string, token: string, source: string) {
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({
        url: t.collabUrl,
        name: boardId,
        token,
        document: doc,
        onSynced: (): void => resolve(p),
      });
    });
    const node = new Y.Map<unknown>();
    doc.getMap("nodes").set(randomUUID(), node);
    for (const [k, v] of Object.entries({
      kind: "diagram",
      x: 0,
      y: 0,
      w: 480,
      h: 360,
      z: 1,
      source,
    }))
      node.set(k, v);
    await new Promise((r) => setTimeout(r, 300));
    return provider;
  }

  it("gives signed-in people a picture from a public https address, as a picture", async () => {
    const { server, auth } = await setup();
    const got = await request(server)
      .post("/diagram-image")
      .set(auth)
      .send({ url: "https://pics.example/logo.png" })
      .expect(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(got.body as Buffer).equals(PNG)).toBe(true);

    await request(server)
      .post("/diagram-image")
      .send({ url: "https://pics.example/logo.png" })
      .expect(401);
    await request(server)
      .post("/diagram-image")
      .set(auth)
      .send({ url: "http://pics.example/logo.png" })
      .expect(400);
    await request(server)
      .post("/diagram-image")
      .set(auth)
      .send({ url: "javascript:alert(1)" })
      .expect(400);
    const refused = await request(server)
      .post("/diagram-image")
      .set(auth)
      .send({ url: "https://127.0.0.1/admin.png" })
      .expect(400);
    expect(refused.body.message).toMatch(/not allowed/);
  });

  it("gives guests on a share link only the pictures the board's diagrams show, while the link is live", async () => {
    const { server, auth, token, board } = await setup();
    const provider = await drawOn(
      board.id,
      token,
      'flowchart TD\n  A@{ img: "https://pics.example/logo.png", label: "Logo" }\n  B@{ img: "https://127.0.0.1/inside.png" }',
    );
    const { body: link } = await request(server)
      .post(`/boards/${board.id}/links`)
      .set(auth)
      .send({})
      .expect(201);

    const got = await request(server)
      .post(`/shared/${link.token}/diagram-image`)
      .send({ url: "https://pics.example/logo.png" })
      .expect(200);
    expect(Buffer.from(got.body as Buffer).equals(PNG)).toBe(true);
    fetched.length = 0;
    await request(server)
      .post(`/shared/${link.token}/diagram-image`)
      .send({ url: "https://pics.example/other.png" })
      .expect(404);
    expect(fetched).toEqual([]);
    // In a diagram, but still never from a private address.
    await request(server)
      .post(`/shared/${link.token}/diagram-image`)
      .send({ url: "https://127.0.0.1/inside.png" })
      .expect(400);
    await request(server)
      .post("/shared/not-a-token/diagram-image")
      .send({ url: "https://pics.example/logo.png" })
      .expect(410);

    await request(server)
      .delete(`/boards/${board.id}/links/${link.id}`)
      .set(auth)
      .expect(204);
    await request(server)
      .post(`/shared/${link.token}/diagram-image`)
      .send({ url: "https://pics.example/logo.png" })
      .expect(410);
    provider.destroy();
  });
});
