import { AlertTriangle, Info, CheckCircle2 } from "lucide-react";

type CalloutVariant = "info" | "warning" | "success";

const variants: Record<CalloutVariant, { icon: typeof Info; bg: string; border: string; text: string; iconColor: string }> = {
  info: {
    icon: Info,
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    iconColor: "text-blue-600",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
    iconColor: "text-amber-600",
  },
  success: {
    icon: CheckCircle2,
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-800",
    iconColor: "text-emerald-600",
  },
};

export function Callout({
  variant = "info",
  title,
  children,
}: {
  variant?: CalloutVariant;
  title?: string;
  children: React.ReactNode;
}) {
  const v = variants[variant];
  const Icon = v.icon;

  return (
    <div className={`my-6 rounded-xl border ${v.border} ${v.bg} p-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${v.iconColor}`} />
        <div>
          {title && <p className={`font-semibold ${v.text}`}>{title}</p>}
          <div className={`text-sm ${v.text} ${title ? "mt-1" : ""}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}
