import type { ReactNode } from "react";

export interface FormSectionProps {
  title: ReactNode;
  children?: ReactNode;
}

export function FormSection({ title, children }: FormSectionProps) {
  return (
    <section className="system-form-section" aria-label={typeof title === "string" ? title : undefined}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
