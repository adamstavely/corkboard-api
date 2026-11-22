/** What an access token may do. Each acts as its owner, within their access to each board. */
export const SCOPES = ['boards:read', 'boards:propose', 'comments:write'] as const;
export type Scope = (typeof SCOPES)[number];

/** What each scope lets an agent do, in the words the API's errors use. */
export const SCOPE_DOING: Record<Scope, string> = {
  'boards:read': 'read boards',
  'boards:propose': 'propose changes',
  'comments:write': 'comment',
};

/** Personal access tokens start with this, so they're never mistaken for a session or a picked person's id. */
export const TOKEN_PREFIX = 'cbp_';
