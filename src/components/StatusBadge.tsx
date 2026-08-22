export default function StatusBadge({
  status,
  label,
}: {
  status: string | null | undefined;
  label?: string;
}) {
  if (!status) return null;
  return <span className={`badge badge-${status}`}>{label ?? status}</span>;
}