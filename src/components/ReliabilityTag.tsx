import type { Reliability } from '@/lib/types';

export default function ReliabilityTag({ r }: { r: Reliability }) {
  return <span className={`tag tag-${r}`}>{r}</span>;
}