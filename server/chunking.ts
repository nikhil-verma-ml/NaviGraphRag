import { GoogleGenAI } from '@google/genai';
// @ts-ignore
import * as pdfParseModule from 'pdf-parse';
const pdfParse: any = (pdfParseModule as any).default || pdfParseModule;

export interface ExtractedChunk {
  content: string;
  source: string;
  title: string;
  pageNumber?: number;
}

/**
 * Checks if a block of text looks like a Markdown / ASCII table.
 */
function isTableBlock(text: string): boolean {
  const lines = text.split('\n');
  const pipeLines = lines.filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));
  return pipeLines.length >= 2;
}

/**
 * Structure-aware and semantic chunking:
 * - Respects Markdown headers, paragraphs, and list blocks.
 * - Keeps tables atomic (never splits table rows across chunks).
 * - Target chunk size ~800-1000 characters with 150 char overlap.
 */
export function chunkStructuredText(
  fullText: string,
  sourceName: string,
  pageNumber?: number,
  targetChunkSize = 900,
  overlap = 150
): ExtractedChunk[] {
  if (!fullText || !fullText.trim()) return [];

  const chunks: ExtractedChunk[] = [];

  // Split text by markdown headings or double newlines (paragraphs/sections)
  // Preserves delimiters
  const sections = fullText.split(/\n(?=(?:#{1,6}\s+|---|\*\*\*))/g);

  let currentBuffer = '';

  const commitBuffer = () => {
    const trimmed = currentBuffer.trim();
    if (trimmed.length > 20) {
      chunks.push({
        content: trimmed,
        source: sourceName,
        title: sourceName,
        pageNumber,
      });
    }
    // Retain overlap if long enough
    if (currentBuffer.length > overlap) {
      currentBuffer = currentBuffer.slice(-overlap);
    } else {
      currentBuffer = '';
    }
  };

  for (const section of sections) {
    // If section contains a table, keep table block intact
    if (isTableBlock(section)) {
      if (currentBuffer.length > 0) {
        commitBuffer();
      }
      chunks.push({
        content: section.trim(),
        source: sourceName,
        title: sourceName,
        pageNumber,
      });
      currentBuffer = '';
      continue;
    }

    // Split paragraphs inside the section
    const paragraphs = section.split(/\n\s*\n/);

    for (const para of paragraphs) {
      const cleanPara = para.trim();
      if (!cleanPara) continue;

      if (currentBuffer.length + cleanPara.length + 2 <= targetChunkSize) {
        currentBuffer += (currentBuffer ? '\n\n' : '') + cleanPara;
      } else {
        if (currentBuffer.length > 0) {
          commitBuffer();
        }

        // If the paragraph itself is larger than targetChunkSize, chunk by sentence
        if (cleanPara.length > targetChunkSize) {
          const sentences = cleanPara.match(/[^.!?।\n]+[.!?।\n]+/g) || [cleanPara];
          for (const s of sentences) {
            if (currentBuffer.length + s.length <= targetChunkSize) {
              currentBuffer += (currentBuffer ? ' ' : '') + s.trim();
            } else {
              commitBuffer();
              currentBuffer = s.trim();
            }
          }
        } else {
          currentBuffer = cleanPara;
        }
      }
    }
  }

  if (currentBuffer.trim().length > 0) {
    commitBuffer();
  }

  return chunks;
}

/**
 * Parses a PDF buffer page-by-page.
 * Automatically detects scanned pages with sparse text and performs OCR fallback via Gemini Vision.
 */
export async function parsePdfWithPages(
  pdfBuffer: Buffer,
  sourceName: string
): Promise<ExtractedChunk[]> {
  const chunks: ExtractedChunk[] = [];

  try {
    const pageTexts: { pageNum: number; text: string }[] = [];

    // Custom pagerender to isolate text per page
    const options = {
      pagerender: (pageData: any) => {
        return pageData.getTextContent().then((textContent: any) => {
          let lastY: number | null = null;
          let text = '';
          for (const item of textContent.items) {
            if (lastY === item.transform[5] || !lastY) {
              text += item.str;
            } else {
              text += '\n' + item.str;
            }
            lastY = item.transform[5];
          }
          return text;
        });
      },
    };

    const data = await pdfParse(pdfBuffer, options as any);
    const numPages = data.numpages || 1;

    // Split pages using page break or regex if pagerender combined text
    const rawPages = data.text.split(/\f|\n--\s*\d+\s*--\n/g);

    for (let p = 0; p < numPages; p++) {
      const pageNum = p + 1;
      let text = (rawPages[p] || '').trim();

      // Check if this page is scanned / empty (< 40 characters)
      if (text.length < 40) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (apiKey) {
          try {
            console.log(`[OCR] Scanned page detected on page ${pageNum} of ${sourceName}. Running Gemini Vision OCR...`);
            const ai = new GoogleGenAI({
              apiKey,
              httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
            });

            // Send page buffer as PDF page for OCR extraction
            const ocrResponse = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'application/pdf',
                        data: pdfBuffer.toString('base64'),
                      },
                    },
                    {
                      text: `You are an accurate OCR document engine. Extract all text, headings, data, and tables from page ${pageNum} of this PDF. Output cleanly in Markdown format. If there is a table, format it with Markdown table syntax.`,
                    },
                  ],
                },
              ],
            });

            const ocrText = ocrResponse.text || '';
            if (ocrText.trim().length > 30) {
              text = ocrText;
              console.log(`[OCR] Successfully extracted ${text.length} chars from page ${pageNum}`);
            }
          } catch (ocrErr: any) {
            console.warn(`[OCR] Fallback OCR error on page ${pageNum}:`, ocrErr.message || ocrErr);
          }
        }
      }

      if (!text || text.length < 10) {
        text = `Page ${pageNum} in ${sourceName}`;
      }

      const pageChunks = chunkStructuredText(text, sourceName, pageNum);
      chunks.push(...pageChunks);
    }
  } catch (err: any) {
    console.warn(`[parsePdfWithPages] Standard parsing notice:`, err.message || err);
    // Fallback: chunk whatever text is available
    const fallbackChunks = chunkStructuredText(
      pdfBuffer.toString('utf-8').slice(0, 10000),
      sourceName,
      1
    );
    chunks.push(...fallbackChunks);
  }

  return chunks;
}
