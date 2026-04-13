import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function openExternalUrl(url: string): void {
  if (typeof window === "undefined") {
    return
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (opened) {
    opened.opener = null
    return
  }

  // Popup-blocker fallback (common in mobile in-app browsers).
  window.location.assign(url)
}
