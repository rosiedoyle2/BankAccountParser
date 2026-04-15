"use client";

import { useState, useRef, useCallback, DragEvent, ChangeEvent } from "react";
import Image from "next/image";
import styles from "./page.module.css";

interface UploadedFile { file: File; id: string; }
type Status = "idle" | "uploading" | "done" | "error";

export default function Home() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter(
      (f) => f.type === "application/pdf" || f.type.startsWith("image/")
    );
    setFiles((prev) => [...prev, ...valid.map((f) => ({ file: f, id: Math.random().toString(36).slice(2) }))]);
  };

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }, []);

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setStatus("uploading");
    setError("");
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f.file));
    try {
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || "Unknown error"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `statement_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("done");
      setFiles([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
    }
  };

  const reset = () => { setStatus("idle"); setError(""); setFiles([]); };

  return (
    <div className={styles.page}>

      {/* Decorative background shapes */}
      <div className={styles.shapeCircleLime1} />
      <div className={styles.shapeCircleLime2} />
      <div className={styles.shapeCircleNavy1} />
      <div className={styles.shapeCircleNavy2} />

      {/* Header banner */}
      <header className={styles.header}>
        <div className={styles.logoBox}>
          <Image src="/logo.png" alt="Logo" width={72} height={72} className={styles.logoImg} />
        </div>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Turn your</h1>
          <h1 className={styles.titleItalic}>bank statements</h1>
          <h1 className={styles.title}>into clean data.</h1>
        </div>
        <div className={styles.logoBox}>
          <Image src="/logo.png" alt="Logo" width={72} height={72} className={styles.logoImg} />
        </div>
      </header>

      {/* Main upload card */}
      <main className={styles.main}>
        <div className={styles.card}>
          {status === "idle" || status === "error" ? (
            <>
              <div
                className={`${styles.dropzone} ${isDragging ? styles.dragging : ""} ${files.length > 0 ? styles.hasFiles : ""}`}
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => e.target.files && addFiles(e.target.files)}
                />
                {files.length === 0 ? (
                  <div className={styles.dropContent}>
                    <svg className={styles.dropArrow} viewBox="0 0 40 40" fill="none">
                      <path d="M20 4 L20 28M20 28 L10 18M20 28 L30 18" stroke="#8dc63f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <p className={styles.dropPrimary}>Drop your statements here.</p>
                    <p className={styles.dropSecondary}><em>Select file or drag and drop.</em></p>
                  </div>
                ) : (
                  <div className={styles.fileList} onClick={(e) => e.stopPropagation()}>
                    {files.map((f) => (
                      <div key={f.id} className={styles.fileItem}>
                        <span className={styles.fileIcon}>{f.file.type === "application/pdf" ? "▤" : "▨"}</span>
                        <span className={styles.fileName}>{f.file.name}</span>
                        <span className={styles.fileSize}>{(f.file.size / 1024).toFixed(0)} KB</span>
                        <button className={styles.removeBtn} onClick={() => removeFile(f.id)}>×</button>
                      </div>
                    ))}
                    <button className={styles.addMore} onClick={() => inputRef.current?.click()}>+ Add more files</button>
                  </div>
                )}
              </div>

              {error && <div className={styles.errorBox}><strong>Error:</strong> {error}</div>}

              <button className={styles.submitBtn} disabled={files.length === 0} onClick={handleSubmit}>
                Extract Files
              </button>
            </>
          ) : status === "uploading" ? (
            <div className={styles.processing}>
              <div className={styles.spinner} />
              <p className={styles.processingText}>Reading your statement…</p>
              <p className={styles.processingSubtext}>Tesseract is scanning each page locally</p>
            </div>
          ) : (
            <div className={styles.success}>
              <div className={styles.successIcon}>✓</div>
              <p className={styles.processingText}>CSV downloaded!</p>
              <p className={styles.processingSubtext}>Check your downloads folder.</p>
              <button className={styles.submitBtnInner} onClick={reset}>Parse another statement</button>
            </div>
          )}
        </div>

        {/* How it works */}
        <section className={styles.howItWorks}>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <div className={styles.steps}>
            {[
              { n: "01", title: "Upload", body: "Drop in a scanned PDF or photo of your Bank of Ireland statement." },
              { n: "02", title: "Extract", body: "Tesseract OCR reads the scan locally on your machine — no internet required." },
              { n: "03", title: "Download", body: "Get a clean CSV with Date, Description, Debit, Credit, and Balance." },
            ].map((s) => (
              <div key={s.n} className={styles.step}>
                <span className={styles.stepNum}>{s.n}</span>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepBody}>{s.body}</p>
              </div>
            ))}
          </div>
          <p className={styles.footer}> · Built with Next.js + Claude API ·</p>
        </section>
      </main>

    </div>
  );
}
