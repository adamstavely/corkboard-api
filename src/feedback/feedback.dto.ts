import { IsBoolean, IsIn } from 'class-validator';

const VISIBILITIES = ['names', 'anonymous', 'own'] as const;

export class FeedbackLinkDto {
  /** The secret in the link: /feedback/<token>. */
  token!: string;
  /** What participants see of each other: everyone's feedback by name, everyone's without names, or only their own. */
  visibility!: 'names' | 'anonymous' | 'own';
  createdAt!: number;
}

/** Someone from outside the team who joined through the feedback link, as the team sees them. */
export class ParticipantDto {
  userId!: string;
  name!: string;
  /** Other participants see "Participant <pseudonym>" when names are hidden. */
  pseudonym!: number;
  joinedAt!: number;
  blocked!: boolean;
}

export class FeedbackDto {
  /** The live feedback link; null when the board isn't open for feedback. */
  link!: FeedbackLinkDto | null;
  participants!: ParticipantDto[];
}

export class OpenFeedbackDto {
  @IsIn(VISIBILITIES)
  visibility!: 'names' | 'anonymous' | 'own';
}

export class BlockParticipantDto {
  @IsBoolean()
  blocked!: boolean;
}

/** Who you are to the others on the board, as a participant. */
export class FeedbackYouDto {
  pseudonym!: number;
  /** Your own name, which other participants see only when the board shows names. */
  name!: string;
}

export class FeedbackJoinDto {
  boardId!: string;
  title!: string;
  visibility!: 'names' | 'anonymous' | 'own';
  /** Already in the board's workspace: open the board itself instead. */
  member!: boolean;
  /** Null for a workspace member. */
  you!: FeedbackYouDto | null;
}
