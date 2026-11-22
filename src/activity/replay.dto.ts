import { BoardEventDto } from './activity.dto';

/** A point in a board's history that replay can show. */
export class ReplayFrameDto {
  id!: string;
  /** Epoch ms. */
  at!: number;
  /** A snapshot kept while people edit, or a saved version. */
  kind!: 'snapshot' | 'version';
  /** A version's name; null for snapshots. */
  label!: string | null;
}

/** Everything replay can show of a board, oldest first, and what people did meanwhile. */
export class ReplayDto {
  frames!: ReplayFrameDto[];
  /** What happened from the first point on, oldest first. */
  events!: BoardEventDto[];
  /** The point "this session" starts from: the board as it was when the last stretch of editing (or agenda) began. */
  sessionStartId!: string | null;
}

export class ReplayStateDto {
  /** The point's id. */
  id!: string;
  /** A Yjs update, base64: the whole board for the first, only what changed since the one before for the rest. */
  update!: string;
}

/** The board at a run of consecutive points; apply the updates in order to see each. */
export class ReplayStatesDto {
  states!: ReplayStateDto[];
}
