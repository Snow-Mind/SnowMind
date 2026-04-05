"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

interface AssistantMarkdownProps {
  content: string;
  className?: string;
}

export function AssistantMarkdown({ content, className }: AssistantMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={cn("space-y-2 text-[12px] leading-[1.5]", className)}
      components={{
        p: ({ children }) => (
          <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{children}</p>
        ),
        h1: ({ children }) => (
          <h1 className="mb-1 mt-2 text-[14px] font-semibold tracking-tight text-white first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-1 mt-2 text-[13px] font-semibold tracking-tight text-white first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1 mt-2 text-[12px] font-semibold text-white/95 first:mt-0">{children}</h3>
        ),
        ul: ({ children }) => (
          <ul className="my-2 list-disc space-y-1 pl-4 marker:text-white/65">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 list-decimal space-y-1 pl-4 marker:text-white/65">{children}</ol>
        ),
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-[#F15C5D]/55 bg-white/[0.03] pl-3 text-white/85">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[#FFB4B5] underline decoration-[#FFB4B5]/45 underline-offset-2 transition hover:text-white"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-lg border border-white/15 bg-black/20">
            <table className="min-w-full border-collapse text-[11px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
        tr: ({ children }) => <tr className="border-b border-white/10">{children}</tr>,
        th: ({ children }) => (
          <th className="px-2 py-1.5 text-left font-semibold text-white/95">{children}</th>
        ),
        td: ({ children }) => <td className="px-2 py-1.5 text-white/88">{children}</td>,
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-lg border border-white/15 bg-black/35 p-2 text-[11px] text-white/92">
            {children}
          </pre>
        ),
        code: ({ className: codeClassName, children }) => {
          if (typeof codeClassName === "string" && codeClassName.includes("language-")) {
            return <code className={codeClassName}>{children}</code>;
          }
          return (
            <code className="rounded bg-black/35 px-1 py-0.5 text-[11px] text-[#FFD9DA]">
              {children}
            </code>
          );
        },
        hr: () => <hr className="my-2 border-white/15" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
