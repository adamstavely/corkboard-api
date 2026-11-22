import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './auth.guard';

/** The access token the caller came with, as AuthGuard resolved it (on @ForAgents routes). */
export const CurrentAgent = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().agent);
