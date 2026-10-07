/**
 * Voice Summary & Speech Sanitization Utility.
 * Ensures TTS receives only clean, natural, spoken English:
 * - Strips all Markdown symbols, code blocks, tables, URLs, citations
 * - Eliminates leaked UI artifacts like "svgListen", "svg", "NaviGraph Agent", "Agent steps"
 * - Extracts a concise, natural 1-3 sentence summary suitable for audio playback
 */

/**
 * Strips all non-spoken formatting, markdown artifacts, tables, code, and UI leakage.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return '';

  return (
    text
      // 1. Remove leaked UI elements and metadata
      .replace(/\bsvgListen\b/gi, ' ')
      .replace(/\bsvg\b/gi, ' ')
      .replace(/\bNaviGraph Agent\b/gi, ' ')
      .replace(/\bAgent steps\b/gi, ' ')
      .replace(/\bAgent thinking\b/gi, ' ')
      .replace(/\bThinking Steps\b/gi, ' ')
      .replace(/\bListen\b/g, ' ')

      // 2. Remove fenced code blocks and inline code
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')

      // 3. Remove Markdown tables entirely (lines starting and ending with | or containing table syntax)
      .replace(/^\|.*\|$/gm, ' ')
      .replace(/\|[\s-:]+\|/g, ' ')
      .replace(/\|/g, ', ')

      // 4. Remove URLs
      .replace(/https?:\/\/\S+/gi, ' ')

      // 5. Remove citations, sources, brackets, page markers
      .replace(/\[(?:Source|source|Result|result|Page|page)[^\]]*\]/gi, ' ')
      .replace(/\((?:Source|source|Result|result|Page|page)[^)]*\)/gi, ' ')
      .replace(/\[\d+\]/g, ' ')
      .replace(/\[(?:p\.|page)\s*\d+[^\]]*\]/gi, ' ')
      .replace(/\((?:p\.|page)\s*\d+[^)]*\)/gi, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

      // 6. Remove HTML tags & br elements
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')

      // 7. Remove headers, bold, italics, strikethrough
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')

      // 8. Remove list markers, bullets, and numbered prefixes
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^[\s*+-]+\s+/gm, '')

      // 9. Clean up whitespace and punctuation runs
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim()
  );
}

/**
 * Extracts a concise 1-3 sentence natural spoken summary from a full markdown answer.
 * Used when speaking or playing TTS so the user hears a quick conversational answer
 * while the full detailed explanation and code remain visible in the chat UI.
 */
export function extractVoiceSummary(fullText: string): string {
  if (!fullText) return '';

  const cleaned = cleanTextForSpeech(fullText);
  if (!cleaned) return '';

  // Match sentences (ending with ., !, or ?)
  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [];

  if (sentences.length === 0) {
    return cleaned.slice(0, 220).trim();
  }

  // Filter out very short fragments (like single words or punctuation)
  const validSentences = sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && !/^(e\.g|i\.e|mr|mrs|dr|vs)\.?$/i.test(s));

  if (validSentences.length === 0) {
    return cleaned.slice(0, 220).trim();
  }

  // Take the first 1 to 3 sentences (aiming for roughly 120 - 320 characters for quick natural speech)
  let summary = '';
  for (let i = 0; i < Math.min(3, validSentences.length); i++) {
    const candidate = summary ? `${summary} ${validSentences[i]}` : validSentences[i];
    if (candidate.length > 360 && i > 0) {
      break;
    }
    summary = candidate;
  }

  return summary || validSentences[0];
}
