/**
 * Test double for `components/documents/DocumentIntegrityPanel`.
 *
 * The card itself is covered by DocumentIntegrityPanel.test.tsx; page tests
 * only check its wiring, which this stub exposes as data attributes:
 * the document type, record id, final state, HR seal retry and the profile
 * route it would build for profile id 9 (empty when names stay plain text).
 *
 * Usage (the factory must import lazily because vi.mock is hoisted):
 *   vi.mock("<path>/DocumentIntegrityPanel", async () => ({
 *     default: (await import("<path>/test/integrityPanelStub")).default,
 *   }));
 */
export default function IntegrityPanelStub(props: {
  documentType?: string;
  requestId: number | string;
  isFinal: boolean;
  canRetrySeal?: boolean;
  profilePath?: (profileId: number) => string;
}) {
  return (
    <div
      data-testid="integrity-panel"
      data-type={props.documentType ?? "leave"}
      data-id={String(props.requestId)}
      data-final={String(props.isFinal)}
      data-retry={String(Boolean(props.canRetrySeal))}
      data-profile={props.profilePath?.(9) ?? ""}
    />
  );
}
