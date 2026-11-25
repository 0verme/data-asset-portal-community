import type { ReactNode } from 'react';

export interface AppShellProps {
  children: ReactNode;
  isHome?: boolean | undefined;
}

export function AppShell({ children, isHome = false }: AppShellProps): ReactNode {
  return <div className={isHome ? 'app app--home' : 'app'}>{children}</div>;
}
