import type { CSSProperties, ReactNode } from "react";

export type JobOfferDocumentField = {
  label: ReactNode;
  value: ReactNode;
  emphasis?: boolean;
};

type JobOfferDocumentSectionProps = {
  children: ReactNode;
  title: ReactNode;
  style?: CSSProperties;
};

/**
 * A calm, document-style grouping for an offer's most important facts.
 *
 * The production offer is read as a sequence of labelled fields, so this
 * keeps that familiar reading pattern without turning the application screen
 * into a PDF preview.
 */
export default function JobOfferDocumentSection({
  children,
  title,
  style,
}: JobOfferDocumentSectionProps) {
  return (
    <section
      style={{
        background: "white",
        borderRadius: 16,
        padding: 24,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <span
          style={{
            width: 4,
            height: 20,
            borderRadius: 4,
            background: "linear-gradient(180deg, #f97316, #fb923c)",
          }}
        />
        <h2
          style={{
            margin: 0,
            color: "#0f172a",
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.35,
          }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export function JobOfferDocumentGrid({
  fields,
}: {
  fields: JobOfferDocumentField[];
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: 12,
      }}
    >
      {fields.map((field, index) => (
        <div
          key={index}
          style={{
            minWidth: 0,
            padding: "12px 14px",
            border: "1px solid #e8edf3",
            borderRadius: 10,
            background: "#fbfcfe",
          }}
        >
          <div
            style={{
              marginBottom: 5,
              color: "#7c8ca5",
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.35,
            }}
          >
            {field.label}
          </div>
          <div
            style={{
              color: "#0f2748",
              fontSize: 15,
              fontWeight: field.emphasis ? 700 : 500,
              lineHeight: 1.5,
              overflowWrap: "anywhere",
            }}
          >
            {field.value}
          </div>
        </div>
      ))}
    </div>
  );
}
