# BOI Statement Parser

Convert scanned Bank of Ireland bank statements (PDF or image) into clean CSV files — **100% locally using Tesseract OCR. No data ever leaves your machine.**

## Output CSV columns

| Date | Description | Debit | Credit | Balance |
|------|-------------|-------|--------|---------|
| DD/MM/YYYY | Payee / reference | amount | amount | running balance |

## Requirements

- Node.js 18+
- Anthropic API Key

## Setup & run

```bash
npm install
vercel --prod --force
```

Visit https://boi-parser.vercel.app.

## How it works

1. Upload a scanned PDF or image of a BOI statement
2. PDFs are converted to 300 DPI PNG images.
3. Each page is parsed by claude ai
5. CSV is generated and downloaded — nothing stored or transmitted

## Tips for best results

- Scan at 300 DPI or higher
- Scan straight — avoid skew/rotation
- Good lighting, no shadows across the text
- Correct any misread transactions manually in the CSV after download

