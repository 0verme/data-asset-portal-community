export function MetaItem({ label, value, mono = false }) {
  return (
    <div className="mi">
      <div className="k">{label}</div>
      <div className={`v${mono ? " mono" : ""}`}>{value}</div>
    </div>
  );
}
