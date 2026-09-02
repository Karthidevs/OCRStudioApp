import { useState, useRef, useCallback } from "react";
import { createWorker } from "tesseract.js";

const LANGUAGES = [
  { code: "eng", name: "English" },
  { code: "hin", name: "Hindi" },
  { code: "tam", name: "Tamil" },
  { code: "tel", name: "Telugu" },
  { code: "kan", name: "Kannada" },
  { code: "mal", name: "Malayalam" },
  { code: "mar", name: "Marathi" },
  { code: "ben", name: "Bengali" },
  { code: "fra", name: "French" },
  { code: "deu", name: "German" },
  { code: "spa", name: "Spanish" },
  { code: "ara", name: "Arabic" },
];

const SUPPORTED_FORMATS = ["JPG", "PNG", "BMP", "TIFF", "WEBP", "GIF", "PDF"];

// ── API call to backend ───────────────────────────────────────────────────────
async function ocrViaBackend(file, language) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("language", language);

  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Backend OCR failed");
  }
  return res.json();
}

// ── Browser Tesseract for images ──────────────────────────────────────────────
async function ocrViaBrowser(file, language, onProgress) {
  const worker = await createWorker(language, 1, {
    logger: m => {
      if (m.status === "recognizing text") {
        onProgress(Math.round(m.progress * 100));
      }
    }
  });

  await worker.setParameters({
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1",
  });

  const { data } = await worker.recognize(file);
  await worker.terminate();

  return {
    text: data.text,
    confidence: Math.round(data.confidence),
    method: "tesseract-browser",
    wordCount: data.words?.length || 0,
  };
}

// ── Parse table data ──────────────────────────────────────────────────────────
function parseTableData(text) {
  const lines = text.split("\n").filter(l => l.trim().length > 1);
  const rows = [];
  lines.forEach(line => {
    const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      rows.push({ field: parts[0], value: parts.slice(1).join(" ") });
    } else if (line.includes(":")) {
      const colonIdx = line.indexOf(":");
      const field = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      if (field.length > 1 && value.length > 0) rows.push({ field, value });
    }
  });
  return rows;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function getStats(text) {
  if (!text) return { chars: 0, words: 0, lines: 0, sentences: 0 };
  return {
    chars: text.length,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    lines: text.split("\n").filter(l => l.trim()).length,
    sentences: text.split(/[.!?]+/).filter(Boolean).length,
  };
}

// ── Highlight search ──────────────────────────────────────────────────────────
function highlightText(text, query) {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="highlight">{part}</mark>
      : part
  );
}

