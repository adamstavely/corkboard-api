import { IsUrl, MaxLength } from "class-validator";

/** A picture a diagram shows, by its https address. */
export class DiagramImageRequestDto {
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(2000)
  url!: string;
}
