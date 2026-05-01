export type NavItem = {
  title: string;
  href: string;
  stub?: boolean;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const navigation: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { title: "Getting Started", href: "/overview/getting-started" },
      { title: "Teams", href: "/overview/teams", stub: true },
    ],
  },
  {
    title: "Learn",
    items: [
      { title: "Foundation", href: "/learn/foundation" },
      { title: "How SnowMind Works", href: "/learn/how-snowmind-works" },
      { title: "Risk Management", href: "/learn/risk-management" },
      { title: "Snow Optimizer", href: "/learn/snow-optimizer" },
      { title: "Protocol Assessment", href: "/learn/protocol-assessment" },
      { title: "Incentives", href: "/learn/incentives", stub: true },
    ],
  },
  {
    title: "Security",
    items: [
      { title: "Audits", href: "/security/audits" },
      { title: "Smart Accounts", href: "/security/smart-accounts" },
      { title: "Permissions & Keys", href: "/security/permissions-and-keys" },
    ],
  },
  {
    title: "Developers",
    items: [
      { title: "API Overview", href: "/developers/api-overview" },
      { title: "API Endpoints", href: "/developers/api-endpoints" },
      { title: "SDK Examples", href: "/developers/sdk-examples" },
    ],
  },
  {
    title: "Other",
    items: [
      { title: "FAQ", href: "/other/faq" },
      { title: "Contact", href: "/other/contact", stub: true },
      { title: "Terms", href: "/other/terms", stub: true },
      { title: "Privacy", href: "/other/privacy", stub: true },
    ],
  },
];
