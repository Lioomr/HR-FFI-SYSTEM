import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Spin } from "antd";
import { DownloadOutlined } from "@ant-design/icons";

import { useI18n } from "../../i18n/useI18n";
import { downloadBlob, previewableType } from "../../utils/download";

export type FilePreviewRequest = {
  title: string;
  filename: string;
  load: () => Promise<Blob>;
};

type LoadedFile =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; blob: Blob; type: string | null };

const PDFJS_ASSETS = `${import.meta.env.BASE_URL}pdfjs`.replace("//", "/");

// pdf.js is large, so it loads only when the first PDF is previewed.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfJs() {
  pdfjsPromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?worker"),
  ]).then(([pdfjs, { default: PdfWorker }]) => {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
    return pdfjs;
  });
  return pdfjsPromise;
}

/**
 * Draws every page of a PDF onto canvases sized to the modal's width.
 *
 * A blob PDF in an iframe inherits the app's CSP (`object-src 'none'`), which
 * stops the browser's own viewer, and phones do not render PDFs in iframes at
 * all — so the pages are rendered by pdf.js instead.
 */
function PdfPages({ blob }: { blob: Blob }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;

    (async () => {
      const pdfjs = await loadPdfJs();
      const task = pdfjs.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
        // Without these, non-embedded and CID fonts (Arabic reports) render
        // with wrong glyphs and spacing.
        cMapUrl: `${PDFJS_ASSETS}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/`,
        iccUrl: `${PDFJS_ASSETS}/iccs/`,
        wasmUrl: `${PDFJS_ASSETS}/wasm/`,
      });
      destroy = () => task.destroy();
      const doc = await task.promise;
      const ratio = window.devicePixelRatio || 1;
      for (let number = 1; number <= doc.numPages && !cancelled; number += 1) {
        const page = await doc.getPage(number);
        const cssScale =
          container.clientWidth / page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale: cssScale * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        // Canvas text inherits the page direction; in the RTL (Arabic) layout
        // that mirrors pdf.js glyph runs and garbles the whole page.
        canvas.dir = "ltr";
        canvas.style.cssText =
          "display:block;width:100%;height:auto;background:#fff;border-radius:8px;box-shadow:0 4px 14px rgba(15,23,42,0.12)";
        if (cancelled) return;
        container.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
        if (number === 1) setRendering(false);
      }
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      void destroy?.();
      container.replaceChildren();
    };
  }, [blob]);

  return (
    <>
      {failed ? (
        <Alert type="info" showIcon message={t("filePreview.unavailable")} />
      ) : (
        rendering && <PreviewSpinner />
      )}
      <div
        ref={containerRef}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      />
    </>
  );
}

function PreviewSpinner() {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: 240 }}>
      <Spin size="large" />
    </div>
  );
}

function ImagePreview({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url ? (
    <img
      src={url}
      alt={alt}
      style={{ display: "block", maxWidth: "100%", margin: "0 auto" }}
    />
  ) : null;
}

/**
 * Shows a PDF or image inside the app instead of a new browser tab. Other file
 * types, and any load failure, fall back to a download button.
 */
export default function FilePreviewModal({
  request,
  onClose,
}: {
  request: FilePreviewRequest | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<LoadedFile>({ status: "loading" });

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setFile({ status: "loading" });
    request
      .load()
      .then(async (blob) => {
        const type = await previewableType(blob);
        if (!cancelled) setFile({ status: "ready", blob, type });
      })
      .catch(() => {
        if (!cancelled) setFile({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const blob = file.status === "ready" ? file.blob : null;
  const type = file.status === "ready" ? file.type : null;

  return (
    <Modal
      open={Boolean(request)}
      title={request?.title}
      onCancel={onClose}
      width={960}
      centered
      destroyOnHidden
      styles={{
        body: {
          maxHeight: "calc(100dvh - 180px)",
          overflowY: "auto",
          background: "#f1f5f9",
          borderRadius: 10,
          padding: 12,
        },
      }}
      footer={[
        <Button key="close" onClick={onClose}>
          {t("common.close")}
        </Button>,
        <Button
          key="download"
          type="primary"
          icon={<DownloadOutlined aria-hidden />}
          disabled={!blob}
          onClick={() =>
            blob && request && downloadBlob(blob, request.filename)
          }
        >
          {t("common.download")}
        </Button>,
      ]}
    >
      {file.status === "loading" && <PreviewSpinner />}
      {file.status === "error" && (
        <Alert type="error" showIcon message={t("filePreview.loadFailed")} />
      )}
      {blob && !type && (
        <Alert type="info" showIcon message={t("filePreview.unavailable")} />
      )}
      {blob && type === "application/pdf" && <PdfPages blob={blob} />}
      {blob && type?.startsWith("image/") && (
        <ImagePreview blob={blob} alt={request?.title ?? ""} />
      )}
    </Modal>
  );
}
