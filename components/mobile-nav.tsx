"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronRight } from "lucide-react";
import { navigation } from "@/lib/navigation";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of navigation) {
      const hasActive = group.items.some((item) => pathname === item.href);
      initial[group.title] = hasActive;
    }
    return initial;
  });

  useEffect(() => {
    for (const group of navigation) {
      if (group.items.some((item) => pathname === item.href)) {
        setOpenGroups((prev) => ({ ...prev, [group.title]: true }));
      }
    }
  }, [pathname]);

  // Close the mobile drawer after navigation completes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function toggleGroup(title: string) {
    setOpenGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  }

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-snow-text hover:text-snow-red transition-colors"
        aria-label="Toggle menu"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[57px] z-50 h-[calc(100dvh-57px)] border-b border-snow-border bg-snow-surface overflow-y-auto">
          <div className="p-4 space-y-1">
            {navigation.map((group) => {
              const isGroupOpen = openGroups[group.title] ?? false;
              const hasActive = group.items.some((item) => pathname === item.href);

              return (
                <div key={group.title}>
                  <button
                    onClick={() => toggleGroup(group.title)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                      hasActive
                        ? "text-snow-text bg-snow-border/40"
                        : "text-snow-text hover:bg-snow-border/30"
                    }`}
                  >
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 text-snow-muted transition-transform duration-200 ${
                        isGroupOpen ? "rotate-90" : ""
                      }`}
                    />
                    {group.title}
                  </button>

                  <div
                    className={`overflow-hidden transition-all duration-200 ${
                      isGroupOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                    }`}
                  >
                    <ul className="mt-0.5 ml-3 border-l border-snow-border pl-3 space-y-0.5 pb-2">
                      {group.items.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={() => setOpen(false)}
                              className={`block rounded-md px-3 py-2 text-[13px] transition-colors ${
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
        </div>
      )}
    </div>
  );
}
