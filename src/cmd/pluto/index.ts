import express from 'express';
import dotenv from 'dotenv';
import { startDiscordBot } from '../../discord/bot';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pluto-backend' });
});

const server = app.listen(PORT, () => {
  console.log(`Pluto backend running on port ${PORT}`);
});

let shutdownBot: (() => Promise<void>) | undefined;

startDiscordBot()
  .then((bot) => {
    shutdownBot = bot.shutdown;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Pluto Discord bot failed to start: ${message}`);
    server.close();
    process.exitCode = 1;
  });

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down Pluto`);
  server.close();
  if (shutdownBot) {
    await shutdownBot();
  }
  process.exit(0);
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
