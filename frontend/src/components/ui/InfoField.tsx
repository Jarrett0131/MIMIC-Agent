import { memo } from "react";

type InfoFieldProps = {
  label: string;
  value: unknown;
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

export const InfoField = memo(function InfoField({
  label,
  value,
}: InfoFieldProps) {
  return (
    <div className="info-field">
      <span className="info-field-label">{label}</span>
      <strong className="info-field-value">{formatValue(value)}</strong>
    </div>
  );
});
