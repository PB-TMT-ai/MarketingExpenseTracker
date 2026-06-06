"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/periods", label: "Periods" },
  { href: "/plans", label: "Plans" },
  { href: "/items", label: "Items" },
  { href: "/actuals", label: "Actuals" },
] as const;

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {LINKS.map(({ href, label }) => {
        const isActive =
          pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "inline-flex min-h-11 items-center rounded-md border border-neutral-900 bg-neutral-900 px-3.5 font-medium text-white"
                : "inline-flex min-h-11 items-center rounded-md border border-neutral-200 px-3.5 hover:bg-neutral-50"
            }
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
