import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 600000, maxRetries: 0 });

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transaction {
  date: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

interface ValidationIssue {
  row: number;
  type: "balance_mismatch" | "duplicate" | "out_of_order" | "missing_amount";
  message: string;
}

interface ParseResult {
  transactions: Transaction[];
  issues: ValidationIssue[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function toNum(val: string): number {
  return parseFloat(val.replace(/,/g, "")) || 0;
}

function dateToInt(date: string): number {
  // DD/MM/YYYY → YYYYMMDD for comparison
  const [d, m, y] = date.split("/");
  return parseInt(`${y}${m?.padStart(2,"0")}${d?.padStart(2,"0")}`);
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(transactions: Transaction[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  let prevBalance: number | null = null;
  let prevDate: number | null = null;
  const seen = new Map<string, number>(); // key → first row index

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    const rowNum = i + 2; // +2 because row 1 is the header

    // ── Missing amount ──
    if (!t.debit && !t.credit) {
      issues.push({
        row: rowNum,
        type: "missing_amount",
        message: `Row ${rowNum} (${t.date} ${t.description}): no debit or credit amount`,
      });
    }

    // ── Out of order ──
    const dateInt = dateToInt(t.date);
    if (prevDate !== null && dateInt < prevDate) {
      issues.push({
        row: rowNum,
        type: "out_of_order",
        message: `Row ${rowNum} (${t.date}): date is earlier than previous row — possible ordering issue`,
      });
    }
    // Don't update prevDate if invalid
    if (!isNaN(dateInt)) prevDate = dateInt;

    // ── Duplicate detection ──
    // Two transactions are likely duplicates if same date + description + amount
    const key = `${t.date}|${t.description.toLowerCase()}|${t.debit}|${t.credit}`;
    if (seen.has(key)) {
      const firstRow = seen.get(key)! + 2;
      issues.push({
        row: rowNum,
        type: "duplicate",
        message: `Row ${rowNum}: possible duplicate of row ${firstRow} (${t.date} ${t.description} ${t.debit || t.credit})`,
      });
    } else {
      seen.set(key, i);
    }

    // ── Balance reconciliation ──
    // Only check rows that have both a balance and an amount
    if (t.balance && prevBalance !== null && (t.debit || t.credit)) {
      const debit  = toNum(t.debit);
      const credit = toNum(t.credit);
      const bal    = toNum(t.balance);
      const expected = parseFloat((prevBalance - debit + credit).toFixed(2));
      const actual   = parseFloat(bal.toFixed(2));

      if (Math.abs(expected - actual) > 0.02) {
        issues.push({
          row: rowNum,
          type: "balance_mismatch",
          message: `Row ${rowNum} (${t.date} ${t.description}): balance is ${bal.toFixed(2)} but expected ${expected.toFixed(2)} (prev balance ${prevBalance.toFixed(2)}, debit ${debit}, credit ${credit})`,
        });
      }
    }

    if (t.balance) prevBalance = toNum(t.balance);
  }

  return issues;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const PROMPT = `This is an Irish bank statement PDF (Bank of Ireland, AIB, PTSB, or similar).

Extract EVERY transaction from ALL pages in the EXACT ORDER they appear in the statement.
Return ONLY raw CSV with these columns (no header row, no markdown, no explanation):
Date,Description,Debit,Credit,Balance

Rules:
- Date format: DD/MM/YYYY
- Description: transaction name/reference
- Debit: money going OUT (positive number, no currency symbol). Empty if not applicable.
- Credit: money coming IN (positive number, no currency symbol). Empty if not applicable.
- Balance: running balance shown on that row. Empty if not shown on this row.
- Preserve exact order — do not reorder, group, or sort transactions
- Do not skip any transactions
- Do not repeat any transactions
- Skip only: Balance Forward, Subtotal, page headers, address, account info, deposit guarantee pages, abbreviations pages
- Payments IN (salary, transfers received, savings deposits received) → Credit column
- Payments OUT (purchases, bills, transfers sent) → Debit column`;

// ─── Parse Claude response ────────────────────────────────────────────────────

function parseResponse(text: string): Transaction[] {
  if (!text.trim()) return [];

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

// ─── PDF processing ───────────────────────────────────────────────────────────

async function processPDF(buffer: Buffer): Promise<ParseResult> {
  console.log(`PDF: ${buffer.length} bytes`);

  let fullText = "";

  const stream = await client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16000,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } } as any,
        { type: "text", text: PROMPT },
      ],
    }],
  });

  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      fullText += chunk.delta.text;
    }
  }

  const transactions = parseResponse(fullText);
  console.log(`Extracted: ${transactions.length} transactions`);

  const issues = validate(transactions);
  console.log(`Validation: ${issues.length} issues found`);
  issues.forEach((issue) => console.warn(` [${issue.type}] ${issue.message}`));

  return { transactions, issues };
}

// ─── Image processing ─────────────────────────────────────────────────────────

async function processImage(buffer: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"): Promise<ParseResult> {
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

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();

  const transactions = parseResponse(text);
  const issues = validate(transactions);
  return { transactions, issues };
}

// ─── Route ────────────────────────────────────────────────────────────────────

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
    const allIssues: ValidationIssue[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      let result: ParseResult = { transactions: [], issues: [] };

      if (file.type === "application/pdf") {
        result = await processPDF(buffer);
      } else if (["image/jpeg","image/png","image/webp","image/gif"].includes(file.type)) {
        result = await processImage(buffer, file.type as any);
      }

      // Offset row numbers for issues if multiple files
      const offset = allTransactions.length;
      result.issues.forEach((issue) => {
        allIssues.push({ ...issue, row: issue.row + offset });
      });

      allTransactions.push(...result.transactions);
    }

    if (allTransactions.length === 0) {
      return NextResponse.json({ error: "No transactions found." }, { status: 422 });
    }

    // Build CSV — add a WARNING column if there are issues on that row
    const issuesByRow = new Map<number, string>();
    allIssues.forEach((issue) => {
      const existing = issuesByRow.get(issue.row) ?? "";
      issuesByRow.set(issue.row, existing ? `${existing}; ${issue.type}` : issue.type);
    });

    const hasIssues = allIssues.length > 0;

    // Header — add WARNING column only if there are issues
    const header = hasIssues
      ? "Date,Description,Debit,Credit,Balance,WARNING"
      : "Date,Description,Debit,Credit,Balance";

    const rows = allTransactions.map((t, i) => {
      const rowNum = i + 2;
      const warning = issuesByRow.get(rowNum) ?? "";
      const base = [t.date, csvEscape(t.description), t.debit, t.credit, t.balance].join(",");
      return hasIssues ? `${base},${csvEscape(warning)}` : base;
    });

    const csv = [header, ...rows].join("\n");

    // Log summary
    if (allIssues.length > 0) {
      console.log(`\n⚠ ${allIssues.length} validation issue(s) found:`);
      allIssues.forEach((i) => console.warn(`  ${i.message}`));
    } else {
      console.log("✓ Validation passed — no issues found");
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="statement_${Date.now()}.csv"`,
        "X-Validation-Issues": String(allIssues.length),
      },
    });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to process." }, { status: 500 });
  }
}
