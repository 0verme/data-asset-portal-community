import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { Check, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "../i18n/LanguageSwitcher.tsx";
import { Button, Dialog, IconButton, Input, Tooltip } from "../ui/index.ts";
import { useAppearance } from "./AppearanceProvider.tsx";
import {
  generatedPresetSeeds, isAccentHex, type AccentPreset, type Density, type EffectsLevel, type ThemeMode,
} from "./preferences.ts";
import "./appearance-settings.css";

const themeModes = ["system", "light", "dark"] as const satisfies readonly ThemeMode[];
const presets = ["green", "blue", "purple", "orange"] as const satisfies readonly AccentPreset[];
const effectsLevels = ["full", "subtle", "off"] as const satisfies readonly EffectsLevel[];
const densities = ["comfortable", "compact"] as const satisfies readonly Density[];

function Choices<Value extends string>({
  label, options, value, onChange, renderOption, columns = options.length,
}: {
  label: string;
  options: readonly Value[];
  value: Value | undefined;
  onChange: (next: Value) => void;
  renderOption: (option: Value) => ReactNode;
  columns?: number;
}) {
  const name = useId();
  return (
    <fieldset className="appearance-choices">
      <legend>{label}</legend>
      <div className="appearance-options" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => (
          <label key={option} className="appearance-option">
            <input type="radio" name={name} checked={option === value} onChange={() => onChange(option)} />
            <span className="appearance-option-body">
              {renderOption(option)}
              <Check className="appearance-option-check" size={14} weight="bold" aria-hidden="true" />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SettingsContent() {
  const { t } = useTranslation("common", { keyPrefix: "appearance" });
  const { preference, effectiveEffects, setThemeMode, setAccent, setEffects, setDensity, reset } = useAppearance();
  const [draft, setDraft] = useState<{ text: string; accentValue: string }>();
  const hexId = useId();
  const accent = preference.accent;
  const custom = accent.kind === "custom";
  // A preference update can recreate the accent object without changing its value.
  const accentValue = custom ? accent.hex : accent.preset;
  const invalid = draft?.accentValue === accentValue;
  if (draft && !invalid) setDraft(undefined);

  return (
    <>
      <div className="appearance-scroll">
        <Choices label={t("themeMode")} options={themeModes} value={preference.themeMode}
          onChange={setThemeMode} renderOption={(mode) => t(`modes.${mode}`)} />

        <div className="appearance-colors">
          <Choices label={t("accent")} options={presets} value={custom ? undefined : accent.preset}
            columns={2}
            onChange={(preset) => {
              setDraft(undefined);
              setAccent({ kind: "preset", preset });
            }}
            renderOption={(preset) => (
              <>
                <span
                  aria-hidden="true"
                  className="appearance-swatch"
                  data-preset={preset}
                  style={preset === "blue" || preset === "orange" ? { backgroundColor: generatedPresetSeeds[preset] } : undefined}
                />
                {t(`presets.${preset}`)}
              </>
            )} />

          <label className="appearance-hex-label" id={`${hexId}-label`} htmlFor={hexId}>{t("custom")}</label>
          <div className="appearance-hex-row">
            <Input
              id={hexId}
              type="text"
              placeholder="#RRGGBB"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={invalid ? draft.text : (custom ? accent.hex.toUpperCase() : "")}
              aria-labelledby={`${hexId}-label`}
              aria-invalid={invalid}
              aria-describedby={`${hexId}-hint`}
              onChange={(event) => {
                const text = event.target.value;
                if (isAccentHex(text)) {
                  setDraft(undefined);
                  setAccent({ kind: "custom", hex: text });
                } else {
                  setDraft({ text, accentValue });
                }
              }}
            />
            <span className="appearance-effective-swatch" role="img" aria-label={t("effectiveAccent")} />
          </div>
          <p className="appearance-hex-hint" id={`${hexId}-hint`} aria-live="polite" data-invalid={invalid}>
            {invalid ? t("invalidHex") : t("hexHint")}
          </p>
        </div>

        <div>
          <Choices label={t("effects")} options={effectsLevels} value={preference.effects}
            onChange={setEffects} renderOption={(level) => t(`effectLevels.${level}`)} />
          {preference.effects !== effectiveEffects ? <p className="appearance-hint" role="status">{t("reducedMotion")}</p> : null}
        </div>

        <Choices label={t("density")} options={densities} value={preference.density}
          onChange={setDensity} renderOption={(density) => t(`densities.${density}`)} />
      </div>
      <div className="appearance-footer">
        <Button type="button" variant="secondary" onClick={() => { setDraft(undefined); reset(); }}>
          {t("restoreDefaults")}
        </Button>
        <LanguageSwitcher />
      </div>
    </>
  );
}

// On mobile the on-screen keyboard can shrink and pan the visual viewport
// without changing the layout viewport used by a fixed dialog.
function useDrawerViewport(open: boolean) {
  const [style, setStyle] = useState<CSSProperties>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const update = () => {
      setStyle({
        "--appearance-viewport-top": viewport.scale === 1 ? `${viewport.offsetTop}px` : undefined,
        "--appearance-viewport-height": viewport.scale === 1 ? `${viewport.height}px` : undefined,
      } as CSSProperties);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [open]);
  return style;
}

export function AppearanceSettings() {
  const { t } = useTranslation("common", { keyPrefix: "appearance" });
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const viewportStyle = useDrawerViewport(open);

  return (
    <>
      <Tooltip side="bottom" content={t("title")} trigger={
        <IconButton
          type="button"
          size="sm"
          className="appearance-trigger"
          aria-label={t("title")}
          aria-haspopup="dialog"
          aria-expanded={open}
          icon={<SlidersHorizontal size={18} aria-hidden="true" />}
          onClick={() => {
            setSession((current) => current + 1);
            setOpen(true);
          }}
        />
      } />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("title")}
        description={t("description")}
        size="sm"
        className="appearance-drawer"
        style={viewportStyle}
        titleAction={<IconButton
          type="button"
          variant="tertiary"
          className="appearance-close"
          aria-label={t("close")}
          icon={<X size={18} aria-hidden="true" />}
          onClick={() => setOpen(false)}
        />}
      >
        <SettingsContent key={session} />
      </Dialog>
    </>
  );
}
