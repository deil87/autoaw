"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AutoAWLogo } from "@/components/autoaw-logo";

const links = [
  { href: "/experiments", label: "Experiments" },
  { href: "/datasets", label: "Datasets" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b bg-background">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/experiments" className="flex items-center gap-2">
          <AutoAWLogo width={72} height={36} />
          <span className="font-semibold text-lg tracking-tight">AutoAW</span>
        </Link>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "text-sm text-muted-foreground hover:text-foreground transition-colors",
              pathname.startsWith(link.href) && "text-foreground font-medium"
            )}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
