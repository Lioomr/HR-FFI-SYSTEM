import { useState } from "react";

import FilePreviewModal, { type FilePreviewRequest } from "./FilePreviewModal";

/** State plus the modal element for pages that preview files in-app. */
export function useFilePreview() {
  const [request, setRequest] = useState<FilePreviewRequest | null>(null);
  return {
    openPreview: setRequest,
    previewModal: (
      <FilePreviewModal request={request} onClose={() => setRequest(null)} />
    ),
  };
}
