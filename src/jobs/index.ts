import { PgBoss } from 'pg-boss';

export function createJobQueue(connectionString: string) {
  const boss = new PgBoss({
    connectionString,
    useListenNotify: false,
  });

  boss.on('error', (err: unknown) => {
    console.error('pg-boss error:', err);
  });

  return boss;
}

export async function ensureJobQueue(boss: PgBoss) {
  await boss.start();
  console.log('pg-boss job queue connected (polling mode)');
  return boss;
}
