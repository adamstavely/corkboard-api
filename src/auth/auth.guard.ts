import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { UsersService, hashToken } from './users.service';
import type { User } from '../db/schema';
import { TokenBuckets } from '../tokens/rate-limit';
import { SCOPE_DOING, TOKEN_PREFIX, type Scope } from '../tokens/scopes';
import { TokensService, type Agent } from '../tokens/tokens.service';

const PUBLIC = 'corkboard:public';
const AGENT = 'corkboard:agent';

/** Opens a route to callers without a token (health checks). */
export const Public = () => SetMetadata(PUBLIC, true);

/**
 * Marks a route of the agent API: it takes a personal access token (and only that), with these scopes. Every other
 * route refuses access tokens, so a token can never make tokens, change settings or open the collaboration socket.
 */
export const ForAgents = (...scopes: Scope[]) => SetMetadata(AGENT, scopes);

/** `agent` is set when the caller came with an access token. */
export type AuthedRequest = Request & { user: User; agent?: Agent };

/** The scope a token lacks, as a 403. */
export const missingScope = (scope: Scope) => new ForbiddenException(`This access token can't ${SCOPE_DOING[scope]}: it needs the ${scope} scope. Make a token with it under Account, Access tokens.`);

/**
 * Every route needs a bearer token (a session's, or in development a picked person's id), except those marked @Public().
 * The agent API's routes (@ForAgents) take personal access tokens instead, each rate-limited.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  readonly #buckets = new TokenBuckets();

  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const agentScopes = this.reflector.getAllAndOverride<Scope[] | undefined>(AGENT, targets);

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException(agentScopes ? 'Send a personal access token: Authorization: Bearer cbp_…' : 'Sign in first');
    }

    if (token.startsWith(TOKEN_PREFIX)) {
      if (!agentScopes) throw new ForbiddenException('Access tokens only work on the agent API (/v1 and /mcp)');
      const wait = this.#buckets.take(hashToken(token));
      if (wait) {
        context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(wait));
        throw new HttpException(`Too many calls with this access token; try again in ${wait} second${wait === 1 ? '' : 's'}`, HttpStatus.TOO_MANY_REQUESTS);
      }
      try {
        Object.assign(req, await this.tokens.signin(token));
      } catch {
        throw new UnauthorizedException('That access token is unknown, revoked or expired');
      }
      const lacking = agentScopes.find((s) => !req.agent!.scopes.includes(s));
      if (lacking) throw missingScope(lacking);
      return true;
    }

    if (agentScopes) throw new UnauthorizedException('The agent API takes a personal access token (cbp_…); make one under Account, Access tokens');
    try {
      req.user = await this.users.byToken(token);
    } catch {
      throw new UnauthorizedException('Sign in first');
    }
    return true;
  }
}