// ── Method badge ──────────────────────────────────────────────────────────────
function MethodBadge({ method }) {
  const map = {
    "ocrmypdf":         { label: "ocrmypdf",         color: "#27AE60" },
    "pdftotext":        { label: "pdftotext",         color: "#2980B9" },
    "tesseract-cli":    { label: "Tesseract CLI",     color: "#8E44AD" },
    "tesseract-browser":{ label: "Tesseract Browser", color: "#E67E22" },
  };
  const info = map[method] || { label: method, color: "#7A7569" };
  return (
    <span className="method-badge" style={{ background: info.color }}>
      {info.label}
    </span>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [files, setFiles]         = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [results, setResults]     = useState({});
  const [progress, setProgress]   = useState({});
  const [stage, setStage]         = useState({});
  const [previews, setPreviews]   = useState({});
  const [dragActive, setDragActive] = useState(false);
  const [language, setLanguage]   = useState("eng");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("table");
  const [backendAvailable, setBackendAvailable] = useState(null);
  const [copiedRow, setCopiedRow] = useState(null);
  const inputRef = useRef();

  const currentFile   = files[activeIdx];
  const currentResult = results[activeIdx];
  const currentStage  = stage[activeIdx] || "idle";
  const currentProg   = progress[activeIdx] || 0;
  const stats         = getStats(currentResult?.text);

  // ── Check backend ─────────────────────────────────────────────────────────
  const checkBackend = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`);
      const data = await res.json();
      setBackendAvailable(data.tools);
      return data.tools;
    } catch {
      setBackendAvailable(false);
      return false;
    }
  }, []);

  // ── Handle files ─────────────────────────────────────────────────────────
  const handleFiles = useCallback((newFiles) => {
    const arr = Array.from(newFiles);
    setFiles(prev => {
      const updated = [...prev, ...arr];
      setActiveIdx(updated.length - 1);
      return updated;
    });
    arr.forEach((f, i) => {
      const idx = files.length + i;
      if (!f.name.toLowerCase().endsWith(".pdf")) {
        setPreviews(prev => ({ ...prev, [idx]: URL.createObjectURL(f) }));
      }
    });
  }, [files.length]);

  // ── Run OCR ──────────────────────────────────────────────────────────────
  const runOCR = useCallback(async (idx) => {
    const f = files[idx];
    if (!f) return;

    setStage(prev  => ({ ...prev, [idx]: "processing" }));
    setProgress(prev => ({ ...prev, [idx]: 0 }));
    setResults(prev  => ({ ...prev, [idx]: null }));

    const isPdf = f.name.toLowerCase().endsWith(".pdf");

    try {
      let result;

      if (isPdf) {
        // Always use backend for PDF
        setProgress(prev => ({ ...prev, [idx]: 30 }));
        const data = await ocrViaBackend(f, language);
        setProgress(prev => ({ ...prev, [idx]: 100 }));
        result = {
          text: data.text,
          method: data.method,
          confidence: null,
          tableData: data.tableData,
          wordCount: data.wordCount,
          charCount: data.charCount,
          lineCount: data.lineCount,
        };
      } else {
        // Try backend first for images, fallback to browser
        const tools = backendAvailable || await checkBackend();
        if (tools && tools.tesseract) {
          setProgress(prev => ({ ...prev, [idx]: 30 }));
          const data = await ocrViaBackend(f, language);
          setProgress(prev => ({ ...prev, [idx]: 100 }));
          result = {
            text: data.text,
            method: data.method,
            confidence: null,
            tableData: data.tableData,
            wordCount: data.wordCount,
          };
        } else {
          // Fallback to browser Tesseract
          const data = await ocrViaBrowser(f, language, (p) => {
            setProgress(prev => ({ ...prev, [idx]: p }));
          });
          result = {
            text: data.text,
            method: data.method,
            confidence: data.confidence,
            tableData: parseTableData(data.text),
            wordCount: data.wordCount,
          };
        }
      }

      setResults(prev => ({ ...prev, [idx]: result }));
      setStage(prev => ({ ...prev, [idx]: "done" }));

    } catch (err) {
      setStage(prev => ({ ...prev, [idx]: "error" }));
      setResults(prev => ({ ...prev, [idx]: { error: err.message } }));
    }
  }, [files, language, backendAvailable, checkBackend]);

  // ── Copy ─────────────────────────────────────────────────────────────────
  const copyRow = (value, idx) => {
    navigator.clipboard.writeText(value);
    setCopiedRow(idx);
    setTimeout(() => setCopiedRow(null), 2000);
  };

  const copyAll = () => {
    if (currentResult?.text) navigator.clipboard.writeText(currentResult.text);
  };

  // ── Download ──────────────────────────────────────────────────────────────
  const download = (format) => {
    if (!currentResult?.text) return;
    const name = currentFile?.name?.replace(/\.[^.]+$/, "") || "ocr-result";
    let content, type, ext;

    if (format === "txt") {
      content = currentResult.text;
      type = "text/plain"; ext = "txt";
    } else if (format === "json") {
      content = JSON.stringify({ file: currentFile?.name, ...currentResult, stats }, null, 2);
      type = "application/json"; ext = "json";
    } else if (format === "csv") {
      const rows = currentResult.tableData || [];
      content = "Field,Value\n" + rows.map(r => `"${r.field}","${r.value}"`).join("\n");
      type = "text/csv"; ext = "csv";
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${ext}`; a.click();
  };

  // ── Remove file ───────────────────────────────────────────────────────────
  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setResults(prev => { const n = { ...prev }; delete n[idx]; return n; });
    setStage(prev => { const n = { ...prev }; delete n[idx]; return n; });
    setPreviews(prev => { const n = { ...prev }; delete n[idx]; return n; });
    setActiveIdx(Math.max(0, idx - 1));
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo-icon">⚡</span>
          <div>
            <div className="logo-name">OCR Studio</div>
            <div className="logo-sub">PDF + Image text extractor</div>
          </div>
        </div>
        <div className="header-right">
          <div className="lang-wrap">
            <label className="lang-label">Language</label>
            <select className="lang-select" value={language} onChange={e => setLanguage(e.target.value)}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
          <div className="formats-row">
            {SUPPORTED_FORMATS.map(f => (
              <span key={f} className="format-tag">{f}</span>
            ))}
          </div>
          {backendAvailable && (
            <span className="backend-status">
              {backendAvailable.ocrmypdf ? "✅ ocrmypdf" : "⚠ ocrmypdf missing"}
            </span>
          )}
        </div>
      </header>

      <div className="body">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Files ({files.length})</span>
            <button className="add-btn" onClick={() => inputRef.current.click()}>+ Add</button>
            <input ref={inputRef} type="file" multiple accept="image/*,.pdf" style={{ display: "none" }}
              onChange={e => handleFiles(e.target.files)} />
          </div>

          <div className="file-list">
            {files.length === 0 && <div className="file-empty">No files yet</div>}
            {files.map((f, i) => (
              <div key={i} className={`file-item ${i === activeIdx ? "active" : ""}`} onClick={() => setActiveIdx(i)}>
                <div className="file-icon">{f.name.toLowerCase().endsWith(".pdf") ? "📑" : "🖼"}</div>
                <div className="file-info">
                  <div className="file-name">{f.name}</div>
                  <div className="file-size">{(f.size / 1024).toFixed(0)} KB</div>
                </div>
                <div className="file-status">
                  {stage[i] === "done"       && <span className="dot dot-green" />}
                  {stage[i] === "processing" && <span className="dot dot-blue anim" />}
                  {stage[i] === "error"      && <span className="dot dot-red" />}
                  {(!stage[i] || stage[i] === "idle") && <span className="dot dot-grey" />}
                </div>
                <button className="file-remove" onClick={e => { e.stopPropagation(); removeFile(i); }}>✕</button>
              </div>
            ))}
          </div>

          <div
            className={`drop-zone ${dragActive ? "drag-active" : ""}`}
            onDragOver={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={e => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current.click()}
          >
            <div className="drop-icon">📂</div>
            <div className="drop-text">Drop files or click to browse</div>
            <div className="drop-sub">PDF • Images • All formats</div>
          </div>
        </div>

        {/* Main */}
        <div className="main">
          {!currentFile ? (
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <div className="empty-title">Upload a file to extract text</div>
              <div className="empty-sub">Supports PDF, JPG, PNG, TIFF, BMP, WEBP and more</div>
              <button className="empty-btn" onClick={() => inputRef.current.click()}>Upload files</button>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="toolbar">
                <div className="toolbar-left">
                  <span className="file-title">{currentFile.name}</span>
                  {currentResult?.method && <MethodBadge method={currentResult.method} />}
                  {currentResult?.confidence != null && (
                    <span className="conf-badge" style={{
                      background: currentResult.confidence >= 80 ? "#EAF3DE" : "#FFF8F0",
                      color: currentResult.confidence >= 80 ? "#3B6D11" : "#854F0B"
                    }}>
                      {currentResult.confidence}% confidence
                    </span>
                  )}
                </div>
                <div className="toolbar-right">
                  {currentResult?.text && (
                    <>
                      <button className="action-btn" onClick={copyAll}>⎘ Copy all</button>
                      <button className="action-btn" onClick={() => download("txt")}>↓ TXT</button>
                      <button className="action-btn" onClick={() => download("json")}>↓ JSON</button>
                      <button className="action-btn" onClick={() => download("csv")}>↓ CSV</button>
                    </>
                  )}
                  <button className="btn-primary" onClick={() => runOCR(activeIdx)}
                    disabled={currentStage === "processing"}>
                    {currentStage === "processing" ? `⟳ ${currentProg}%` : "⚡ Extract text"}
                  </button>
                </div>
              </div>

              {/* Split */}
              <div className="split">
                {/* Preview */}
                <div className="preview-panel">
                  <div className="panel-label">Preview</div>
                  <div className="preview-wrap">
                    {previews[activeIdx] ? (
                      <img src={previews[activeIdx]} alt="Preview" className="preview-img" />
                    ) : (
                      <div className="preview-placeholder">
                        <span style={{ fontSize: 48 }}>📑</span>
                        <span>{currentFile.name}</span>
                        <span style={{ fontSize: 11, color: "#7A7569" }}>PDF — preview not available</span>
                      </div>
                    )}
                    {currentStage === "processing" && (
                      <div className="scan-overlay">
                        <div className="scan-line" />
                        <div className="scan-info">
                          {currentFile.name.toLowerCase().endsWith(".pdf")
                            ? "ocrmypdf processing..."
                            : `Scanning... ${currentProg}%`}
                        </div>
                        <div className="scan-bar">
                          <div className="scan-fill" style={{ width: `${currentProg}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Result */}
                <div className="result-panel">
                  <div className="panel-header">
                    <div className="tabs">
                      <button className={`tab ${activeTab === "table" ? "active" : ""}`} onClick={() => setActiveTab("table")}>
                        Table view {currentResult?.tableData ? `(${currentResult.tableData.length})` : ""}
                      </button>
                      <button className={`tab ${activeTab === "text" ? "active" : ""}`} onClick={() => setActiveTab("text")}>
                        Raw text
                      </button>
                      <button className={`tab ${activeTab === "stats" ? "active" : ""}`} onClick={() => setActiveTab("stats")}>
                        Stats
                      </button>
                    </div>
                    {activeTab === "text" && currentResult?.text && (
                      <input type="text" placeholder="🔍 Search..." value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)} className="search-input" />
                    )}
                  </div>

                  <div className="result-body">
                    {/* Idle */}
                    {currentStage === "idle" && (
                      <div className="result-idle">
                        Click <strong>⚡ Extract text</strong> to start
                      </div>
                    )}

                    {/* Processing */}
                    {currentStage === "processing" && (
                      <div className="result-loading">
                        <div className="spinner" />
                        <div className="loading-title">
                          {currentFile.name.toLowerCase().endsWith(".pdf")
                            ? "Running ocrmypdf on PDF..."
                            : `Extracting text... ${currentProg}%`}
                        </div>
                        <div className="loading-sub">This may take a few seconds</div>
                      </div>
                    )}

                    {/* Error */}
                    {currentStage === "error" && (
                      <div className="result-error">
                        <div className="error-title">⚠ OCR Failed</div>
                        <div className="error-msg">{currentResult?.error}</div>
                        <div className="error-hint">
                          Make sure <code>ocrmypdf</code> and <code>tesseract</code> are installed on your system.
                          <br />Run: <code>pip install ocrmypdf</code> and <code>apt install tesseract-ocr</code>
                        </div>
                      </div>
                    )}

                    {/* Table view */}
                    {currentStage === "done" && activeTab === "table" && (
                      <div className="table-wrap">
                        {currentResult?.tableData?.length > 0 ? (
                          <table className="ocr-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Field</th>
                                <th>Value</th>
                                <th>Copy</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentResult.tableData.map((row, i) => (
                                <tr key={i}>
                                  <td className="td-num">{i + 1}</td>
                                  <td className="td-field">{row.field}</td>
                                  <td className="td-value">{row.value}</td>
                                  <td className="td-copy">
                                    <button
                                      className={`copy-btn ${copiedRow === i ? "copied" : ""}`}
                                      onClick={() => copyRow(row.value, i)}
                                    >
                                      {copiedRow === i ? "✓" : "⎘"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="result-idle">
                            No table structure found — check Raw text tab
                          </div>
                        )}
                      </div>
                    )}

                    {/* Raw text */}
                    {currentStage === "done" && activeTab === "text" && (
                      <div className="result-text">
                        {currentResult?.text
                          ? highlightText(currentResult.text, searchQuery)
                          : <span className="text-empty">No text extracted</span>}
                      </div>
                    )}

                    {/* Stats */}
                    {currentStage === "done" && activeTab === "stats" && (
                      <div className="stats-grid">
                        <div className="stat-card"><div className="stat-num">{stats.words}</div><div className="stat-label">Words</div></div>
                        <div className="stat-card"><div className="stat-num">{stats.chars}</div><div className="stat-label">Characters</div></div>
                        <div className="stat-card"><div className="stat-num">{stats.lines}</div><div className="stat-label">Lines</div></div>
                        <div className="stat-card"><div className="stat-num">{stats.sentences}</div><div className="stat-label">Sentences</div></div>
                        {currentResult?.confidence != null && (
                          <div className="stat-card">
                            <div className="stat-num" style={{ color: currentResult.confidence >= 80 ? "#27AE60" : "#E67E22" }}>
                              {currentResult.confidence}%
                            </div>
                            <div className="stat-label">Confidence</div>
                          </div>
                        )}
                        <div className="stat-card">
                          <div className="stat-num" style={{ fontSize: 14, paddingTop: 6 }}>
                            {currentResult?.method || "-"}
                          </div>
                          <div className="stat-label">OCR Method</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
