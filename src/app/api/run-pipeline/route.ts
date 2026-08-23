import { NextResponse } from 'next/server';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 60_000;

let running = false;
let activeProcess: ChildProcess | null = null;

export interface PipelineResult {
  success: boolean;
  output: string;
  sourcesUpdated: string[];
  sourcesFailed: string[];
  durationMs: number;
}

function parseOutput(stdout: string): { sourcesUpdated: string[]; sourcesFailed: string[] } {
  const sourcesUpdated: string[] = [];
  const sourcesFailed: string[] = [];
  for (const line of stdout.split('\n')) {
    const ok = line.match(/\[ok\]\s+([a-z_0-9]+):/);
    if (ok) { sourcesUpdated.push(ok[1]); continue; }
    const skip = line.match(/\[skip\]\s+([a-z_0-9]+):\s*(.*)/);
    if (skip) { sourcesFailed.push(`${skip[1]}: ${skip[2].trim()}`); }
  }
  return { sourcesUpdated, sourcesFailed };
}

export async function POST() {
  if (running) {
    return NextResponse.json({ success: false, output: 'Pipeline already running.', sourcesUpdated: [], sourcesFailed: [], durationMs: 0 }, { status: 409 });
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    return NextResponse.json({ success: false, output: 'SUPABASE_DB_URL not configured on the server. Add it to .env.local.', sourcesUpdated: [], sourcesFailed: [], durationMs: 0 }, { status: 500 });
  }

  running = true;
  const start = Date.now();

  return new Promise<Response>((resolve) => {
    const cwd = path.join(process.cwd(), 'scraper');
    const child = spawn('python', ['run.py'], {
      cwd,
      env: { ...process.env, SUPABASE_DB_URL: dbUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeProcess = child;

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      running = false;
      activeProcess = null;
      const { sourcesUpdated, sourcesFailed } = parseOutput(stdout);
      resolve(NextResponse.json({
        success: false,
        output: `Pipeline timed out after ${TIMEOUT_MS / 1000}s.\n${stdout}\n${stderr}`.trim(),
        sourcesUpdated,
        sourcesFailed,
        durationMs: Date.now() - start,
      }, { status: 500 }));
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      running = false;
      activeProcess = null;
      const durationMs = Date.now() - start;
      const { sourcesUpdated, sourcesFailed } = parseOutput(stdout);
      const success = code === 0;
      resolve(NextResponse.json({
        success,
        output: stdout + (stderr ? `\nSTDERR:\n${stderr}` : ''),
        sourcesUpdated,
        sourcesFailed,
        durationMs,
      }, { status: success ? 200 : 500 }));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      running = false;
      activeProcess = null;
      resolve(NextResponse.json({
        success: false,
        output: `Failed to spawn process: ${err.message}`,
        sourcesUpdated: [],
        sourcesFailed: [],
        durationMs: Date.now() - start,
      }, { status: 500 }));
    });
  });
}
