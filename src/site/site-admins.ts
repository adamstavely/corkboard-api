import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '../db/schema';

/**
 * Corkboard's own admins (SITE_ADMIN_EMAILS): they look after what every workspace shares, the AI connections and the
 * cloud icon library. That is all being one allows: it opens no workspace or board, and nothing a site admin sees says
 * which workspaces exist or what they use. Like anyone, they're on a board or in a workspace only when invited.
 */
@Injectable()
export class SiteAdmins {
  readonly #emails: ReadonlySet<string>;

  constructor(config: ConfigService) {
    this.#emails = new Set(config.get<string[]>('siteAdmins') ?? []);
  }

  is(user: User): boolean {
    return !!user.email && this.#emails.has(user.email.toLowerCase());
  }

  require(user: User): void {
    if (!this.is(user)) throw new ForbiddenException("Only Corkboard's site admins can do that.");
  }
}
