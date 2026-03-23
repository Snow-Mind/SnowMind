import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "SnowMind terms of service.",
};

export default function TermsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Terms of Service</h1>
      <p className="text-snow-muted">Content coming soon.</p>
    </article>
  );
}
