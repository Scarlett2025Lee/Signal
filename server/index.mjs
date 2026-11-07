import { openDatabase, dataDirectory, projectRoot } from './database.mjs';
import { currentVersion } from '../scripts/update-core.mjs';
import { createApp } from './app.mjs';
import { createFundingService } from './funding.mjs';
import { createCompaniesService } from './companies.mjs';
import { createCrmService } from './crm.mjs';
import { createUpdateService } from './updates.mjs';

const port = Number(process.env.SIGNAL_PORT ?? 1421);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SIGNAL_PORT must be a port number.');
const db = openDatabase();
const funding = createFundingService(db);
const companies = createCompaniesService(db);
const crm = createCrmService(db);
const updates = createUpdateService({
  managed: process.env.SIGNAL_MANAGED_LAUNCHER === '1',
  requestRestart: () => {
    setTimeout(() => void shutdown(75), 500);
  },
});
const applicationVersion = await currentVersion(projectRoot);
const server = createApp(db, { funding, companies, crm, updates, applicationVersion });
server.on('error', error => {
  console.error(error.message);
  db.close();
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Signal website: http://127.0.0.1:${port}`);
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
