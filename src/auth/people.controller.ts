import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './auth.guard';
import { CreatePersonDto, PersonDto } from './people.dto';
import { UsersService } from './users.service';

const person = ({ id, name, email }: PersonDto): PersonDto => ({ id, name, email });

/** Who's here, for the development "who are you?" picker. Open to anyone, and only while the picker is on. */
@ApiTags('people')
@Public()
@Controller('people')
export class PeopleController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(): Promise<PersonDto[]> {
    this.#pickerOnly();
    return (await this.users.list()).map(person);
  }

  /** Adds someone to pick; their id is then their bearer token. */
  @Post()
  async create(@Body() body: CreatePersonDto): Promise<PersonDto> {
    this.#pickerOnly();
    return person(await this.users.create(body.name, body.email));
  }

  #pickerOnly(): void {
    if (!this.users.pickerOn) throw new NotFoundException('Sign in with a passkey');
  }
}
