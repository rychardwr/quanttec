import { ReactNode } from 'react';

interface AlertProps {
  readonly tone: 'error' | 'info';
  readonly children: ReactNode;
}

export function Alert({ tone, children }: AlertProps) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
