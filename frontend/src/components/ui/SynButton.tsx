import type { ButtonHTMLAttributes, ReactNode } from 'react';

type SynButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'solid' | 'lavender' | 'lime' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
};

export default function SynButton({
  variant = 'solid',
  size = 'md',
  className = '',
  children,
  ...props
}: SynButtonProps) {
  return (
    <button
      {...props}
      className={`syn-btn syn-btn--${variant} syn-btn--${size}${className ? ` ${className}` : ''}`}
    >
      {children}
    </button>
  );
}
