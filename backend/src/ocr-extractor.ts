import path from 'path';
import fs   from 'fs';

export async function extractTextFromFile(
  filePath: string,
  originalName: string,
): Promise<{
  text: string;
  method: string;
  confidence?: number;
  error?: string;
}> {
  const ext = path.extname(originalName).toLowerCase();

  // ── 1. Plain text files ───────────────────────────────────────────────────
  const TEXT_EXTS = [
    '.txt', '.md', '.csv', '.json', '.html', '.xml', '.ts', '.tsx',
    '.js', '.jsx', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.go',
    '.rs', '.rb', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
    '.sh', '.bat',
  ];

  if (TEXT_EXTS.includes(ext)) {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      return { text: text.slice(0, 12000), method: 'direct_read' };
    } catch (e: any) {
      return { text: '', method: 'direct_read_failed', error: e.message };
    }
  }

  // ── 2. PDF — layer 1: pdf-parse (text‑based PDFs) ────────────────────────
if (ext === '.pdf') {
  // ── Layer 1: text‑based PDF with pdf‑parse ────────────────────────────
   try {
    const { PdfReader } = require('pdfreader');
    const reader = new PdfReader();
    const buffer = fs.readFileSync(filePath);

    // Collect all text items
    const textLines: string[] = [];
    await new Promise<void>((resolve, reject) => {
      reader.parseBuffer(buffer, (err: any, item: any) => {
        if (err) reject(err);
        else if (!item) {
          // end of file
          resolve();
        } else if (item.text) {
          textLines.push(item.text);
        }
      });
    });

    const fullText = textLines.join(' ').trim();
    if (fullText.length > 80) {
      return { text: fullText.slice(0, 12000), method: 'pdfreader_text' };
    }
    console.log(`[OCR] pdfreader found little text (${fullText.length} chars), likely scanned`);
  } catch (e: any) {
    console.log(`[OCR] pdfreader failed: ${e.message}`);
  }
  // ── Layer 2: scanned PDF (pdf2pic + Tesseract) – needs Ghostscript ────
  try {
    const { fromPath } = require('pdf2pic');
    const outputDir    = path.join(path.dirname(filePath), `pdf_pages_${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const converter = fromPath(filePath, {
      density:      150,
      saveFilename: 'page',
      savePath:     outputDir,
      format:       'png',
      width:        1400,
      height:       1980,
    });

    const Tesseract = require('tesseract.js');
    const pageTexts: string[] = [];

    for (let page = 1; page <= 3; page++) {
      try {
        const result = await converter(page);
        if (!result?.path || !fs.existsSync(result.path)) break;
        const { data: { text } } = await Tesseract.recognize(result.path, 'eng+ara', { logger: () => {} });
        if (text.trim()) pageTexts.push(text.trim());
      } catch { break; }
    }

    try { fs.rmSync(outputDir, { recursive: true }); } catch {}

    if (pageTexts.length > 0) {
      const combined = pageTexts.join('\n\n--- Page Break ---\n\n');
      return { text: combined.slice(0, 12000), method: 'pdf_page_images_ocr' };
    }
  } catch (e: any) {
    console.log(`[OCR] pdf2pic layer failed: ${e.message}`);
  }

  return {
    text: '',
    method: 'pdf_all_failed',
    error: 'Could not extract text from this PDF. It may be a scanned document, and Ghostscript is not installed.',
  };
}
  // ── 3. Word documents (.docx / .doc) ─────────────────────────────────────
  if (ext === '.docx' || ext === '.doc') {
    try {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ path: filePath });
      const text    = (result.value || '').trim();
      if (text.length > 0) {
        return { text: text.slice(0, 12000), method: 'mammoth_docx' };
      }
    } catch (e: any) {
      console.log(`[OCR] mammoth failed: ${e.message}`);
    }
    return { text: '', method: 'docx_failed', error: 'Could not extract text from Word document.' };
  }

  // ── 4. Images — Tesseract.js ──────────────────────────────────────────────
  const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
  if (IMG_EXTS.includes(ext)) {
    try {
      const Tesseract = require('tesseract.js');
      const { data: { text, confidence } } = await Tesseract.recognize(
        filePath,
        'eng+ara',
        { logger: () => {} },
      );
      return {
        text: text.slice(0, 12000),
        method: 'tesseract_image_ocr',
        confidence: Math.round(confidence),
      };
    } catch (e: any) {
      return { text: '', method: 'tesseract_failed', error: `OCR failed: ${e.message}` };
    }
  }

  // ── 5. Excel / spreadsheets ────────────────────────────────────────────────
  if (['.xlsx', '.xls', '.ods'].includes(ext)) {
    try {
      const XLSX = require('xlsx');
      const wb   = XLSX.readFile(filePath);
      const lines: string[] = [];
      for (const sheetName of wb.SheetNames.slice(0, 3)) {
        const sheet = wb.Sheets[sheetName];
        const csv   = XLSX.utils.sheet_to_csv(sheet);
        lines.push(`=== Sheet: ${sheetName} ===\n${csv}`);
      }
      return { text: lines.join('\n\n').slice(0, 12000), method: 'xlsx_read' };
    } catch (e: any) {
      return { text: '', method: 'xlsx_failed', error: `Excel read failed: ${e.message}` };
    }
  }

  // ── 6. Fallback: try UTF-8 read for anything else ─────────────────────────
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const printable = raw.replace(/[^\x20-\x7E\n\r\t\u0600-\u06FF]/g, '').length;
    if (printable / raw.length > 0.85) {
      return { text: raw.slice(0, 12000), method: 'utf8_fallback' };
    }
  } catch {}

  return {
    text: '',
    method: 'unsupported',
    error: `Unsupported file type: ${ext}`,
  };
}