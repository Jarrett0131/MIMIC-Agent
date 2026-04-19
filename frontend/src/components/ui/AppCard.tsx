import type { ReactNode } from "react";

type AppCardProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function AppCard({
  title,
  subtitle,
  actions,
  children,
  className,
}: AppCardProps) {
  const classes = ["app-card", className].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <div className="app-card-header">
        <div>
          <h2 className="app-card-title">{title}</h2>
          {subtitle && <p className="app-card-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="app-card-actions">{actions}</div>}
      </div>
      <div className="app-card-body">{children}</div>
    </section>
  );
}
