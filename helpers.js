/* Pure helper functions (no DOM access) so they are easy to test. */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildPrompt(numQuestions, difficulty) {
  return `You are a helpful study assistant. Look carefully at the attached image of textbook pages or handwritten notes. Read all the text and diagrams in it.

Reply with ONLY a valid JSON object (no markdown fences, no extra text) in this exact shape:
{
  "topic": "short title for what the page is about",
  "summary": "a clear summary of 3 to 5 sentences",
  "key_terms": [{"term": "...", "meaning": "one-line definition"}],
  "questions": [{"question": "...", "answer": "..."}]
}

Rules:
- Give 3 to 6 key terms. Each "term" must be written exactly as it appears in your summary, so it can be highlighted there.
- Give exactly ${numQuestions} practice questions at ${difficulty} difficulty.
- Questions must be answerable from the content of the image.
- Keep answers short and correct.
- Use plain text only inside the JSON values: no markdown, no asterisks, no backticks.
- If the image has no readable study content, return an empty summary and an empty questions list.`;
}

/* Pull the first JSON object out of a model reply, even if it adds extra text. */
function extractJson(text) {
  const cleaned = String(text ?? '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object found');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Unexpected reply shape');
  const str = (v) => (typeof v === 'string' ? v.replace(/\*\*|__|`/g, '').trim() : '');
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    topic: str(raw.topic),
    summary: str(raw.summary),
    keyTerms: list(raw.key_terms)
      .map((t) => ({ term: str(t && t.term), meaning: str(t && t.meaning) }))
      .filter((t) => t.term && t.meaning),
    questions: list(raw.questions)
      .map((q) => ({ question: str(q && q.question), answer: str(q && q.answer) }))
      .filter((q) => q.question && q.answer),
  };
}

const isWordChar = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/* Returns safe HTML for `text` with the first whole-word match of each key term wrapped in <mark>. */
function highlightTerms(text, keyTerms) {
  const lower = text.toLowerCase();
  const ranges = [];
  keyTerms.forEach((item, index) => {
    const needle = item.term.trim().toLowerCase();
    if (needle.length < 3) return;
    let from = 0;
    while (true) {
      const at = lower.indexOf(needle, from);
      if (at === -1) return;
      const before = text[at - 1];
      const after = text[at + needle.length];
      if (!isWordChar(before) && !isWordChar(after)) {
        ranges.push({ start: at, end: at + needle.length, index });
        return;
      }
      from = at + 1;
    }
  });
  ranges.sort((a, b) => a.start - b.start);

  const out = [];
  let pos = 0;
  let n = 0;
  for (const r of ranges) {
    if (r.start < pos) continue; // skip overlaps
    out.push(esc(text.slice(pos, r.start)));
    out.push(
      `<mark class="hl" style="--d:${500 + n * 380}ms" data-term="${r.index}" tabindex="0" role="button" aria-label="Show meaning of ${esc(text.slice(r.start, r.end))}">${esc(text.slice(r.start, r.end))}</mark>`
    );
    pos = r.end;
    n += 1;
  }
  out.push(esc(text.slice(pos)));
  return out.join('');
}

function resultToText(result) {
  const lines = [];
  if (result.topic) lines.push(result.topic, '');
  lines.push(result.summary, '');
  if (result.keyTerms.length) {
    lines.push('Key terms');
    result.keyTerms.forEach((t) => lines.push(`- ${t.term}: ${t.meaning}`));
    lines.push('');
  }
  if (result.questions.length) {
    lines.push('Practice questions');
    result.questions.forEach((q, i) => lines.push(`${i + 1}. ${q.question}`, `   Answer: ${q.answer}`));
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = { esc, buildPrompt, extractJson, normalizeResult, highlightTerms, resultToText };
}
