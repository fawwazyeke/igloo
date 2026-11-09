"use client";

import { useEffect, useRef, useState } from "react";
import { FILE_LABEL, fileUrl, linkService, type ProjectFile } from "@/lib/core";

type Preview = { image: string } | { markup: string } | { snippet: string };

// The first lines of a source or text file, so the tile shows what's inside.
function snippetOf(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").split("\n").slice(0, 14);
  const snippet = lines.map((line) => line.replace(/\t/g, "  ").trimEnd().slice(0, 80)).join("\n").trimEnd();
  return snippet || null;
}

async function renderPdf(data: ArrayBuffer, signal: AbortSignal) {
  const pdf = await import("pdfjs-dist");
  signal.throwIfAborted();
  pdf.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loading = pdf.getDocument({
    data, enableXfa: false, useWasm: false, maxImageSize: 8_000_000, canvasMaxAreaInBytes: 16_000_000,
  });
  const cancel = () => { void loading.destroy().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const documentPdf = await loading.promise;
    const page = await documentPdf.getPage(1);
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 640 / Math.max(size.width, size.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!signal.aborted) await loading.destroy();
  }
}

async function renderHtml(text: string) {
  const { default: DOMPurify } = await import("dompurify");
  const markup = DOMPurify.sanitize(text, {
    FORCE_BODY: true,
    ALLOWED_TAGS: [
      "style", "header", "main", "footer", "section", "article", "aside", "div", "span",
      "h1", "h2", "h3", "h4", "p", "br", "hr", "ul", "ol", "li", "strong", "em",
      "table", "thead", "tbody", "tr", "th", "td", "pre", "code", "blockquote",
    ],
    ALLOWED_ATTR: ["class", "id", "style", "colspan", "rowspan"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  if (!markup.trim()) return null;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:16px;font:16px system-ui,sans-serif;overflow:hidden}</style></head><body>${markup}</body></html>`;
}

export function FileThumbnail({ file, slug }: { file: ProjectFile; slug: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const { id, kind, name } = file;
  const isHtml = kind === "text" && /\.html$/i.test(name);
  const isOffice = kind === "slides" || kind === "document";
  const isSource = kind === "text" && !isHtml;
  const supported = isHtml || isOffice || isSource || kind === "pdf";
  useEffect(() => {
    const element = container.current;
    if (!element || !supported || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [supported, visible]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const { signal } = controller;
    let objectUrl: string | undefined;
    const run = async () => {
      const query = isOffice ? "&thumbnail=1" : kind === "text" ? "&preview=1" : "";
      const response = await fetch(fileUrl(id, slug) + query, { signal });
      if (!response.ok) return;
      if (isSource) {
        const snippet = snippetOf(await response.text());
        if (snippet && !signal.aborted) setPreview({ snippet });
      } else if (isHtml) {
        const markup = await renderHtml(await response.text());
        if (markup && !signal.aborted) setPreview({ markup });
      } else if (kind === "pdf") {
        const image = await renderPdf(await response.arrayBuffer(), signal);
        if (!signal.aborted) setPreview({ image });
      } else {
        const blob = await response.blob();
        if (!signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ image: objectUrl });
        }
      }
    };
    void run().catch(() => { /* An unsupported or unreadable file keeps its type tile. */ });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, isHtml, isOffice, isSource, kind, slug, visible]);
  if (kind === "link" && file.url) {
    const service = linkService(file.url);
    return (
      <span className={`file-thumb link-thumb link-${service.toLowerCase().replace(/[^a-z]+/g, "")}`} aria-hidden="true" data-thumbnail="ready">
        <span className="link-service">{service}</span>
        <span className="link-host">{new URL(file.url).hostname.replace(/^www\./, "")}</span>
      </span>
    );
  }
  return (
    <span className="file-thumb" ref={container} aria-hidden="true" data-thumbnail={preview ? "ready" : "fallback"}>
      {preview ? "image" in preview
        ? <img src={preview.image} alt="" draggable={false} onError={() => setPreview(null)} />
        : "snippet" in preview
          ? <pre className="file-thumb-snippet">{preview.snippet}</pre>
          : <iframe title="Static HTML thumbnail" srcDoc={preview.markup} sandbox="" tabIndex={-1} />
        : <span className="file-thumb-label">{isHtml ? "HTML" : FILE_LABEL[kind]}</span>}
    </span>
  );
}
