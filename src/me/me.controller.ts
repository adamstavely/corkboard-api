import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { CurrentUser } from '../auth/current-user';
import { InjectDb, type Db } from '../db/db.module';
import { users, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { SiteAdmins } from '../site/site-admins';
import { MeDto, UpdateMeDto } from './me.dto';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly orgs: OrgsService,
    @InjectDb() private readonly db: Db,
    private readonly siteAdmins: SiteAdmins,
  ) {}

  @Get()
  async me(@CurrentUser() user: User): Promise<MeDto> {
    return this.#dto(user);
  }

  /** Changes your own settings. */
  @Patch()
  async update(@CurrentUser() user: User, @Body() body: UpdateMeDto): Promise<MeDto> {
    const [row] = body.assistantAsksFirst === undefined ? [user] : await this.db.update(users).set({ assistantAsksFirst: body.assistantAsksFirst }).where(eq(users.id, user.id)).returning();
    return this.#dto(row);
  }

  async #dto(user: User): Promise<MeDto> {
    return { id: user.id, name: user.name, email: user.email, orgs: await this.orgs.forUser(user.id), assistantAsksFirst: user.assistantAsksFirst, siteAdmin: this.siteAdmins.is(user) };
  }
}
