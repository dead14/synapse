import type { HTMLAttributes, ReactNode } from 'react';

interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div' | 'article' | 'aside';
  quiet?: boolean;
  children: ReactNode;
}

/** Card surface. One border, one radius, one shadow for every panel in the app. */
export default function Panel({ as: Tag = 'section', quiet, className = '', children, ...rest }: PanelProps) {
  return (
    <Tag className={`ds-panel${quiet ? ' ds-panel--quiet' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </Tag>
  );
}

interface PanelHeaderProps {
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Drops the tinted background — for headers that sit on a plain surface. */
  plain?: boolean;
  id?: string;
  className?: string;
}

export function PanelHeader({ eyebrow, title, subtitle, icon, actions, plain, id, className = '' }: PanelHeaderProps) {
  return (
    <header className={`ds-panel__header${plain ? ' ds-panel__header--plain' : ''}${className ? ` ${className}` : ''}`}>
      <div className="ds-row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', minWidth: 0 }}>
        {icon ? <span className="ds-panel__icon">{icon}</span> : null}
        <div className="ds-panel__heading">
          {eyebrow ? <p className="ds-panel__eyebrow">{eyebrow}</p> : null}
          <h3 className="ds-panel__title" id={id}>{title}</h3>
          {subtitle ? <p className="ds-panel__subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="ds-panel__actions">{actions}</div> : null}
    </header>
  );
}

interface PanelBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes padding — for tables and viewers that draw to the panel edge. */
  flush?: boolean;
  tight?: boolean;
  children: ReactNode;
}

export function PanelBody({ flush, tight, className = '', children, ...rest }: PanelBodyProps) {
  const modifier = flush ? ' ds-panel__body--flush' : tight ? ' ds-panel__body--tight' : '';
  return (
    <div className={`ds-panel__body${modifier}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}

export function PanelFooter({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`ds-panel__footer${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}
