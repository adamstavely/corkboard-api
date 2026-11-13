import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './auth.guard';
import { CreatePersonDto, PersonDto } from './people.dto';
import { UsersService } from './users.service';

const person = ({ id, name, email }: PersonDto): PersonDto => ({ id, name, email });

/** Who's here, for the "who are you?" picker. Open to anyone: there's no sign-in. */
@ApiTags('people')
@Public()
@Controller('people')
export class PeopleController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(): Promise<PersonDto[]> {
    return (await this.users.list()).map(person);
  }

  /** Adds someone to pick; their id is then their bearer token. */
  @Post()
  async create(@Body() body: CreatePersonDto): Promise<PersonDto> {
    return person(await this.users.create(body.name, body.email));
  }
}
