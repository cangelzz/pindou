import { useTranslation } from "react-i18next";
import type { ColorAdjustments } from "../../utils/colorAdjust";
import { IDENTITY_ADJUSTMENTS, isIdentity } from "../../utils/colorAdjust";

const SLIDERS: (keyof ColorAdjustments)[] = [
  "exposure", "contrast", "saturation", "vibrance", "temperature", "tint",
];

interface ColorAdjustPanelProps {
  value: ColorAdjustments;
  onChange: (next: ColorAdjustments) => void;
}

export function ColorAdjustPanel({ value, onChange }: ColorAdjustPanelProps) {
  const { t } = useTranslation();
  const setKey = (key: keyof ColorAdjustments, v: number) => {
    onChange({ ...value, [key]: Math.max(-100, Math.min(100, Math.round(v))) });
  };

  return (
    <div className="space-y-2" data-testid="color-adjust-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{t(isIdentity(value) ? "import.image.adjust.none" : "import.image.adjust.changed")}</span>
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline disabled:text-gray-300"
          disabled={isIdentity(value)}
          onClick={() => onChange({ ...IDENTITY_ADJUSTMENTS })}
        >
          {t("import.image.adjust.resetAll")}
        </button>
      </div>
      {SLIDERS.map((key) => {
        const label = t(`import.image.adjust.${key}`);
        return <div key={key} className="flex items-center gap-2">
          <label className="w-16 text-xs text-gray-700">{label}</label>
          <input
            type="range"
            min={-100}
            max={100}
            value={value[key]}
            onChange={(e) => setKey(key, Number(e.target.value))}
            onDoubleClick={() => setKey(key, 0)}
            className="flex-1"
            aria-label={label}
          />
          <input
            type="number"
            min={-100}
            max={100}
            value={value[key]}
            onChange={(e) => setKey(key, Number(e.target.value))}
            className="w-12 text-xs border rounded px-1 py-0.5"
            aria-label={t("import.image.adjust.value", { label })}
          />
        </div>;
      })}
    </div>
  );
}
