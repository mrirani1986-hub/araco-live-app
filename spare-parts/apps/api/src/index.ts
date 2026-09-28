import { env } from './env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { seedBase } from './import/seed.js';
import { closePdfBrowser } from './pdf/render.js';

await seedBase();
const server = createApp().listen(env.port, () => {
  console.log(`ARACO Spare Parts API listening on http://localhost:${env.port}`);
});

async function shutdown() {
  server.close();
  await closePdfBrowser();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
