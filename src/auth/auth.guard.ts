import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UsersService } from './users.service';
import type { User } from '../db/schema';

const PUBLIC = 'corkboard:public';

/** Opens a route to callers without a token (health checks). */
export const Public = () => SetMetadata(PUBLIC, true);

export type AuthedRequest = Request & { user: User };

/** Every route needs a bearer token, the id of the person the caller picked, except those marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Pick who you are first');
    try {
      req.user = await this.users.byToken(token);
    } catch {
      throw new UnauthorizedException('Pick who you are first');
    }
    return true;
  }
}
