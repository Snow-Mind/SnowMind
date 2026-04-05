import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the SnowMind team.",
};

export default function ContactPage() {
  return (
    <article className="prose max-w-none">
      <h1>Contact</h1>
      <p className="text-snow-muted">Content coming soon.</p>
    </article>
  );
}
