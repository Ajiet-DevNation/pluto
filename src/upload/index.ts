import express from 'express';
import multer from 'multer';
import { transcribeAudio } from '../transcription/index.js';
import { indexMeetingTranscript } from '../db/index-meeting-transcripts.js';

const router = express.Router();

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

/**
 * Upload auth middleware.
 * Requires Authorization: Bearer <UPLOAD_TOKEN> header.
 * Returns 401 if missing or invalid.
 */
export function uploadAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = process.env.UPLOAD_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Upload token not configured' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const providedToken = authHeader.slice(7);
  if (providedToken !== token) {
    res.status(401).json({ error: 'Invalid upload token' });
    return;
  }

  next();
}

/**
 * POST /upload — Upload a meeting transcript or audio file.
 *
 * Accepts multipart/form-data with a `file` field.
 * - Audio files (.mp3, .wav, .ogg, .m4a, .webm): transcribed via Whisper synchronously,
 *   then stored as transcript. Buffer discarded after Whisper returns — NO disk, NO R2.
 * - Text files (.txt): stored directly as transcript.
 *
 * Optional query param: sourceUrl (e.g., Discord message link the upload originated from).
 * Required header: Authorization: Bearer <UPLOAD_TOKEN>
 *
 * Read-only boundary is untouched: no writes to GitHub, Discord, or Miro.
 */
router.post('/upload', uploadAuthMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const { originalname: filename, mimetype, buffer } = req.file;

    // Validate content type
    const isAudio = ALLOWED_AUDIO_TYPES.has(mimetype);
    const isText = mimetype === 'text/plain' || filename.endsWith('.txt');

    if (!isAudio && !isText) {
      res.status(400).json({ error: 'Unsupported file type. Use audio/* or text/plain' });
      return;
    }

    let transcript: string;
    let audioDurationSeconds: number | undefined;
    let language: string | undefined;

    if (isAudio) {
      const result = await transcribeAudio(buffer, filename);
      transcript = result.text;
    } else {
      transcript = buffer.toString('utf-8');
    }

    const title = filename.replace(/\.[^/.]+$/, ''); // strip extension
    const source = isAudio ? 'upload' : 'text-upload';
    const sourceUrl = (req.query.sourceUrl as string) || undefined;

    const { meetingId, chunks } = await indexMeetingTranscript({
      title,
      content: transcript,
      source,
      sourceUrl,
      audioFilename: isAudio ? filename : undefined,
      audioDurationSeconds,
      language,
    });

    res.status(201).json({
      meetingId,
      title,
      transcriptLength: transcript.length,
      chunksIndexed: chunks,
      source,
      sourceUrl,
    });
  } catch (error) {
    console.error('Upload failed:', error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Unknown error' });
    }
  }
});

export { router as uploadRouter };
