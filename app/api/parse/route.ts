import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface Transaction {
  date: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else current += char;
  }
  result.push(current.trim());
  return result;
}

const PROMPT = `This is an Irish bank statement PDF (Bank of Ireland, AIB, PTSB, or similar).

Extract EVERY transaction from ALL pages and return ONLY raw CSV with these columns (no header row, no markdown, no explanation):
Date,Description,Debit,Credit,Balance

Rules:
- Date format: DD/MM/YYYY
- Description: transaction name/reference
- Debit: money going OUT (positive number, no currency symbol). Empty if not applicable.
- Credit: money coming IN (positive number, no currency symbol). Empty if not applicable.
- Balance: running balance on that row. Empty if not shown.
- Skip: Balance Forward, Subtotal, page headers, address, account info, deposit guarantee pages, abbreviations pages
- Payments IN (salary, transfers received, savings deposits) → Credit column
- Payments OUT (purchases, bills, transfers sent) → Debit column
- Return nothing if a page has no transactions`;

function parseResponse(response: Anthropic.Message): Transaction[] {
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();

  if (!text) return [];

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("date,"))
    .map((line) => {
      const cols = parseCSVLine(line);
      return {
        date:        cols[0] ?? "",
        description: cols[1] ?? "",
        debit:       cols[2] ?? "",
        credit:      cols[3] ?? "",
        balance:     cols[4] ?? "",
      };
    })
    .filter((t) => {
      if (!t.date || !t.description) return false;
      if (/balance forward|opening balance|subtotal/i.test(t.description)) return false;
      if (!/^\d{1,2}\/\d{2}\/\d{4}$/.test(t.date)) return false;
      return true;
    });
}

async function processPDF(buffer: Buffer): Promise<Transaction[]> {
  console.log(`PDF: ${buffer.length} bytes`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 32000,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } } as any,
        { type: "text", text: PROMPT },
      ],
    }],
  });

  const txns = parseResponse(response);
  console.log(`Total transactions: ${txns.length}`);
  return txns;
}

async function processImage(buffer: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"): Promise<Transaction[]> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
        { type: "text", text: PROMPT },
      ],
    }],
  });
  return parseResponse(response);
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 500 });
  }

  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const allTransactions: Transaction[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      let txns: Transaction[] = [];

      if (file.type === "application/pdf") {
        txns = await processPDF(buffer);
      } else if (["image/jpeg","image/png","image/webp","image/gif"].includes(file.type)) {
        txns = await processImage(buffer, file.type as any);
      }

      allTransactions.push(...txns);
    }

    if (allTransactions.length === 0) {
      return NextResponse.json({ error: "No transactions found." }, { status: 422 });
    }

    const header = "Date,Description,Debit,Credit,Balance";
    const csv = [header, ...allTransactions.map((t) =>
      [t.date, csvEscape(t.description), t.debit, t.credit, t.balance].join(",")
    )].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="statement_${Date.now()}.csv"`,
      },
    });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to process." }, { status: 500 });
  }
}