export function FormSection({ title, children }) {
  return (
    <section className="system-form-section" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
