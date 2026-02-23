export default function LoadingState({
  title,
  lines = 4,
}: {
  title?: string;
  lines?: number;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 16,
        padding: 28,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        animation: "fadeIn 0.3s ease both",
      }}
    >
      {title && (
        <div
          style={{
            height: 20,
            width: 180,
            borderRadius: 8,
            background: "linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s infinite",
            marginBottom: 20,
          }}
        />
      )}
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 14,
            borderRadius: 7,
            background: "linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s infinite",
            marginBottom: i < lines - 1 ? 12 : 0,
            width: i === lines - 1 ? "60%" : "100%",
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}
