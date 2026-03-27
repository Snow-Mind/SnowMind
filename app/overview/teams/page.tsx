import type { Metadata } from "next";
import Image from "next/image";
import markPhoto from "@/team/mark.jpg";
import suyashPhoto from "@/team/suyash.jpg";

export const metadata: Metadata = {
  title: "Teams",
  description: "Meet the SnowMind team.",
};

export default function TeamsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Teams</h1>
      <p className="lead">
        SnowMind is built by a team focused on making autonomous, non-custodial
        DeFi infrastructure safer and easier to use.
      </p>

      <div className="not-prose mt-8 space-y-6">
        <section className="rounded-xl border border-snow-border bg-snow-surface p-5">
          <div className="flex flex-col gap-4 sm:flex-row">
            <Image
              src={markPhoto}
              alt="Shunsuke Mark Nakatani"
              className="h-28 w-28 rounded-xl object-cover"
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-snow-text">Shunsuke Mark Nakatani</h2>
              <p className="text-sm font-medium text-snow-red">Co-Founder and CEO</p>
              <p className="mt-2 text-sm leading-relaxed text-snow-muted">
                A dynamic young entrepreneur and visionary leader driving innovation at the
                intersection of Web3 and Artificial Intelligence. As Co-Founder and CEO, he
                leads SnowMind&apos;s strategy, product direction, and growth.
              </p>
              <p className="mt-2 text-sm text-snow-muted">
                Japan / University of Washington<br />
                President, UW Blockchain Society
              </p>
              <p className="mt-3 flex flex-wrap gap-4 text-sm">
                <a
                  href="https://x.com/Mark_Nakatani"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  X
                </a>
                <a
                  href="https://www.linkedin.com/in/mark-nakatani/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  LinkedIn
                </a>
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-snow-border bg-snow-surface p-5">
          <div className="flex flex-col gap-4 sm:flex-row">
            <Image
              src={suyashPhoto}
              alt="Suyash Kumar Singh"
              className="h-28 w-28 rounded-xl object-cover"
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-snow-text">Suyash Kumar Singh</h2>
              <p className="text-sm font-medium text-snow-red">Co-Founder &amp; CTO</p>
              <p className="mt-2 text-sm leading-relaxed text-snow-muted">
                A visionary technologist and entrepreneur passionate about harnessing cutting-edge
                technology to solve real-world challenges. He leads SnowMind&apos;s technical vision
                and development across AI, Web3, and blockchain systems.
              </p>
              <p className="mt-2 text-sm text-snow-muted">
                India / IIT Guwahati
              </p>
              <p className="mt-3 flex flex-wrap gap-4 text-sm">
                <a
                  href="https://x.com/blinderchief_"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  X
                </a>
                <a
                  href="https://www.linkedin.com/in/suyash-kumar-singh/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  LinkedIn
                </a>
              </p>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
