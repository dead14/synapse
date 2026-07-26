import type { HTMLAttributes, ReactNode } from 'react';

type SynCardProps = HTMLAttributes<HTMLElement> & {
  tone?: 'default' | 'lavender' | 'lime' | 'ink';
  children: ReactNode;
};

export default function SynCard({ tone = 'default', className = '', children, ...props }: SynCardProps) {
  return (
    <article {...props} className={`syn-card syn-card--${tone}${className ? ` ${className}` : ''}`}>
      {children}
    </article>
  );
}
