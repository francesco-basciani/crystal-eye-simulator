"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./app-nav.module.css";

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const primaryLinks = [
  { href: "/", label: "Simulator" },
  { href: "/sky-localization/", label: "Sky localization" },
] as const;
const dataLinks = [
  { href: "/event-history/", label: "GRB events" },
  { href: "/photon-history/", label: "Photon history" },
  { href: "/ephemeris/", label: "Ephemeris" },
] as const;
type AppRoute = (typeof primaryLinks)[number]["href"] | (typeof dataLinks)[number]["href"];

export function AppNav({ current }: { current: AppRoute }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const requestedFocus = useRef<number | null>(null);
  const dataCurrent = dataLinks.some(link => link.href === current);

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      if (requestedFocus.current != null) itemRefs.current[requestedFocus.current]?.focus();
      requestedFocus.current = null;
    });
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdownRef.current?.contains(event.target)) setOpen(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      requestedFocus.current = null;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const navigateDropdown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const currentIndex = itemRefs.current.findIndex(item => item === document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? dataLinks.length - 1
      : event.key === "ArrowDown" ? (currentIndex + 1) % dataLinks.length
      : currentIndex <= 0 ? dataLinks.length - 1 : currentIndex - 1;
    if (open) itemRefs.current[index]?.focus();
    else { requestedFocus.current = index; setOpen(true); }
  };

  return <nav className={`app-nav ${styles.navigation}`} aria-label="Primary navigation">
    {primaryLinks.map(link => <a key={link.href} href={`${PUBLIC_BASE_PATH}${link.href}`} aria-current={current === link.href ? "page" : undefined}>{link.label}</a>)}
    <div ref={dropdownRef} className={styles.dropdown} onKeyDown={navigateDropdown} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button ref={buttonRef} type="button" className={styles.dataButton} aria-expanded={open} aria-controls={menuId} aria-current={dataCurrent ? "true" : undefined} onClick={() => setOpen(value => !value)}>
        Data <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={open ? styles.chevronOpen : undefined}><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <ul id={menuId} className={styles.menu} hidden={!open} aria-label="Data pages">
        {dataLinks.map((link, index) => <li key={link.href}><a ref={element => { itemRefs.current[index] = element; }} href={`${PUBLIC_BASE_PATH}${link.href}`} aria-current={current === link.href ? "page" : undefined} onClick={() => setOpen(false)}>{link.label}</a></li>)}
      </ul>
    </div>
  </nav>;
}
