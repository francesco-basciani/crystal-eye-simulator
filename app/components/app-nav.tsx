const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const links = [
  { href: "/", label: "SIMULATOR" },
  { href: "/ephemeris/", label: "EPHEMERIS" },
  { href: "/photon-history/", label: "PHOTON HISTORY" },
  { href: "/event-history/", label: "GRB EVENTS" },
] as const;

export function AppNav({ current }: { current: (typeof links)[number]["href"] }) {
  return (
    <nav className="app-nav" aria-label="Primary navigation">
      {links.map((link) => (
        <a
          key={link.href}
          href={`${PUBLIC_BASE_PATH}${link.href}`}
          aria-current={current === link.href ? "page" : undefined}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
