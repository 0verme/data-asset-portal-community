import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataOrb, type DataOrbProps } from "../../../src/components/portal/orb/DataOrb";

declare global {
  interface Window {
    updateOrb: (update: Partial<DataOrbProps> & { mounted?: boolean }) => void;
  }
}

function Fixture() {
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const effects = params.get("effects");
  const [props, setProps] = useState<DataOrbProps & { mounted: boolean }>({
    status: "idle",
    effects: effects === "off" || effects === "full" ? effects : "subtle",
    theme,
    mounted: true,
  });
  document.body.dataset.theme = props.theme;
  window.updateOrb = (update) => setProps((previous) => ({ ...previous, ...update }));
  return props.mounted && <DataOrb {...props} className="orb-fixture" />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
