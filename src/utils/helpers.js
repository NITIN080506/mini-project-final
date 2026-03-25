import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

export const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
export const GROQ_MODEL = import.meta.env.VITE_GROQ_MODEL || 'llama-3.3-70b-versatile';
export const ASSESSMENT_TABLE = 'student_assessment_results';
export const GOALS_TABLE = 'student_goals';
export const SELF_MATERIALS_TABLE = 'student_self_materials';

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

export const isMissingTableError = (error) => {
  if (!error) return false;
  if (MISSING_TABLE_CODES.has(error.code)) return true;
  return /does not exist|relation .* does not exist|table .* not found/i.test(String(error.message || ''));
};

let ensureAssessmentTablePromise = null;
let ensureGoalsTablePromise = null;
let ensureSelfMaterialsTablePromise = null;

export const ensureAssessmentResultsTable = async (supabase) => {
  if (!supabase) return { ok: false, reason: 'missing_client' };
  if (ensureAssessmentTablePromise) return ensureAssessmentTablePromise;

  ensureAssessmentTablePromise = (async () => {
    const probe = await supabase.from(ASSESSMENT_TABLE).select('id').limit(1);
    if (!probe.error) return { ok: true, created: false };
    if (!isMissingTableError(probe.error)) {
      return { ok: false, reason: 'probe_failed', error: probe.error };
    }

    const rpcResult = await supabase.rpc('ensure_student_assessment_results_table');
    if (rpcResult.error && rpcResult.error.code === 'PGRST202') {
      return { ok: false, reason: 'missing_rpc', error: rpcResult.error };
    }
    if (rpcResult.error) return { ok: false, error: rpcResult.error };

    const recheck = await supabase.from(ASSESSMENT_TABLE).select('id').limit(1);
    if (recheck.error) return { ok: false, reason: 'recheck_failed', error: recheck.error };
    return { ok: true, created: true };
  })();

  try {
    return await ensureAssessmentTablePromise;
  } finally {
    ensureAssessmentTablePromise = null;
  }
};

export const ensureStudentGoalsTable = async (supabase) => {
  if (!supabase) return { ok: false, reason: 'missing_client' };
  if (ensureGoalsTablePromise) return ensureGoalsTablePromise;

  ensureGoalsTablePromise = (async () => {
    const probe = await supabase.from(GOALS_TABLE).select('id').limit(1);
    if (!probe.error) return { ok: true, created: false };
    if (!isMissingTableError(probe.error)) {
      return { ok: false, reason: 'probe_failed', error: probe.error };
    }

    const rpcResult = await supabase.rpc('ensure_student_goals_table');
    if (rpcResult.error && rpcResult.error.code === 'PGRST202') {
      return { ok: false, reason: 'missing_rpc', error: rpcResult.error };
    }
    if (rpcResult.error) return { ok: false, error: rpcResult.error };

    const recheck = await supabase.from(GOALS_TABLE).select('id').limit(1);
    if (recheck.error) return { ok: false, reason: 'recheck_failed', error: recheck.error };
    return { ok: true, created: true };
  })();

  try {
    return await ensureGoalsTablePromise;
  } finally {
    ensureGoalsTablePromise = null;
  }
};

export const ensureStudentSelfMaterialsTable = async (supabase) => {
  if (!supabase) return { ok: false, reason: 'missing_client' };
  if (ensureSelfMaterialsTablePromise) return ensureSelfMaterialsTablePromise;

  ensureSelfMaterialsTablePromise = (async () => {
    const probe = await supabase.from(SELF_MATERIALS_TABLE).select('id').limit(1);
    if (!probe.error) return { ok: true, created: false };
    if (!isMissingTableError(probe.error)) {
      return { ok: false, reason: 'probe_failed', error: probe.error };
    }

    const rpcResult = await supabase.rpc('ensure_student_self_materials_table');
    if (rpcResult.error && rpcResult.error.code === 'PGRST202') {
      return { ok: false, reason: 'missing_rpc', error: rpcResult.error };
    }
    if (rpcResult.error) return { ok: false, error: rpcResult.error };

    const recheck = await supabase.from(SELF_MATERIALS_TABLE).select('id').limit(1);
    if (recheck.error) return { ok: false, reason: 'recheck_failed', error: recheck.error };
    return { ok: true, created: true };
  })();

  try {
    return await ensureSelfMaterialsTablePromise;
  } finally {
    ensureSelfMaterialsTablePromise = null;
  }
};

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export const splitTextIntoPages = (text, wordsPerPage = 220) => {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const words = normalized.split(' ');
  const pages = [];
  for (let index = 0; index < words.length; index += wordsPerPage) {
    pages.push(words.slice(index, index + wordsPerPage).join(' '));
  }
  return pages;
};

export const parseCourseMaterial = (materialJson) => {
  if (!materialJson) return { pages: [] };
  try {
    const parsed = JSON.parse(materialJson);
    return parsed && parsed.pages ? parsed : { pages: [] };
  } catch (e) {
    return { pages: [] };
  }
};

export const createQuestionsForPage = (pageText) => {
  const uniqueWords = (text) => {
    const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'have', 'will', 'about', 'which', 'when', 'where', 'what', 'there', 'their', 'been', 'were', 'them', 'than', 'then', 'also', 'into']);
    return [...new Set((text.toLowerCase().match(/[a-z]{5,}/g) || []).filter(word => !stopWords.has(word)))];
  };

  const words = uniqueWords(pageText);
  const focusWord = words[0] || 'concept';
  const distractors = words.slice(1, 4);
  while (distractors.length < 3) distractors.push(`option${distractors.length + 1}`);
  const options = [focusWord, ...distractors].sort(() => Math.random() - 0.5);

  const sentence = (pageText.match(/[^.!?]+[.!?]/)?.[0] || pageText).trim();
  const blankableWord = (sentence.match(/\b[a-zA-Z]{5,}\b/) || [focusWord])[0];
  const blankPrompt = sentence.replace(blankableWord, '________');
  const shortAnswerQuestion = sentence
    ? `Based on this page, explain: ${sentence.replace(/[.!?]+$/, '')}.`
    : 'Explain the most important concept from this page in 1-2 sentences.';

  return {
    summary: sentence,
    quiz: {
      question: 'Which keyword best represents this page?',
      options,
      answer: focusWord,
    },
    shortAnswer: {
      question: shortAnswerQuestion,
      answer: sentence || `The core concept is ${focusWord}.`,
    },
    // Backward-compatible field for older consumers.
    fillBlank: {
      prompt: blankPrompt,
      answer: blankableWord,
    },
  };
};

export const extractTextFromDocument = async (file) => {
  if (file.type.includes('pdf')) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
  } else if (file.type.includes('word')) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } else if (file.type.includes('text') || file.name.endsWith('.txt')) {
    return await file.text();
  }
  throw new Error('Unsupported file type');
};
