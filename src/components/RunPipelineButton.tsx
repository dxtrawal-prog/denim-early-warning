'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const COOLDOWN_MS = 5 * 60 * 1000;

interface RunResult {
  success: boolean;
  sourcesUpdated: string[];
  sourcesFailed: string[];
  durationMs: number;
  output: string;
}

function formatDuration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${s}s`;
}

function friendlySlug(s: string): string {
  const map: Record<string, string> = {
    cotton_spot_cai: 'CAI',
    cotton_spot_mcx: 'MCX',
    cotton_futures_ice: 'ICE',
    brent_crude: 'Brent',
    usd_inr: 'USD/INR',
    yarn_cotton_spread: 'Yarn-Cotton spread',
  };
  return map[s] ?? s;
}

export default function RunPipelineButton({
  lastPipelineRunAt,
  onRan,
}: {
  lastPipelineRunAt: string | null;
  onRan: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!lastPipelineRunAt) return;
    const elapsed = Date.now() - new Date(lastPipelineRunAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      setCooldown(COOLDOWN_MS - elapsed);
    }
  }, [lastPipelineRunAt]);

  useEffect(() => {
    if (cooldown <= 0) {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
      return;
    }
    cooldownTimer.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1000) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, [cooldown > 0]);

  const handleClick = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/run-pipeline', { method: 'POST' });
      const data: RunResult = await res.json();
      setResult(data);
      if (data.success) {
        setCooldown(COOLDOWN_MS);
        onRan();
      }
    } catch (err) {
      setResult({ success: false, sourcesUpdated: [], sourcesFailed: [], durationMs: 0, output: String(err) });
    } finally {
      setRunning(false);
    }
  }, [onRan]);

  const disabled = running || cooldown > 0;

  return (
    <div className="pipeline-section">
      <div className="pipeline-row">
        <button
          className="btn-pipeline"
          disabled={disabled}
          onClick={handleClick}
        >
          {running ? (
            <><span className="spinner" /> Fetching live prices…</>
          ) : cooldown > 0 ? (
            <>Next run in {formatDuration(cooldown)}</>
          ) : (
            'Run Data Pipeline Now'
          )}
        </button>
      </div>

      {result && (
        <div className={`pipeline-result ${result.success ? 'ok' : 'err'}`}>
          {result.success ? (
            <>
              Updated {result.sourcesUpdated.length} source{result.sourcesUpdated.length !== 1 ? 's' : ''} in {formatDuration(result.durationMs)}:
              {' '}{result.sourcesUpdated.map(friendlySlug).join(', ')}
            </>
          ) : (
            <>
              Pipeline failed in {formatDuration(result.durationMs)}.
              {result.sourcesFailed.length > 0 && (
                <> Failed: {result.sourcesFailed.map((f) => {
                  const [slug, ...rest] = f.split(': ');
                  return `${friendlySlug(slug)}: ${rest.join(': ')}`;
                }).join('; ')}</>
              )}
              {!result.sourcesFailed.length && (
                <> {result.output.slice(0, 200)}</>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
