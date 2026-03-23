import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Teams",
  description: "Meet the SnowMind team.",
};

export default function TeamsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Teams</h1>
      <p className="text-snow-muted">Content coming soon.</p>
    </article>
  );
}
