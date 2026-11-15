import { TOOLS as ASSIST_TOOLS } from '../assist/assist.service';
import { TOOL as FILE_TOOL } from '../files/files.service';
import { TOOL as RECAP_TOOL } from '../summary/recap.service';
import { TOOL as SUMMARY_TOOL } from '../summary/summary.service';
import { CATCH_UP_TOOL } from '../summary/catchup.service';
import type { ToolDef } from './adapters/types';

/**
 * Where a schema breaks the rules strict tool calling holds it to (both adapters send strict: true; OpenAI's are the
 * tightest): every object lists all its properties as required and allows no others. An optional value is a required
 * one that may be null.
 */
function strictProblems(schema: unknown, path: string): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  const problems: string[] = [];
  const types = Array.isArray(s['type']) ? s['type'] : [s['type']];
  if (types.includes('object')) {
    const properties = (s['properties'] ?? {}) as Record<string, unknown>;
    const required = new Set((s['required'] ?? []) as string[]);
    for (const key of Object.keys(properties)) if (!required.has(key)) problems.push(`${path}.${key} is not required`);
    for (const key of required) if (!(key in properties)) problems.push(`${path} requires ${key}, which it doesn't have`);
    if (s['additionalProperties'] !== false) problems.push(`${path} allows other properties`);
    for (const [key, value] of Object.entries(properties)) problems.push(...strictProblems(value, `${path}.${key}`));
  }
  if (s['items']) problems.push(...strictProblems(s['items'], `${path}[]`));
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) for (const [i, v] of ((s[key] ?? []) as unknown[]).entries()) problems.push(...strictProblems(v, `${path}.${key}[${i}]`));
  return problems;
}

describe('the tools models are given', () => {
  const tools: ToolDef[] = [...ASSIST_TOOLS, FILE_TOOL, RECAP_TOOL, SUMMARY_TOOL, CATCH_UP_TOOL];

  it.each(tools.map((t) => [t.name, t] as const))('%s fits strict tool calling', (name, tool) => {
    expect(strictProblems(tool.parameters, name)).toEqual([]);
  });

  it('catches a schema that would be refused', () => {
    expect(strictProblems({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'object', properties: {} } }, required: ['a'] }, 't')).toEqual([
      't.b is not required',
      't allows other properties',
      't.b allows other properties',
    ]);
  });
});
