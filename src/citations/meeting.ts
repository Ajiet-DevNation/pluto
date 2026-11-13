import { requireHttpUrl, requireNonEmpty } from './validate';
import type { MeetingTranscriptCitation } from './types';

/**
 * Meeting citations point at the stored transcript. The location is supplied by
 * the ingestion layer (L2) rather than invented here, so a citation either
 * carries a real link or it is rejected.
 */
export function meetingTranscriptUrl(citation: MeetingTranscriptCitation): string {
  const uri = requireHttpUrl(citation.uri, 'transcript uri');
  requireNonEmpty(citation.meetingId, 'meetingId');

  if (!citation.timestamp) {
    return uri;
  }

  const timestamp = requireNonEmpty(citation.timestamp, 'timestamp');
  const separator = uri.includes('#') ? '&' : '#';
  return `${uri}${separator}t=${encodeURIComponent(timestamp)}`;
}
