import { requirePattern } from './validate';
import type { MiroBoardCitation } from './types';

const BOARD_ID = /^[A-Za-z0-9_=-]{4,64}$/;

export function miroBoardUrl(citation: MiroBoardCitation): string {
  const boardId = requirePattern(citation.boardId, BOARD_ID, 'boardId');
  return `https://miro.com/app/board/${boardId}/`;
}
