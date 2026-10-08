import { Button, toast } from "../ui/index.ts";

export default function KumoToastFallbackFixture() {
  return (
    <main className="kumo-overlays-fixture">
      <h1>Kumo Toast Fallback Fixture</h1>
      <Button onClick={() => toast.warning("Toast host unavailable; alert fallback retained.")}>Show fallback toast</Button>
    </main>
  );
}
