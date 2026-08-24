import { Select } from "antd";

import { COUNTRIES } from "../../utils/countries";

type SizeType = "small" | "middle" | "large";

type Props = {
  /**
   * Country name, e.g. "Saudi Arabia". Names rather than ISO codes because
   * EmployeeProfile.nationality stores names, and an accepted offer copies this
   * value straight onto the profile.
   */
  value?: string;
  onChange?: (value: string) => void;
  /** Injected by antd's Form.Item so the item's <label for=...> resolves. */
  id?: string;
  size?: SizeType;
  disabled?: boolean;
  placeholder?: string;
};

const options = COUNTRIES.map((country) => ({
  value: country.name,
  // Searched against below; keeps the ISO code usable as a shortcut ("SA").
  search: `${country.name} ${country.code}`,
  // The label is JSX, so spell the plain name out for the option's tooltip and
  // for assistive technology.
  title: country.name,
  label: (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        className={`fi fi-${country.code.toLowerCase()}`}
        aria-label={`${country.name} flag`}
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
      <span>{country.name}</span>
    </span>
  ),
}));

/**
 * Scrollable, searchable country picker for nationality fields.
 *
 * A value the list does not carry still renders as plain text, so an offer
 * saved before a country was added to `COUNTRIES` keeps its nationality
 * instead of silently emptying on edit.
 */
export default function NationalitySelect({
  value,
  onChange,
  id,
  size = "middle",
  disabled,
  placeholder,
}: Props) {
  return (
    <Select
      id={id}
      value={value || undefined}
      onChange={(next) => onChange?.(next || "")}
      size={size}
      disabled={disabled}
      placeholder={placeholder}
      showSearch
      allowClear
      optionFilterProp="search"
      // Roughly eight rows: enough to scroll comfortably without the dropdown
      // covering the rest of the section.
      listHeight={288}
      options={options}
      style={{ width: "100%" }}
    />
  );
}
