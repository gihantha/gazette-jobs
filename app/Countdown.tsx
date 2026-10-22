import { daysUntil } from "@/lib/dates";

export function Countdown({
  closingDate,
  today,
}: {
  closingDate: string | null;
  today: string;
}) {
  if (!closingDate) return <span className="countdown none">Check source</span>;

  const d = daysUntil(closingDate, today);
  if (d <= 0) return <span className="countdown urgent">Closes today</span>;
  if (d === 1) return <span className="countdown urgent">1 day left</span>;
  if (d <= 3) return <span className="countdown urgent">{d} days left</span>;
  if (d <= 7) return <span className="countdown soon">{d} days left</span>;
  return <span className="countdown ok">{d} days left</span>;
}
