import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Start drizzle-kit push
const child = spawn('pnpm.cmd', ['db:push'], {
    cwd: root,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true
});

// Send "create column" answers for all prompts
const answers = Array(20).fill('create column\n').join('');
child.stdin.write(answers);
child.stdin.end();

child.on('close', (code) => {
    process.exit(code ?? 0);
});
