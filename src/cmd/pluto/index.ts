import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pluto-backend' });
});

app.listen(PORT, () => {
  console.log(`Pluto backend running on port ${PORT}`);
});
