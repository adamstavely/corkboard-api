import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { MeDto } from './me.dto';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  async me(@CurrentUser() user: User): Promise<MeDto> {
    return { id: user.id, name: user.name, email: user.email, orgs: await this.orgs.forUser(user.id) };
  }
}
