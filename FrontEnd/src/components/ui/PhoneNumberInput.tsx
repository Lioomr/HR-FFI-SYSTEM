import { useEffect, useState } from "react";
import { Input, Select, Space } from "antd";
import { COUNTRIES, getDialCodeByCountryCode } from "../../utils/countries";

type SizeType = "small" | "middle" | "large";

type Props = {
  /** Full phone number in E.164 form, e.g. "+966512345678". */
  value?: string;
  onChange?: (value: string) => void;
  size?: SizeType;
  disabled?: boolean;
  /** Country dial code used when no value is set yet. Defaults to KSA (+966). */
  defaultDialCode?: string;
  placeholder?: string;
};

const DEFAULT_DIAL = "+966";

/** Flag + dial-code options for the country selector (deduplicated by dial code). */
const dialOptions = COUNTRIES.flatMap((c) => {
  const dial = getDialCodeByCountryCode(c.code);
  if (!dial) return [];
  return [
    {
      value: dial,
      search: `${c.code} ${c.name} ${dial}`,
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            className={`fi fi-${c.code.toLowerCase()}`}
            aria-label={`${c.name} flag`}
            style={{
              width: 16,
              height: 12,
              borderRadius: 2,
              display: "inline-flex",
              backgroundSize: "cover",
              backgroundPosition: "center",
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
            }}
          />
          <span>{dial}</span>
        </span>
      ),
    },
  ];
}).filter((opt, index, arr) => arr.findIndex((x) => x.value === opt.value) === index);

/** Dial codes sorted longest-first so prefix matching picks the most specific one. */
const dialCodesByLength = dialOptions.map((o) => o.value).sort((a, b) => b.length - a.length);

function parsePhone(value: string | undefined, fallbackDial: string): { dial: string; local: string } {
  const raw = (value || "").trim();
  if (!raw.startsWith("+")) {
    return { dial: fallbackDial, local: raw.replace(/\D/g, "") };
  }
  const dial = dialCodesByLength.find((code) => raw.startsWith(code));
  if (dial) {
    return { dial, local: raw.slice(dial.length).replace(/\D/g, "") };
  }
  return { dial: fallbackDial, local: raw.replace(/\D/g, "") };
}

export default function PhoneNumberInput({
  value,
  onChange,
  size = "large",
  disabled,
  defaultDialCode = DEFAULT_DIAL,
  placeholder,
}: Props) {
  const initial = parsePhone(value, defaultDialCode);
  const [dial, setDial] = useState(initial.dial);
  const [local, setLocal] = useState(initial.local);

  // Re-sync when the value is changed externally (e.g. prefill or form reset).
  useEffect(() => {
    const composed = local ? `${dial}${local}` : "";
    if ((value || "") !== composed) {
      const parsed = parsePhone(value, defaultDialCode);
      setDial(parsed.dial);
      setLocal(parsed.local);
    }
    // Only react to external value changes; internal edits already call onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (nextDial: string, nextLocal: string) => {
    onChange?.(nextLocal ? `${nextDial}${nextLocal}` : "");
  };

  return (
    <Space.Compact style={{ width: "100%" }}>
      <Select
        style={{ width: 130, flex: "0 0 auto" }}
        size={size}
        disabled={disabled}
        showSearch
        optionFilterProp="search"
        popupMatchSelectWidth={false}
        value={dial}
        onChange={(nextDial) => {
          setDial(nextDial);
          emit(nextDial, local);
        }}
        options={dialOptions}
      />
      <Input
        size={size}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="tel"
        inputMode="tel"
        value={local}
        onChange={(e) => {
          const nextLocal = e.target.value.replace(/\D/g, "");
          setLocal(nextLocal);
          emit(dial, nextLocal);
        }}
      />
    </Space.Compact>
  );
}
