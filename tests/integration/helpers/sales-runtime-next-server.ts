import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

export async function startSalesRuntimeNextServer(database: { ownerUrl: string; runtimeUrl: string; posFileRuntimeUrl?: string }) {
  if (!existsSync('.next/BUILD_ID')) throw new Error('Build the current product before testing Next runtime');
  const portProbe = createServer();
  await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const address = portProbe.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  await new Promise<void>(resolve => portProbe.close(() => resolve()));
  const baseURL = `http://127.0.0.1:${address.port}`;
  mkdirSync('.tmp', { recursive: true });
  const log = openSync('.tmp/sales-runtime-next-server.log', 'w');
  const child: ChildProcess = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(address.port)], {
    windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: database.ownerUrl,
      SALES_RUNTIME_DATABASE_URL: database.runtimeUrl, BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: randomUUID(), NEXT_PUBLIC_APP_URL: baseURL,
      POS_FILES_RUNTIME_DATABASE_URL: database.posFileRuntimeUrl,
      UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', RESEND_API_KEY: '', WASENDER_API_KEY: '', INNGEST_DEV: '1', NEXT_TELEMETRY_DISABLED: '1' },
  });
  closeSync(log);
  child.on('error', () => {});
  console.info(`Synthetic sales runtime Next PID ${child.pid}, ${baseURL}`);
  let closed = false;
  async function close() {
    if (closed) return;
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        const stop = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15_000 });
        await once(stop, 'exit');
      } else { child.kill('SIGTERM'); }
      if (child.exitCode === null && child.signalCode === null) await once(child, 'exit', { signal: AbortSignal.timeout(15_000) });
    }
    const deadline = Date.now() + 5000;
    while (true) {
      const listening = await new Promise<boolean>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: address.port });
        socket.setTimeout(1500);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); reject(new Error('Cannot verify Next shutdown')); });
        socket.once('error', error => {
          socket.destroy();
          if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve(false); else reject(error);
        });
      });
      if (!listening) break;
      if (Date.now() >= deadline) throw new Error('Fixture Next server still accepts connections');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    closed = true;
  }
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture Next exited before readiness');
      let status: number | undefined;
      try { status = (await fetch(`${baseURL}/api/auth/get-session`, { signal: AbortSignal.timeout(5000) })).status; }
      catch { /* Listener may still be starting. */ }
      if (status === 401) return { baseURL, close };
      if (status && status >= 500) throw new Error('Fixture Next auth probe failed; inspect .tmp/sales-runtime-next-server.log');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Fixture Next did not start within 90 seconds');
  } catch (error) { await close(); throw error; }
}
