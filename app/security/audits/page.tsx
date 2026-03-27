import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audits",
  description: "How SnowMind relies on audited on-chain infrastructure and audited lending integrations.",
};

export default function AuditsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Audits</h1>
      <p className="lead">
        SnowMind builds on audited, production-grade account abstraction and connects only to
        lending and yield venues that meet our bar for independent security review.
      </p>

      <h2>Integrated protocol audits</h2>
      <p>
        Every integration SnowMind routes capital through is backed by completed third-party
        audits and ongoing operational vetting. For how we score and compare integrations, see
        the Protocol Assessment page.
      </p>

      <h2>SnowMind and ZeroDev</h2>
      <p>
        SnowMind uses <strong>ZeroDev Kernel v3.1</strong> smart accounts (ERC-4337 account
        abstraction and ERC-7579 modular accounts). User funds live in those contracts; the
        Kernel and permission stack are maintained and audited by ZeroDev and widely deployed
        in production.
      </p>
      <p>
        Agent automation runs through <strong>scoped session keys</strong> whose allowances
        are enforced on-chain—so the backend cannot exceed the policies users approve.
        Optimization, risk checks, rate logic, and explainability stay <strong>off-chain</strong>,
        which keeps SnowMind&apos;s custom surface area out of high-value on-chain code paths and
        shrinks the attack surface we own directly.
      </p>
      <p>
        SnowMind does not ship a full alternative lending stack on-chain. Yield execution is
        delegated to established, audited protocols.
      </p>

      <h3>Audit Reports (ZeroDev)</h3>
      <p>Relevant audits:</p>
      <ul>
        <li>
          <a
            href="https://github.com/zerodevapp/kernel/blob/dev/audits/chainlight_v3_0.pdf"
            rel="noopener noreferrer"
            target="_blank"
          >
            chainlight_v3_0.pdf
          </a>
        </li>
        <li>
          <a
            href="https://github.com/zerodevapp/kernel/blob/dev/audits/v_3_1_incremental_audit.pdf"
            rel="noopener noreferrer"
            target="_blank"
          >
            v_3_1_incremental_audit.pdf
          </a>
        </li>
        <li>
          <a
            href="https://github.com/zerodevapp/kernel/blob/dev/audits/kalos_v3_plugins.pdf"
            rel="noopener noreferrer"
            target="_blank"
          >
            kalos_v3_plugins.pdf
          </a>
        </li>
      </ul>
    </article>
  );
}
