// src/utils/assGenerator.js
// Generates Advanced SubStation Alpha (.ass) subtitle files from word-level
// transcript data produced by Gemini.
//
// The output uses the "karaoke pop" style: bold yellow text with a white
// outline, centred vertically in the lower third of a 9:16 frame.
// Groups words into short phrases (≤4 words) for maximum readability.

/**
 * @typedef {Object} WordTimestamp
 * @property {string} word  - The word.
 * @property {number} start - Start time in seconds.
 * @property {number} end   - End time in seconds.
 */

/**
 * Convert floating-point seconds to ASS timestamp format: H:MM:SS.cs
 *
 * @param {number} seconds
 * @returns {string}
 */
function toAssTimestamp(seconds) {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100); // centiseconds
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Group an array of word timestamps into phrase chunks of at most
 * `maxWords` words each.
 *
 * @param {WordTimestamp[]} words
 * @param {number}          maxWords
 * @returns {{ phrase: string, start: number, end: number }[]}
 */
function groupIntoPhrases(words, maxWords = 4) {
  const phrases = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunk = words.slice(i, i + maxWords);
    phrases.push({
      phrase: chunk.map((w) => w.word).join(' '),
      start:  chunk[0].start,
      end:    chunk[chunk.length - 1].end,
    });
  }
  return phrases;
}

/**
 * Build the ASS [Script Info] and [V4+ Styles] header block.
 * Targets a 1080×1920 vertical frame (9:16).
 *
 * @returns {string}
 */
function buildAssHeader() {
  return `[Script Info]
Title: AutoClipper Captions
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1080
PlayResY: 1920
Timer: 100.0000

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Inter,90,&H0000FFFF,&H000000FF,&H00FFFFFF,&H80000000,-1,0,0,0,100,100,2,0,1,5,2,2,80,80,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Escape curly-brace override codes in plain text to avoid ASS parser issues.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeAssText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/{/g,  '\\{')
    .replace(/}/g,  '\\}')
    .replace(/\n/g, '\\N');
}

/**
 * Generate a complete .ass subtitle file string from word-level transcript data.
 *
 * @param {WordTimestamp[]} wordTimestamps - Array of { word, start, end }.
 * @param {object}          [options]
 * @param {number}          [options.maxWordsPerPhrase=4] - Words per caption line.
 * @param {number}          [options.minGapSec=0.05]      - Minimum gap between adjacent phrases (seconds).
 * @returns {string} The full .ass file content as a string.
 */
export function generateAssFile(wordTimestamps, options = {}) {
  const { maxWordsPerPhrase = 4, minGapSec = 0.05 } = options;

  if (!Array.isArray(wordTimestamps) || wordTimestamps.length === 0) {
    throw new Error('wordTimestamps must be a non-empty array');
  }

  const phrases = groupIntoPhrases(wordTimestamps, maxWordsPerPhrase);

  let dialogueLines = '';
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];

    // Clamp end time so it doesn't overlap the next phrase
    let end = p.end;
    if (i < phrases.length - 1) {
      end = Math.min(end, phrases[i + 1].start - minGapSec);
    }

    // Ensure non-negative duration
    if (end <= p.start) end = p.start + 0.5;

    const startTs = toAssTimestamp(p.start);
    const endTs   = toAssTimestamp(end);
    const text    = escapeAssText(p.phrase.toUpperCase());

    // Dialogue line format:
    // Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    dialogueLines += `Dialogue: 0,${startTs},${endTs},Caption,,0,0,0,,${text}\n`;
  }

  return buildAssHeader() + dialogueLines;
}
