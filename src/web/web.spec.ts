import { realWeb, resultsOf } from './web';

describe('web search', () => {
  it("reads Brave's and Tavily's answers into the same results, dropping ones that aren't web pages", () => {
    expect(resultsOf('brave', { web: { results: [{ title: 'The <strong>pilot</strong>', url: 'https://a.example/p', description: 'About <strong>it</strong>' }, { title: 'x', url: 'ftp://no' }] } })).toEqual([
      { title: 'The pilot', url: 'https://a.example/p', snippet: 'About it' },
    ]);
    expect(resultsOf('tavily', { results: [{ title: 'T', url: 'http://b.example', content: 'Body' }] })).toEqual([{ title: 'T', url: 'http://b.example', snippet: 'Body' }]);
    expect(resultsOf('brave', {})).toEqual([]);
    expect(resultsOf('tavily', { results: 'nope' })).toEqual([]);
  });

  it("asks each service the way it wants, with the workspace's key, and says plainly when the key is refused", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 200;
    const fake = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ web: { results: [] }, results: [] }), { status }));
    }) as unknown as typeof fetch;
    const web = realWeb(fake);
    await web.search('brave', 'test-key', 'pilot budget');
    expect(calls[0].url).toBe('https://api.search.brave.com/res/v1/web/search?q=pilot+budget&count=6');
    expect(calls[0].init.headers).toMatchObject({ 'X-Subscription-Token': 'test-key' });
    await web.search('tavily', 'test-key', 'pilot budget');
    expect(calls[1].url).toBe('https://api.tavily.com/search');
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ query: 'pilot budget', max_results: 6 });
    status = 401;
    await expect(web.search('brave', 'bad', 'x')).rejects.toThrow('key was refused');
    status = 500;
    await expect(web.search('brave', 'k', 'x')).rejects.toThrow('answered 500');
  });
});
