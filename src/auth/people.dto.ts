import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

/** Someone to sign in as. */
export class PersonDto {
  id!: string;
  name!: string;
  email!: string;
}

export class CreatePersonDto {
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}
