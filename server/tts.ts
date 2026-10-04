import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { ttsCache } from './cache.js';

/**
 * Strips markdown formatting (bold, bullets, headers, links, code blocks)
 * and citations. Prepares clean conversational text for TTS.
 */
export function prepareTextForTTS(rawText: string, maxSentences = 3): string {
  if (!rawText) return '';

  let text = rawText;

  // 1. Remove code blocks ```...```
  text = text.replace(/```[\s\S]*?```/g, ' ');

  // 2. Remove inline code `...`
  text = text.replace(/`([^`]+)`/g, '$1');

  // 3. Remove images ![alt](url) and links [text](url) -> text
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // 4. Remove citations and source markers:
  // e.g. [Result 1 (source: ...)], [Result 1 ...], [source: ...], [1], (source: ...)
  text = text.replace(/\[(?:Result\s*)?\d+[^\]]*\]/gi, ' ');
  text = text.replace(/\[source:[^\]]*\]/gi, ' ');
  text = text.replace(/\(source:[^)]*\)/gi, ' ');
  text = text.replace(/\[\d+\]/g, ' ');

  // 5. Remove markdown headers: # Header -> Header
  text = text.replace(/^#{1,6}\s+/gm, '');

  // 6. Remove bold/italics: **text**, *text*, __text__, _text_
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');

  // 7. Remove blockquotes > text -> text
  text = text.replace(/^>\s+/gm, '');

  // 8. Remove list bullets: - , * , 1. , etc.
  text = text.replace(/^[\s*+-]+\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');

  // 9. Remove horizontal rules
  text = text.replace(/^(?:---|\*\*\*|___)\s*$/gm, '');

  // 10. Clean conversational replacements
  text = text.replace(/&/g, ' and ');
  text = text.replace(/%/g, ' percent ');
  text = text.replace(/\+/g, ' plus ');

  // 11. Clean up extra whitespace and newlines
  text = text.replace(/\s+/g, ' ').trim();

  // 12. If maxSentences is specified, limit to that many sentences
  if (maxSentences > 0) {
    const sentenceRegex = /[^.!?।]+(?:[.!?।]+|$)/g;
    const sentences = text.match(sentenceRegex) || [];
    if (sentences.length > maxSentences) {
      const selected = sentences
        .slice(0, maxSentences)
        .map((s) => s.trim())
        .filter(Boolean);
      text = selected.join(' ');
    }
  }

  return text;
}

/**
 * Detects whether the text is mostly Hindi.
 * Returns 'hi-IN-SwaraNeural' if mostly Hindi, otherwise 'en-IN-NeerjaNeural'.
 */
export function detectVoice(text: string): string {
  if (!text) return 'en-IN-NeerjaNeural';

  // Check Devanagari script characters (\u0900 - \u097F)
  const devanagariMatches = text.match(/[\u0900-\u097F]/g);
  const devanagariCount = devanagariMatches ? devanagariMatches.length : 0;

  // Total letter characters
  const letterMatches = text.match(/[\p{L}]/gu);
  const totalLetters = letterMatches ? letterMatches.length : 0;

  if (totalLetters > 0 && devanagariCount / totalLetters > 0.15) {
    return 'hi-IN-SwaraNeural';
  }

  // Check common Hindi words in Romanized/Hinglish text
  const hindiKeywords = [
    'kya', 'hai', 'hain', 'mein', 'nahi', 'nahin', 'kaise', 'aur', 'yeh',
    'woh', 'bhi', 'karna', 'hoga', 'hota', 'hoti', 'hote', 'chahiye',
    'karo', 'karein', 'aap', 'tum', 'hum', 'mujhe', 'humko', 'kuch', 'accha',
    'namaste', 'dhanyavad', 'shukriya', 'theek', 'bahut', 'sirf', 'lekin'
  ];
  const words = text.toLowerCase().split(/\s+/);
  if (words.length >= 4) {
    const matchedCount = words.filter((w) => hindiKeywords.includes(w)).length;
    if (matchedCount / words.length > 0.2) {
      return 'hi-IN-SwaraNeural';
    }
  }

  return 'en-IN-NeerjaNeural';
}

/**
 * Synthesizes text to an MP3 buffer using edge-tts.
 */
export async function synthesizeEdgeTTS(
  text: string,
  preferredVoice?: string,
  maxSentences?: number
): Promise<{ buffer: Buffer; voice: string; spokenText: string }> {
  const preparedText = prepareTextForTTS(text, maxSentences);
  if (!preparedText.trim()) {
    throw new Error('No speakable text after cleaning');
  }

  const voice = preferredVoice || detectVoice(preparedText);

  // Check TTS Cache
  const cached = ttsCache.get(preparedText, voice);
  if (cached) {
    return cached;
  }

  const tts = new MsEdgeTTS();

  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(preparedText);

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    audioStream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    audioStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    audioStream.on('error', (err) => {
      reject(err);
    });
  });

  const result = { buffer, voice, spokenText: preparedText };
  ttsCache.set(preparedText, voice, result);
  return result;
}
