const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ── Upload directory ──────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "outputs");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Multer config ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp", ".gif"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Unsupported file format"));
  }
});

// ── Helper: run command ───────────────────────────────────────────────────────
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

// ── Helper: cleanup files ─────────────────────────────────────────────────────
function cleanup(...files) {
  files.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
}

// ── Check tools availability ──────────────────────────────────────────────────
async function checkTools() {
  const tools = {};
  try { await runCommand("ocrmypdf --version"); tools.ocrmypdf = true; } catch { tools.ocrmypdf = false; }
  try { await runCommand("tesseract --version"); tools.tesseract = true; } catch { tools.tesseract = false; }
  try { await runCommand("pdftotext -v"); tools.pdftotext = true; } catch { tools.pdftotext = false; }
  try { await runCommand("python3 --version"); tools.python3 = true; } catch { tools.python3 = false; }
  return tools;
}

// ── OCR PDF using ocrmypdf ────────────────────────────────────────────────────
async function ocrPdfWithOcrmypdf(inputPath, language = "eng") {
  const outputPath = path.join(OUTPUT_DIR, `${uuidv4()}_ocr.pdf`);
  const txtPath = path.join(OUTPUT_DIR, `${uuidv4()}.txt`);

  try {
    // Run ocrmypdf
    const cmd = `ocrmypdf --language ${language} --force-ocr --output-type pdf "${inputPath}" "${outputPath}"`;
    await runCommand(cmd);

    // Extract text from OCR'd PDF
    await runCommand(`pdftotext "${outputPath}" "${txtPath}"`);
    const text = fs.readFileSync(txtPath, "utf8");

    cleanup(outputPath, txtPath);
    return { text: text.trim(), method: "ocrmypdf" };
  } catch (err) {
    cleanup(outputPath, txtPath);
    throw err;
  }
}

// ── OCR Image using tesseract CLI ─────────────────────────────────────────────
async function ocrImageWithTesseract(inputPath, language = "eng") {
  const outputBase = path.join(OUTPUT_DIR, uuidv4());
  try {
    await runCommand(`tesseract "${inputPath}" "${outputBase}" -l ${language} --psm 6`);
    const txtPath = `${outputBase}.txt`;
    const text = fs.readFileSync(txtPath, "utf8");
    cleanup(txtPath);
    return { text: text.trim(), method: "tesseract-cli" };
  } catch (err) {
    throw err;
  }
}

// ── Try direct PDF text extraction first ─────────────────────────────────────
async function extractPdfText(inputPath) {
  try {
    const txtPath = path.join(OUTPUT_DIR, `${uuidv4()}.txt`);
    await runCommand(`pdftotext "${inputPath}" "${txtPath}"`);
    const text = fs.readFileSync(txtPath, "utf8");
    cleanup(txtPath);
    if (text.trim().length > 50) return { text: text.trim(), method: "pdftotext" };
    return null;
  } catch { return null; }
}

// ── OCR PDF using python + tesseract page by page ─────────────────────────────
async function ocrPdfWithPython(inputPath, language = "eng") {
  const outputBase = path.join(OUTPUT_DIR, uuidv4());
  const scriptPath = path.join(__dirname, "pdf_ocr.py");
  try {
    const cmd = `python "${scriptPath}" "${inputPath}" "${outputBase}" ${language}`;
    await runCommand(cmd);
    const txtPath = `${outputBase}.txt`;
    if (fs.existsSync(txtPath)) {
      const text = fs.readFileSync(txtPath, "utf8");
      cleanup(txtPath);
      return { text: text.trim(), method: "python-pdf-ocr" };
    }
    throw new Error("Python OCR output not found");
  } catch (err) {
    throw err;
  }
}

// ── Parse table structure from text ──────────────────────────────────────────
function parseTableData(text) {
  const lines = text.split("\n").filter(l => l.trim().length > 1);
  const rows = [];

  lines.forEach(line => {
    const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      rows.push({ field: parts[0], value: parts.slice(1).join(" ") });
    } else if (parts.length === 1 && line.includes(":")) {
      const colonIdx = line.indexOf(":");
      const field = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      if (field && value) rows.push({ field, value });
    }
  });

  return rows;
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", async (req, res) => {
  const tools = await checkTools();
  res.json({ status: "ok", tools });
});

// Main OCR endpoint
app.post("/api/ocr", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const inputPath = req.file.path;
  const language = req.body.language || "eng";
  const isPdf = path.extname(req.file.originalname).toLowerCase() === ".pdf";

  try {
    let result;

    if (isPdf) {
      // Try direct text extraction first (pdftotext)
      const direct = await extractPdfText(inputPath);
      if (direct) {
        result = direct;
      } else {
        // Try ocrmypdf
        try {
          result = await ocrPdfWithOcrmypdf(inputPath, language);
        } catch {
          // Fallback to python+tesseract page by page
          result = await ocrPdfWithPython(inputPath, language);
        }
      }
    } else {
      // Image — use tesseract CLI
      result = await ocrImageWithTesseract(inputPath, language);
    }

    const tableData = parseTableData(result.text);
    cleanup(inputPath);

    res.json({
      success: true,
      text: result.text,
      method: result.method,
      tableData,
      wordCount: result.text.trim().split(/\s+/).filter(Boolean).length,
      charCount: result.text.length,
      lineCount: result.text.split("\n").filter(l => l.trim()).length,
    });

  } catch (err) {
    cleanup(inputPath);
    res.status(500).json({ error: err.message || "OCR failed" });
  }
});

// Multi-page PDF OCR endpoint
app.post("/api/ocr/pdf-pages", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const inputPath = req.file.path;
  const language = req.body.language || "eng";

  try {
    // Get page count
    const pageCountOutput = await runCommand(`pdfinfo "${inputPath}" | grep "Pages:"`);
    const pageCount = parseInt(pageCountOutput.match(/\d+/)?.[0] || "1");

    // Extract text from all pages
    const pages = [];
    for (let i = 1; i <= pageCount; i++) {
      const txtPath = path.join(OUTPUT_DIR, `${uuidv4()}_page${i}.txt`);
      try {
        await runCommand(`pdftotext -f ${i} -l ${i} "${inputPath}" "${txtPath}"`);
        const text = fs.readFileSync(txtPath, "utf8").trim();
        pages.push({ page: i, text, tableData: parseTableData(text) });
        cleanup(txtPath);
      } catch {
        pages.push({ page: i, text: "", error: "Failed to extract page" });
      }
    }

    cleanup(inputPath);
    res.json({ success: true, pageCount, pages });

  } catch (err) {
    cleanup(inputPath);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`OCR Backend running on http://localhost:${PORT}`);
  checkTools().then(tools => {
    console.log("Available tools:", tools);
  });
});
