"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DashboardNavigation({ items }: { items: readonly (readonly [string, string])[] }) {
  const pathname = usePathname();
  return <nav aria-label="Painel do profissional">{items.map(([label, href]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}</nav>;
}
