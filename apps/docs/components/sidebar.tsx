"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { navigation } from "@/lib/navigation";

export function Sidebar() {
  const pathname = usePathname();

  // Auto-open the group that contains the active page
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of navigation) {
      const hasActive = group.items.some((item) => pathname === item.href);
      initial[group.title] = hasActive;
    }
    return initial;
  });

  // Keep group open when navigating within it
  useEffect(() => {
    for (const group of navigation) {
      if (group.items.some((item) => pathname === item.href)) {
        setOpenGroups((prev) => ({ ...prev, [group.title]: true }));
      }
    }
  }, [pathname]);

  function toggleGroup(title: string) {
    setOpenGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  }

  return (
    <nav className="w-64 shrink-0 border-r border-snow-border bg-snow-surface overflow-y-auto h-[calc(100vh-57px)] sticky top-[57px] hidden lg:block">
      <div className="p-4 space-y-1">
        {navigation.map((group) => {
          const isOpen = openGroups[group.title] ?? false;
          const hasActive = group.items.some((item) => pathname === item.href);

          return (
            <div key={group.title}>
              <button
                onClick={() => toggleGroup(group.title)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                  hasActive
                    ? "text-snow-text bg-snow-border/40"
                    : "text-snow-text hover:bg-snow-border/30"
                }`}
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-snow-muted transition-transform duration-200 ${
                    isOpen ? "rotate-90" : ""
                  }`}
                />
                {group.title}
              </button>

              <div
                className={`overflow-hidden transition-all duration-200 ${
                  isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <ul className="mt-0.5 ml-3 border-l border-snow-border pl-3 space-y-0.5 pb-2">
                  {group.items.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`block rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                            isActive
                              ? "bg-snow-red/10 text-snow-red font-medium"
                              : "text-snow-muted hover:text-snow-text hover:bg-snow-border/30"
                          }`}
                        >
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
