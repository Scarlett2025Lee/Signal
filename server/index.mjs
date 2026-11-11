import { openDatabase, dataDirectory, projectRoot } from './database.mjs';
import { currentVersion } from '../scripts/update-core.mjs';
import { createApp } from './app.mjs';
import { createFundingService } from './funding.mjs';
import { createCompaniesService } from './companies.mjs';
import { createCrmService } from './crm.mjs';
import { createEmailService } from './email.mjs';
import { createUpdateService } from './updates.mjs';
import { seedDemo } from './demo-data.mjs';

// SIGNAL_DEMO=1 runs the public demo: sample data in memory, no news fetching, no updater.
const demo = process.env.SIGNAL_DEMO === '1';
const host = process.env.SIGNAL_HOST ?? '127.0.0.1';
// Hosting platforms pass the port in PORT; the demo uses it when SIGNAL_PORT is not set.
const port = Number(process.env.SIGNAL_PORT ?? (demo ? process.env.PORT : undefined) ?? 1421);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SIGNAL_PORT must be a port number.');
if (!demo && !['127.0.0.1', 'localhost', '::1'].includes(host))
  throw new Error('Signal holds personal data, so only the demo (SIGNAL_DEMO=1) may listen on a public address.');
const db = demo ? openDatabase(':memory:') : openDatabase();
const DEMO_RESET = 6 * 3600000;
if (demo) {
  seedDemo(db);
  setInterval(() => seedDemo(db), DEMO_RESET).unref();
}
const funding = createFundingService(db);
const companies = createCompaniesService(db);
const crm = createCrmService(db);
const email = createEmailService(db);
const updates = demo
  ? undefined
  : createUpdateService({
      managed: process.env.SIGNAL_MANAGED_LAUNCHER === '1',
      requestRestart: () => {
        setTimeout(() => void shutdown(75), 500);
      },
    });
const applicationVersion = await currentVersion(projectRoot);
const server = createApp(db, { funding, companies, crm, email, updates, applicationVersion, demo });
server.on('error', error => {
  console.error(error.message);
  db.close();
  process.exit(1);
});
server.listen(port, host, () => {
  console.log(`Signal website: http://${host}:${port}`);
  if (demo) {
    console.log('Demo mode: sample data in memory, reset every 6 hours; news fetching is off.');
    return;
  }
  console.log(`Local data: ${dataDirectory()}`);
  funding.start();
});
let stopping = false;
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await funding.stop();
  server.close(() => {
    db.close();
    process.exit(exitCode);
  });
  server.closeIdleConnections();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
