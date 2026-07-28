import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'soft'
  | 'danger'
  | 'danger-solid';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a square button sized to the height scale. Pass an aria-label. */
  iconOnly?: boolean;
  block?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

function classes({ variant = 'primary', size = 'md', iconOnly, block, className }: CommonProps) {
  return [
    'ds-btn',
    `ds-btn--${variant}`,
    size === 'md' ? '' : `ds-btn--${size}`,
    iconOnly ? 'ds-btn--icon' : '',
    block ? 'ds-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

/**
 * The single button primitive. Replaces the three implementations the codebase
 * used to carry (`components/ui/button/Button`, `SynButton`, and inline Tailwind
 * strings), which is what made the same action look different on each step.
 */
export default function Button({
  variant,
  size,
  iconOnly,
  block,
  startIcon,
  endIcon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classes({ variant, size, iconOnly, block, className })} {...rest}>
      {startIcon}
      {children}
      {endIcon}
    </button>
  );
}

type LinkButtonProps = CommonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'>;

/** Same geometry as `Button`, for navigation and download targets. */
export function LinkButton({
  variant = 'secondary',
  size,
  iconOnly,
  block,
  startIcon,
  endIcon,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a className={classes({ variant, size, iconOnly, block, className })} {...rest}>
      {startIcon}
      {children}
      {endIcon}
    </a>
  );
}
