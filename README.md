# BOI Statement Parser

Convert scanned Bank of Ireland bank statements (PDF or image) into clean CSV files — **100% locally using Tesseract OCR. No data ever leaves your machine.**

## Output CSV columns

| Date | Description | Debit | Credit | Balance |
|------|-------------|-------|--------|---------|
| DD/MM/YYYY | Payee / reference | amount | amount | running balance |

## Requirements

- Node.js 18+
- **GraphicsMagick** — required by pdf2pic to convert PDF pages to images

### Install GraphicsMagick

**macOS**
```bash
brew install graphicsmagick ghostscript
```

**Windows**
Download from https://www.graphicsmagick.org/download.html
Also install Ghostscript from https://www.ghostscript.com/releases/gsdnld.html

**Linux**
```bash
sudo apt-get install graphicsmagick ghostscript
```

## Setup & run

```bash
npm install
npm run dev
```

Visit http://localhost:3000 — no API keys, no accounts, no internet required after first run.
Tesseract downloads its English language data once and caches it in ~/.tesseract-cache.

## How it works

1. Upload a scanned PDF or image of a BOI statement
2. PDFs are converted to 300 DPI PNG images using pdf2pic + GraphicsMagick
3. Each page is OCR'd locally by Tesseract.js (runs in Node, no system install of Tesseract needed)
4. The text is parsed with a regex-based BOI statement parser
5. CSV is generated and downloaded — nothing stored or transmitted

## Tips for best results

- Scan at 300 DPI or higher
- Scan straight — avoid skew/rotation
- Good lighting, no shadows across the text
- Correct any misread transactions manually in the CSV after download

## Privacy

All processing happens on your local machine. No files, text, or data is sent anywhere.
