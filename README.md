# OCR Studio — Full Stack

## Install System Dependencies

### Ubuntu/Debian:

```bash
# Tesseract OCR
sudo apt-get install tesseract-ocr

# Additional language packs (optional)
sudo apt-get install tesseract-ocr-hin tesseract-ocr-tam tesseract-ocr-tel

# pdftotext (poppler)
sudo apt-get install poppler-utils

# pdfinfo
sudo apt-get install poppler-utils

# ocrmypdf
pip install ocrmypdf
```

### Windows:

```bash
# Install Tesseract from: https://github.com/UB-Mannheim/tesseract/wiki
# Add to PATH

# Install poppler from: https://github.com/oschwartz10612/poppler-windows
# Add bin folder to PATH
cd ..

# Install ocrmypdf
pip install ocrmypdf
```

### Mac:

```bash
brew install tesseract
brew install poppler
pip install ocrmypdf
```

## Run the App

### Terminal 1 — Backend:

```bash
cd backend
npm install
node server.js
```

### Terminal 2 — Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173
