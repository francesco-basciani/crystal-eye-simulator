import type { ComponentProps, ReactNode } from "react";
import { AppNav } from "./app-nav";

export function AppHeader({ current, children }: { current: ComponentProps<typeof AppNav>["current"]; children?: ReactNode }) {
  return <header className="topbar shared-app-header">
    <div className="brand">
      {/* Static project logo; preserve its intrinsic aspect ratio. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="brand-logo" src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/crystal-eye-logo.jpeg`} alt="Crystal Eye" width={760} height={558} />
      <div className="brand-copy"><strong>Crystal Eye</strong><span className="brand-subtitle">Orbital simulator</span></div>
    </div>
    <AppNav current={current} />
    {children}
  </header>;
}
