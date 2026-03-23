import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "SnowMind privacy policy.",
};

export default function PrivacyPage() {
  return (
    <article className="prose max-w-none">
      <h1>Privacy Policy</h1>
      <p className="text-snow-muted">Content coming soon.</p>
    </article>
  );
}
