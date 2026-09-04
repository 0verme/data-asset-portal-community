import type { ReactNode } from 'react';

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): ReactNode {
  return <div className="app">{children}</div>;
}
