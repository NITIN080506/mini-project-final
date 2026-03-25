import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ensureAssessmentResultsTable, isMissingTableError, SELF_MATERIALS_TABLE } from '../utils/helpers';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import {
  ChevronRight,
  Activity,
  HelpCircle,
  MessageSquare,
  Loader2,
  BookOpen,
  Video,
  AlertCircle
} from 'lucide-react';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = import.meta.env.VITE_GROQ_MODEL || 'llama-3.3-70b-versatile';
const ASSESSMENT_TABLE = 'student_assessment_results';
const ANSWER_EVENT_PREFIX = '__ASSESSMENT_ANSWER__:';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const normalizeAssessment = (page, contentText) => {
  const quizSource = page?.quiz || page?.content?.assessment?.quiz || page?.assessment?.quiz || {};
  const fillSource = page?.fillBlank || page?.content?.assessment?.fillBlank || page?.assessment?.fillBlank || {};
  const shortSource = page?.shortAnswer || page?.content?.assessment?.shortAnswer || page?.assessment?.shortAnswer || {};

  const optionsRaw = Array.isArray(quizSource?.options)
    ? quizSource.options
    : (Array.isArray(quizSource?.choices) ? quizSource.choices : []);
  const options = optionsRaw.map((option) => String(option || '').trim()).filter(Boolean);

  let answer = String(quizSource?.answer || '').trim();
  if (!answer && Number.isInteger(quizSource?.correct) && options.length > 0) {
    answer = String(options[quizSource.correct] || '').trim();
  }
  if (!answer && typeof quizSource?.correct === 'string') {
    answer = quizSource.correct.trim();
  }

  const quizQuestion = String(quizSource?.question || '').trim();
  const legacyFillPrompt = String(fillSource?.prompt || fillSource?.question || '').trim();
  const safeContentSentence = String((contentText || '').match(/[^.!?]+[.!?]/)?.[0] || '').trim();
  const shortQuestion = (() => {
    const candidate = String(shortSource?.question || '').trim();
    if (candidate) return candidate;

    if (legacyFillPrompt) {
      const cleaned = legacyFillPrompt.replace(/[_]{2,}/g, '...').trim();
      return `Explain the key idea in this statement: ${cleaned}`;
    }

    if (safeContentSentence) {
      return `In your own words, explain: ${safeContentSentence.replace(/[.!?]+$/, '')}.`;
    }

    return 'Explain the main idea from this page in 1-2 sentences.';
  })();
  const shortAnswer = String(shortSource?.answer || shortSource?.idealAnswer || fillSource?.answer || fillSource?.correct || '').trim();

  if (quizQuestion && options.length > 0 && answer && shortQuestion && shortAnswer) {
    return {
      quiz: {
        question: quizQuestion,
        options,
        answer,
      },
      shortAnswer: {
        question: shortQuestion,
        answer: shortAnswer,
      },
    };
  }

  const generated = createQuestionsForPage(contentText || '');
  return {
    quiz: generated.quiz,
    shortAnswer: generated.shortAnswer,
  };
};

const normalizeMaterialPage = (page, index) => {
  const contentSource = page?.content;
  const contentText = typeof contentSource === 'string'
    ? contentSource
    : (typeof contentSource?.text === 'string'
      ? contentSource.text
      : (typeof page?.text === 'string'
        ? page.text
        : (typeof page?.summary === 'string' ? page.summary : '')));

  const safeContent = String(contentText || '').trim();
  const summaryFromPage = String(
    page?.summary
    || contentSource?.summary
    || contentSource?.text
    || safeContent
    || ''
  ).trim();
  const safeSummary = summaryFromPage
    ? summaryFromPage.slice(0, 320)
    : 'Summary not available for this page.';
  const pageTitle = String(page?.title || '').trim() || `Page ${index + 1}`;
  const assessment = normalizeAssessment(page, safeContent);

  return {
    pageNumber: Number(page?.pageNumber || page?.page || index + 1),
    title: pageTitle,
    content: safeContent,
    summary: safeSummary,
    quiz: assessment.quiz,
    shortAnswer: assessment.shortAnswer,
  };
};

const parseCourseMaterial = (materialInput) => {
  if (!materialInput) return { pages: [] };

  let parsed = materialInput;
  if (typeof materialInput === 'string') {
    const trimmed = materialInput.trim();
    if (!trimmed) return { pages: [] };

    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      const fallbackAssessment = createQuestionsForPage(trimmed);
      return {
        pages: [
          {
            pageNumber: 1,
            title: 'Page 1',
            content: trimmed,
            summary: trimmed.slice(0, 320),
            quiz: fallbackAssessment.quiz,
            shortAnswer: fallbackAssessment.shortAnswer,
          },
        ],
      };
    }
  }

  if (Array.isArray(parsed)) {
    return { pages: parsed.map((page, index) => normalizeMaterialPage(page, index)) };
  }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.pages)) {
    return { pages: parsed.pages.map((page, index) => normalizeMaterialPage(page, index)) };
  }

  return { pages: [] };
};

const createQuestionsForPage = (pageText) => {
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

  return {
    summary: sentence,
    quiz: {
      question: 'Which keyword best represents this page?',
      options,
      answer: focusWord,
    },
    shortAnswer: {
      question: sentence
        ? `Based on this page, explain: ${sentence.replace(/[.!?]+$/, '')}.`
        : 'Explain the most important concept from this page in 1-2 sentences.',
      answer: sentence || `The core concept is ${focusWord}.`,
    },
  };
};

const encodeAssessmentAnswerContent = (payload) => {
  try {
    return `${ANSWER_EVENT_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
  } catch (err) {
    return `${ANSWER_EVENT_PREFIX}${encodeURIComponent('{}')}`;
  }
};

const parseAssessmentAnswerContent = (content) => {
  if (typeof content !== 'string' || !content.startsWith(ANSWER_EVENT_PREFIX)) return null;
  try {
    const encoded = content.slice(ANSWER_EVENT_PREFIX.length);
    const decoded = decodeURIComponent(encoded);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
};

const isAssessmentEvent = (message) => {
  const type = message?.metadata?.type;
  if (type === 'assessment_result' || type === 'assessment_answer') return true;
  return Boolean(parseAssessmentAnswerContent(message?.content));
};

export default function CourseViewerPage() {
  const navigate = useNavigate();
  const { courseId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { supabase, user, courses } = useAuth();

  const normalizedCourseId = (() => {
    try {
      return decodeURIComponent(courseId || '');
    } catch (e) {
      return courseId || '';
    }
  })();
  const isSelfMaterialMode = searchParams.get('isSelfMaterial') === 'true';
  const assignedCourse = courses.find((c) => String(c?.id) === String(normalizedCourseId));
  const [selfMaterialCourse, setSelfMaterialCourse] = useState(null);
  const [isSelfMaterialLoading, setIsSelfMaterialLoading] = useState(false);
  const course = isSelfMaterialMode ? selfMaterialCourse : assignedCourse;
  const safeUserId = user?.id || 'unknown-user';

  useEffect(() => {
    if (!isSelfMaterialMode) {
      setSelfMaterialCourse(null);
      setIsSelfMaterialLoading(false);
      return;
    }

    if (!supabase || !user?.id || !normalizedCourseId) return;

    let cancelled = false;

    const fetchSelfMaterial = async () => {
      setIsSelfMaterialLoading(true);
      try {
        const { data, error } = await supabase
          .from(SELF_MATERIALS_TABLE)
          .select('id, title, material, created_at')
          .eq('id', normalizedCourseId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!cancelled) {
          if (error || !data) {
            setSelfMaterialCourse(null);
          } else {
            setSelfMaterialCourse(data);
          }
        }
      } finally {
        if (!cancelled) {
          setIsSelfMaterialLoading(false);
        }
      }
    };

    fetchSelfMaterial();

    return () => {
      cancelled = true;
    };
  }, [isSelfMaterialMode, supabase, user?.id, normalizedCourseId]);

  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem(`courseTab-${courseId}`);
      return saved || 'video';
    } catch (e) {
      return 'video';
    }
  });

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [materialDoc, setMaterialDoc] = useState(() => parseCourseMaterial(course?.material));
  const [pageIndex, setPageIndex] = useState(0);
  const [answersByPage, setAnswersByPage] = useState({});
  const [resultsByPage, setResultsByPage] = useState({});
  const [assessmentMessage, setAssessmentMessage] = useState(null);
  const [isSavingAssessment, setIsSavingAssessment] = useState(false);
  const [isMarkedCompleted, setIsMarkedCompleted] = useState(false);
  const [isHelpBotOpen, setIsHelpBotOpen] = useState(false);
  const [isHelpBotDragging, setIsHelpBotDragging] = useState(false);
  const [helpBotPosition, setHelpBotPosition] = useState({ x: null, y: null });
  const [helpBotSize, setHelpBotSize] = useState({ width: 380, height: 520 });
  const [isHelpBotResizing, setIsHelpBotResizing] = useState(false);
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [materialReadByPage, setMaterialReadByPage] = useState({});
  const [isReattemptEnabled, setIsReattemptEnabled] = useState(false);
  const [isPageReady, setIsPageReady] = useState(false);
  const [hasHydratedResults, setHasHydratedResults] = useState(false);
  const [hasHydratedAnswers, setHasHydratedAnswers] = useState(false);
  const [lastPersistenceError, setLastPersistenceError] = useState('');
  const [aiReviewByPage, setAiReviewByPage] = useState({});
  const helpBotDragOffsetRef = useRef({ x: 0, y: 0 });
  const helpBotPanelRef = useRef(null);
  const helpBotResizeOffsetRef = useRef({ startX: 0, startY: 0, startWidth: 0, startHeight: 0, corner: null });

  const getPendingAssessmentKey = () => `pending-assessment-events-${user?.id || 'unknown'}`;

  const readPendingAssessments = () => {
    try {
      const raw = localStorage.getItem(getPendingAssessmentKey());
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  };

  const writePendingAssessments = (items) => {
    localStorage.setItem(getPendingAssessmentKey(), JSON.stringify(items));
  };

  const queuePendingAssessment = (payload) => {
    const queued = readPendingAssessments();
    queued.push({
      ...payload,
      queued_at: new Date().toISOString(),
    });
    writePendingAssessments(queued);
  };

  const flushPendingAssessments = async () => {
    const queued = readPendingAssessments();
    if (!queued.length) return;

    console.log(`📤 Flushing ${queued.length} pending assessments to server...`);

    const remaining = [];
    for (const payload of queued) {
      const normalizedPayload = {
        user_id: payload?.user_id,
        course_id: payload?.course_id,
        page_index: payload?.page_index ?? 1,
        page_title: payload?.page_title || '',
        course_title: payload?.course_title || '',
        total_score: Number(payload?.total_score || 0),
        total_questions: Number(payload?.total_questions || 0),
        completion_percent: Number(payload?.completion_percent || 0),
        course_completed: Boolean(payload?.course_completed),
        ai_feedback: payload?.ai_feedback || '',
        attempted_at: payload?.attempted_at || new Date().toISOString(),
      };

      let flushed = false;
      // Retry up to 3 times for each pending item
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          console.log(`🔄 Flushing ${payload.course_id} (attempt ${attempt + 1}/3)...`);
          const { data, error } = await supabase
            .from(ASSESSMENT_TABLE)
            .upsert([normalizedPayload], { onConflict: 'user_id,course_id,page_index' });
          
          if (!error) {
            flushed = true;
            console.log(`✅ Flushed ${payload.course_id}`, data);
            break;
          }
          if (isMissingTableError(error)) {
            const ensured = await ensureAssessmentResultsTable(supabase);
            if (ensured.ok) {
              continue;
            }
          }

          console.warn(`⚠️ Upsert failed for ${payload.course_id}:`, {
            code: error?.code,
            message: error?.message,
            details: error?.details,
          });
        } catch (networkErr) {
          console.warn(`⚠️ Network error for ${payload.course_id}:`, networkErr.message);
        }
        
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }
      
      if (!flushed) {
        remaining.push(payload);
        console.error(`❌ Failed to flush ${payload.course_id} after 3 attempts`);
      }
    }

    writePendingAssessments(remaining);
    if (remaining.length === 0) {
      console.log('✅ All pending assessments flushed successfully!');
    } else {
      console.warn(`⚠️ ${remaining.length} assessments still pending after retries`);
    }
  };

  const totalPages = materialDoc.pages.length || 1;
  const activePage = materialDoc.pages[pageIndex] || { pageNumber: 1, title: 'Page 1', content: 'No content.', quiz: { question: '', options: [], answer: '' }, shortAnswer: { question: '', answer: '' } };
  const activeAnswers = answersByPage[pageIndex] || {
    quizChoice: resultsByPage?.[pageIndex]?.quizChoice || '',
    shortAnswerInput: resultsByPage?.[pageIndex]?.shortAnswerInput || resultsByPage?.[pageIndex]?.fillBlankInput || '',
  };
  const storageKey = `course-results-${normalizedCourseId}-${safeUserId}`;
  const answersStorageKey = `course-answers-${normalizedCourseId}-${safeUserId}`;
  const reviewSnapshotKey = `course-review-snapshot-${normalizedCourseId}-${safeUserId}`;
  const materialReadStorageKey = `course-material-read-${normalizedCourseId}-${safeUserId}`;
  const lastPageStorageKey = `course-last-page-${normalizedCourseId}-${safeUserId}`;
  const completionFlagKey = `course-completed-${normalizedCourseId}-${safeUserId}`;
  const reattemptKey = `course-reattempt-${normalizedCourseId}-${safeUserId}`;
  const aiReviewKey = `course-ai-review-${normalizedCourseId}-${safeUserId}`;
  const isMaterialCompletedForPage = Boolean(materialReadByPage?.[pageIndex]) || Boolean(resultsByPage?.[pageIndex]);
  const isChatDisabledForAssessment = isQuizModalOpen;
  const hasSubmittedCurrentPage = Boolean(resultsByPage?.[pageIndex]);
  const safePageContent = typeof activePage?.content === 'string'
    ? activePage.content
    : (activePage?.content == null ? '' : String(activePage.content));
  const materialParagraphs = safePageContent
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const pageWordCount = safePageContent.trim().split(/\s+/).filter(Boolean).length;
  const readTimeMinutes = Math.max(1, Math.ceil(pageWordCount / 180));

  const saveAssessmentAnswerEvent = async ({ attemptedAt, index, quizChoice, fillBlankInput, score, total }) => {
    if (!supabase || !user?.id) return;
    try {
      const payload = {
        type: 'assessment_answer',
        pageIndex: index,
        quizChoice,
        fillBlankInput,
        score,
        total,
        attemptedAt,
      };
      const { error } = await supabase.from('neural_messages').insert([
        {
          user_id: user.id,
          course_id: normalizedCourseId,
          content: encodeAssessmentAnswerContent(payload),
          is_ai: false,
          created_at: attemptedAt,
        },
      ]);

      if (error) {
        const detail = getErrorDetails(error, 'Answer persistence failed');
        setLastPersistenceError(detail);
      }
    } catch (err) {
      const detail = getErrorDetails(err, 'Answer persistence failed');
      setLastPersistenceError(detail);
      console.warn(detail);
    }
  };

  const completedPagesCount = Object.keys(resultsByPage || {}).length;
  const isCourseCompletedLocal = completedPagesCount >= totalPages;
  const isReviewMode = (isMarkedCompleted || isCourseCompletedLocal) && !isReattemptEnabled;
  const materialProgressPercent = Math.min(100, Math.round((Math.min(completedPagesCount, totalPages) / Math.max(totalPages, 1)) * 100));

  const totalQuestionsAnswered = Object.values(resultsByPage).reduce((acc, item) => acc + (item?.total || 0), 0);
  const totalScore = Object.values(resultsByPage).reduce((acc, item) => acc + (item?.score || 0), 0);
  const requestedPage = Number(searchParams.get('page'));
  const currentPageResult = resultsByPage?.[pageIndex] || null;

  const getErrorDetails = (error, prefix = 'Error') => {
    if (!error) return `${prefix}: Unknown error`;
    const code = error?.code ? ` code=${error.code};` : '';
    const details = error?.details ? ` details=${error.details};` : '';
    const hint = error?.hint ? ` hint=${error.hint};` : '';
    const message = error?.message || String(error);
    return `${prefix}: message=${message};${code}${details}${hint}`;
  };

  const goToPage = (targetIndex) => {
    const maxIndex = Math.max(0, totalPages - 1);
    const safeIndex = Math.min(Math.max(targetIndex, 0), maxIndex);
    setPageIndex(safeIndex);
    localStorage.setItem(lastPageStorageKey, String(safeIndex));

    const next = new URLSearchParams(searchParams);
    next.set('page', String(safeIndex + 1));
    setSearchParams(next, { replace: true });
  };

  const goBackToStudent = () => {
    setIsQuizModalOpen(false);
    setIsHelpBotOpen(false);
    setIsHelpBotDragging(false);
    setIsHelpBotResizing(false);
    navigate('/student');
  };

  // Persist tab state
  useEffect(() => {
    localStorage.setItem(`courseTab-${courseId}`, tab);
  }, [tab, courseId]);

  useEffect(() => {
    if (!course) return;

    setIsPageReady(false);
    const parsed = parseCourseMaterial(course.material);
    setMaterialDoc(parsed);

    const maxIndex = Math.max(0, (parsed?.pages?.length || 1) - 1);
    const rawSavedIndex = localStorage.getItem(lastPageStorageKey);
    const parsedIndex = Number(rawSavedIndex);
    let safeIndex = Number.isFinite(parsedIndex) ? Math.min(Math.max(parsedIndex, 0), maxIndex) : 0;

    if (Number.isFinite(requestedPage) && requestedPage > 0) {
      safeIndex = Math.min(Math.max(requestedPage - 1, 0), maxIndex);
    }

    // Fallback only when page is not explicitly requested in URL.
    const hasExplicitRequestedPage = Number.isFinite(requestedPage) && requestedPage > 0;
    if (!hasExplicitRequestedPage) {
      try {
        const rawResults = localStorage.getItem(storageKey);
        const parsedResults = rawResults ? JSON.parse(rawResults) : {};
        const completedPages = Object.keys(parsedResults || {}).length;
        const nextUnattemptedIndex = Math.min(Math.max(completedPages, 0), maxIndex);
        if (!Number.isFinite(parsedIndex) || safeIndex < nextUnattemptedIndex) {
          safeIndex = nextUnattemptedIndex;
        }
      } catch (err) {
        // Ignore malformed local results and keep current safeIndex.
      }
    }

    setPageIndex(safeIndex);
    setAssessmentMessage(null);
    setIsPageReady(true);
  }, [course?.material, course?.id, lastPageStorageKey, storageKey, requestedPage]);

  useEffect(() => {
    localStorage.setItem(lastPageStorageKey, String(pageIndex));
  }, [pageIndex, lastPageStorageKey]);

  useEffect(() => {
    if (!isPageReady) return;

    const currentUrlPage = Number(searchParams.get('page'));
    const expectedPage = pageIndex + 1;
    if (currentUrlPage === expectedPage) return;

    const next = new URLSearchParams(searchParams);
    next.set('page', String(expectedPage));
    setSearchParams(next, { replace: true });
  }, [pageIndex, searchParams, setSearchParams, isPageReady]);

  useEffect(() => {
    setAssessmentMessage(null);
  }, [pageIndex]);

  useEffect(() => {
    setHasHydratedResults(false);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setResultsByPage(parsed);
      }
    } catch (error) {
      setResultsByPage({});
    } finally {
      setHasHydratedResults(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hasHydratedResults) return;
    localStorage.setItem(storageKey, JSON.stringify(resultsByPage));
  }, [resultsByPage, storageKey, hasHydratedResults]);

  useEffect(() => {
    setHasHydratedAnswers(false);
    try {
      const raw = localStorage.getItem(answersStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setAnswersByPage(parsed);
        setHasHydratedAnswers(true);
        return;
      }

      const snapshotRaw = localStorage.getItem(reviewSnapshotKey);
      if (snapshotRaw) {
        const parsed = JSON.parse(snapshotRaw);
        if (parsed && typeof parsed === 'object') setAnswersByPage(parsed);
      }
    } catch (error) {
      setAnswersByPage({});
    } finally {
      setHasHydratedAnswers(true);
    }
  }, [answersStorageKey, reviewSnapshotKey]);

  useEffect(() => {
    if (!hasHydratedAnswers) return;
    localStorage.setItem(answersStorageKey, JSON.stringify(answersByPage));
    localStorage.setItem(reviewSnapshotKey, JSON.stringify(answersByPage));
  }, [answersByPage, answersStorageKey, hasHydratedAnswers]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(materialReadStorageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') {
        setMaterialReadByPage(parsed);
      } else {
        setMaterialReadByPage({});
      }
    } catch (error) {
      setMaterialReadByPage({});
    }
  }, [materialReadStorageKey]);

  useEffect(() => {
    localStorage.setItem(materialReadStorageKey, JSON.stringify(materialReadByPage));
  }, [materialReadByPage, materialReadStorageKey]);

  useEffect(() => {
    setIsQuizModalOpen(false);
  }, [pageIndex]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(aiReviewKey);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') {
        const sanitized = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [
            key,
            {
              ...(value && typeof value === 'object' ? value : {}),
              loading: false,
            },
          ])
        );
        setAiReviewByPage(sanitized);
      }
    } catch (err) {
      setAiReviewByPage({});
    }
  }, [aiReviewKey]);

  useEffect(() => {
    const persistable = Object.fromEntries(
      Object.entries(aiReviewByPage || {}).map(([key, value]) => [
        key,
        {
          ...(value && typeof value === 'object' ? value : {}),
          loading: false,
        },
      ])
    );
    localStorage.setItem(aiReviewKey, JSON.stringify(persistable));
  }, [aiReviewByPage, aiReviewKey]);

  useEffect(() => {
    if (!isReviewMode) return;
    if (!currentPageResult) return;
    if (!GROQ_API_KEY) {
      setAiReviewByPage((prev) => ({
        ...prev,
        [pageIndex]: {
          ...(prev?.[pageIndex] || {}),
          loading: false,
          error: 'AI review is unavailable: missing API key configuration.',
        },
      }));
      return;
    }

    const existing = aiReviewByPage?.[pageIndex];
    if (existing?.explanation) return;

    let cancelled = false;

    const loadAiReview = async () => {
      setAiReviewByPage((prev) => ({
        ...prev,
        [pageIndex]: {
          ...(prev?.[pageIndex] || {}),
          loading: true,
          error: '',
        },
      }));

      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 12000);

        const prompt = [
          `Course: ${course?.title || 'Untitled'}`,
          `Page: ${activePage?.title || `Page ${pageIndex + 1}`}`,
          `Quiz question: ${activePage?.quiz?.question || ''}`,
          `Correct quiz answer: ${activePage?.quiz?.answer || ''}`,
          `Student quiz answer: ${currentPageResult?.quizChoice || ''}`,
          `Short-answer question: ${activePage?.shortAnswer?.question || ''}`,
          `Reference short answer: ${activePage?.shortAnswer?.answer || ''}`,
          `Student short answer: ${currentPageResult?.shortAnswerInput || currentPageResult?.fillBlankInput || ''}`,
          `Page content snippet: ${(activePage?.content || '').slice(0, 700)}`,
        ].join('\n');

        let response;
        try {
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: GROQ_MODEL,
              messages: [
                {
                  role: 'system',
                  content: 'You are an academic reviewer. Briefly explain why the correct answers are correct and how the student can improve. Keep it under 80 words.',
                },
                {
                  role: 'user',
                  content: prompt,
                },
              ],
              temperature: 0.3,
              max_tokens: 120,
            }),
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

        if (!response.ok) {
          throw new Error(`AI review request failed: ${response.status}`);
        }

        const data = await response.json();
        const explanation = data?.choices?.[0]?.message?.content?.trim() || '';

        if (cancelled) return;
        setAiReviewByPage((prev) => ({
          ...prev,
          [pageIndex]: {
            explanation: explanation || 'AI review unavailable for this page right now.',
            loading: false,
            error: '',
          },
        }));
      } catch (err) {
        if (cancelled) return;
        setAiReviewByPage((prev) => ({
          ...prev,
          [pageIndex]: {
            ...(prev?.[pageIndex] || {}),
            loading: false,
            error: err?.message || 'Failed to generate AI review.',
          },
        }));
      }
    };

    loadAiReview();

    return () => {
      cancelled = true;
    };
  }, [
    isReviewMode,
    currentPageResult,
    pageIndex,
    activePage?.title,
    activePage?.content,
    activePage?.quiz?.question,
    activePage?.quiz?.answer,
    activePage?.shortAnswer?.question,
    activePage?.shortAnswer?.answer,
    course?.title,
  ]);

  useEffect(() => {
    if (answersByPage[pageIndex]) return;

    try {
      const raw = localStorage.getItem(answersStorageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const pageAnswers = parsed?.[pageIndex];
      if (!pageAnswers) return;

      setAnswersByPage((prev) => ({
        ...prev,
        [pageIndex]: {
          quizChoice: pageAnswers?.quizChoice || '',
          shortAnswerInput: pageAnswers?.shortAnswerInput || pageAnswers?.fillBlankInput || '',
        },
      }));
    } catch (err) {
      // Ignore malformed local answer cache.
    }
  }, [pageIndex, answersByPage, answersStorageKey]);

  useEffect(() => {
    // Backfill answer state from result snapshots for older sessions.
    const merged = { ...answersByPage };
    let hasChanges = false;

    Object.entries(resultsByPage || {}).forEach(([pageKey, result]) => {
      if (!merged[pageKey] && (result?.quizChoice || result?.shortAnswerInput || result?.fillBlankInput)) {
        merged[pageKey] = {
          quizChoice: result?.quizChoice || '',
          shortAnswerInput: result?.shortAnswerInput || result?.fillBlankInput || '',
        };
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setAnswersByPage(merged);
    }
  }, [resultsByPage]);

  useEffect(() => {
    if (!supabase || !user?.id || !normalizedCourseId) return;

    let cancelled = false;

    const hydrateAnswersFromDatabase = async () => {
      try {
        const { data, error } = await supabase
          .from('neural_messages')
          .select('content, created_at')
          .eq('course_id', normalizedCourseId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });

        if (error) {
          const detail = getErrorDetails(error, 'Answer hydration failed');
          setLastPersistenceError(detail);
          return;
        }

        let reattemptStartTime = 0;
        try {
          const reattemptRaw = localStorage.getItem(reattemptKey);
          const reattemptParsed = reattemptRaw ? JSON.parse(reattemptRaw) : null;
          if (reattemptParsed?.active && reattemptParsed?.startedAt) {
            reattemptStartTime = new Date(reattemptParsed.startedAt).getTime() || 0;
          }
        } catch (err) {
          reattemptStartTime = 0;
        }

        const answerEvents = (data || []).filter((row) => {
          const payload = parseAssessmentAnswerContent(row?.content);
          if (!payload) return false;
          if (!reattemptStartTime) return true;
          const eventTime = new Date(payload?.attemptedAt || row?.created_at || 0).getTime();
          return eventTime >= reattemptStartTime;
        });
        if (!answerEvents.length || cancelled) return;

        const dbAnswers = {};
        const dbResults = {};

        answerEvents.forEach((row) => {
          const payload = parseAssessmentAnswerContent(row?.content) || {};
          const index = Number(payload?.pageIndex);
          if (!Number.isFinite(index) || index < 0) return;

          dbAnswers[index] = {
            quizChoice: payload?.quizChoice || '',
            fillBlankInput: payload?.fillBlankInput || '',
          };

          dbResults[index] = {
            score: Number(payload?.score || 0),
            total: Number(payload?.total || 2),
            attemptedAt: payload?.attemptedAt || row?.created_at,
            quizChoice: payload?.quizChoice || '',
            fillBlankInput: payload?.fillBlankInput || '',
          };
        });

        setAnswersByPage((prev) => ({ ...dbAnswers, ...prev }));
        setResultsByPage((prev) => ({ ...dbResults, ...prev }));
      } catch (err) {
        const detail = getErrorDetails(err, 'Answer hydration failed');
        setLastPersistenceError(detail);
        console.warn(detail);
      }
    };

    hydrateAnswersFromDatabase();

    return () => {
      cancelled = true;
    };
  }, [supabase, user?.id, normalizedCourseId]);

  useEffect(() => {
    try {
      const completionRaw = localStorage.getItem(completionFlagKey);
      const completionParsed = completionRaw ? JSON.parse(completionRaw) : null;
      setIsMarkedCompleted(Boolean(completionParsed?.completed));
    } catch (err) {
      setIsMarkedCompleted(false);
    }

    try {
      const reattemptRaw = localStorage.getItem(reattemptKey);
      const reattemptParsed = reattemptRaw ? JSON.parse(reattemptRaw) : null;
      setIsReattemptEnabled(Boolean(reattemptParsed?.active));
    } catch (err) {
      setIsReattemptEnabled(false);
    }
  }, [completionFlagKey, reattemptKey]);

  useEffect(() => {
    fetchMessages();

    const poll = setInterval(() => {
      fetchMessages();
    }, 6000);

    const onFocus = () => fetchMessages();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
  }, [normalizedCourseId, supabase, user?.id]);

  useEffect(() => {
    if (!supabase || !user?.id) return;

    flushPendingAssessments();

    const handleOnline = () => {
      flushPendingAssessments();
    };

    const handleFocus = () => {
      flushPendingAssessments();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [supabase, user?.id]);

  useEffect(() => {
    if (!isHelpBotDragging) return;

    const handlePointerMove = (e) => {
      const panelWidth = helpBotPanelRef.current?.offsetWidth || 380;
      const panelHeight = helpBotPanelRef.current?.offsetHeight || 520;

      let nextX = e.clientX - helpBotDragOffsetRef.current.x;
      let nextY = e.clientY - helpBotDragOffsetRef.current.y;

      nextX = Math.max(8, Math.min(nextX, window.innerWidth - panelWidth - 8));
      nextY = Math.max(8, Math.min(nextY, window.innerHeight - panelHeight - 8));

      setHelpBotPosition({ x: nextX, y: nextY });
    };

    const stopDragging = () => {
      setIsHelpBotDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
    };
  }, [isHelpBotDragging, helpBotSize]);

  useEffect(() => {
    if (!isHelpBotResizing) return;

    const handlePointerMove = (e) => {
      const { corner, startX, startY, startWidth, startHeight } = helpBotResizeOffsetRef.current;
      if (!corner) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const minWidth = 300;
      const minHeight = 300;

      // Get the current actual position (accounting for default position)
      let currentX = helpBotPosition.x !== null ? helpBotPosition.x : window.innerWidth - helpBotSize.width - 24;
      let currentY = helpBotPosition.y !== null ? helpBotPosition.y : window.innerHeight - helpBotSize.height - 96;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = currentX;
      let newY = currentY;

      // Resize from right: expand/contract rightward
      if (corner.includes('right')) {
        newWidth = Math.max(minWidth, startWidth + deltaX);
        // Constrain: right edge can't go past window right (keep 8px margin)
        newWidth = Math.min(newWidth, window.innerWidth - newX - 8);
      }

      // Resize from left: expand/contract leftward
      if (corner.includes('left')) {
        newWidth = Math.max(minWidth, startWidth - deltaX);
        // Calculate new X position (left goes left as width increases)
        newX = currentX - (newWidth - startWidth);
        // Constrain: X can't go negative, and right edge can't exceed window
        newX = Math.max(0, newX);
        newX = Math.min(newX, window.innerWidth - newWidth - 8);
      }

      // Resize from bottom: expand/contract downward
      if (corner.includes('bottom')) {
        newHeight = Math.max(minHeight, startHeight + deltaY);
        // Constrain: bottom edge can't go past window bottom (keep 8px margin)
        newHeight = Math.min(newHeight, window.innerHeight - newY - 8);
      }

      // Resize from top: expand/contract upward
      if (corner.includes('top')) {
        newHeight = Math.max(minHeight, startHeight - deltaY);
        // Calculate new Y position (top goes up as height increases)
        newY = currentY - (newHeight - startHeight);
        // Constrain: Y can't go negative, and bottom edge can't exceed window
        newY = Math.max(0, newY);
        newY = Math.min(newY, window.innerHeight - newHeight - 8);
      }

      setHelpBotSize({ width: newWidth, height: newHeight });
      setHelpBotPosition({ x: newX, y: newY });
    };

    const stopResizing = () => {
      setIsHelpBotResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, [isHelpBotResizing, helpBotPosition]);

  const startHelpBotResize = (corner, e) => {
    e.preventDefault();
    e.stopPropagation();
    helpBotResizeOffsetRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: helpBotSize.width,
      startHeight: helpBotSize.height,
      corner,
    };
    setIsHelpBotResizing(true);
  };

  const openHelpBot = () => {
    if (!isHelpBotOpen && (helpBotPosition.x === null || helpBotPosition.y === null)) {
      const defaultWidth = 380;
      const defaultHeight = 520;
      const x = Math.max(8, window.innerWidth - defaultWidth - 24);
      const y = Math.max(8, window.innerHeight - defaultHeight - 96);
      setHelpBotPosition({ x, y });
    }
    setIsHelpBotOpen((prev) => !prev);
  };

  const startHelpBotDrag = (e) => {
    if (!helpBotPanelRef.current) return;
    e.preventDefault();

    const currentX = helpBotPosition.x ?? (window.innerWidth - helpBotSize.width - 24);
    const currentY = helpBotPosition.y ?? (window.innerHeight - helpBotSize.height - 96);

    helpBotDragOffsetRef.current = {
      x: e.clientX - currentX,
      y: e.clientY - currentY,
    };

    setIsHelpBotDragging(true);
  };

  const fetchMessages = async () => {
    if (!supabase || !user?.id || !normalizedCourseId) return;
    const { data } = await supabase.from('neural_messages').select('*').eq('course_id', normalizedCourseId).eq('user_id', user.id).order('created_at', { ascending: true });
    if (data) setMessages(data.filter(message => !isAssessmentEvent(message)));
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (isChatDisabledForAssessment) return;
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput('');

    const userMessageObj = {
      user_id: user.id,
      course_id: normalizedCourseId,
      content: userMsg,
      is_ai: false,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessageObj]);

    await supabase.from('neural_messages').insert([userMessageObj]);

    setIsAiLoading(true);

    try {
      let courseContext = `Course: ${course.title}\n`;
      courseContext += `Description: ${course.description}\n\n`;

      if (materialDoc && materialDoc.pages) {
        courseContext += `Course Content:\n`;
        materialDoc.pages.forEach((page) => {
          courseContext += `\nPage ${page.pageNumber}: ${page.title}\n`;
          if (page.summary) courseContext += `Summary: ${page.summary}\n`;
          if (page.content) courseContext += `${page.content.substring(0, 500)}\n`;
        });
      }

      if (courseContext.length > 3000) {
        courseContext = courseContext.substring(0, 3000) + '...';
      }

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'system',
              content: `You are a helpful educational assistant. Answer questions about the course based on the provided material. Be concise and friendly.\n\n${courseContext}`
            },
            {
              role: 'user',
              content: userMsg
            }
          ],
          temperature: 0.7,
          max_tokens: 300,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data?.choices?.[0]?.message?.content?.trim() || "I'm having trouble processing your question right now. Please try again.";

      const aiMessageObj = {
        user_id: user.id,
        course_id: normalizedCourseId,
        content: aiResponse,
        is_ai: true,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMessageObj]);

      await supabase.from('neural_messages').insert([aiMessageObj]);

    } catch (error) {
      console.error('Help bot error:', error);

      const fallbackResponse = `I apologize, but I'm having trouble accessing my AI capabilities right now. Please review the course materials or try asking again in a moment.`;

      const fallbackMessageObj = {
        user_id: user.id,
        course_id: normalizedCourseId,
        content: fallbackResponse,
        is_ai: true,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, fallbackMessageObj]);

      await supabase.from('neural_messages').insert([fallbackMessageObj]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const getVideoId = (url) => {
    try {
      if (!url || typeof url !== 'string') return null;
      if (url.includes('v=')) return url.split('v=')[1]?.split('&')[0];
      if (url.includes('youtu.be/')) return url.split('/').pop();
    } catch (e) {}
    return null;
  };

  const setQuizChoice = (value) => {
    if (isReviewMode) return;
    setAnswersByPage(prev => ({
      ...prev,
      [pageIndex]: {
        ...prev[pageIndex],
        quizChoice: value,
      },
    }));
  };

  const setShortAnswerInput = (value) => {
    if (isReviewMode) return;
    setAnswersByPage(prev => ({
      ...prev,
      [pageIndex]: {
        ...prev[pageIndex],
        shortAnswerInput: value,
      },
    }));
  };

  const evaluateShortAnswerWithAI = async ({ question, expectedAnswer, studentAnswer, content }) => {
    const safeStudentAnswer = String(studentAnswer || '').trim();
    const safeExpected = String(expectedAnswer || '').trim();

    if (!safeStudentAnswer) {
      return { score: 0, explanation: 'No answer provided for short-answer question.' };
    }

    if (!GROQ_API_KEY) {
      const normalizedStudent = safeStudentAnswer.toLowerCase();
      const normalizedExpected = safeExpected.toLowerCase();
      const score = normalizedExpected && (normalizedStudent.includes(normalizedExpected) || normalizedExpected.includes(normalizedStudent)) ? 1 : 0;
      return {
        score,
        explanation: score ? 'Answer matches key concept.' : 'Answer does not match the expected key concept.',
      };
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a strict grading assistant. Grade the student short answer as 0 or 1 only. Return valid JSON only: {"score":0|1,"reason":"short reason"}.',
            },
            {
              role: 'user',
              content: `Question: ${question}\nExpected answer: ${expectedAnswer}\nStudent answer: ${studentAnswer}\nContext: ${(content || '').slice(0, 900)}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 120,
        }),
      });

      if (!response.ok) {
        throw new Error(`Short-answer grading failed: ${response.status}`);
      }

      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content?.trim() || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      const score = Number(parsed?.score) === 1 ? 1 : 0;
      return {
        score,
        explanation: String(parsed?.reason || '').trim() || (score ? 'Answer is correct.' : 'Answer needs improvement.'),
      };
    } catch (err) {
      const normalizedStudent = safeStudentAnswer.toLowerCase();
      const normalizedExpected = safeExpected.toLowerCase();
      const score = normalizedExpected && (normalizedStudent.includes(normalizedExpected) || normalizedExpected.includes(normalizedStudent)) ? 1 : 0;
      return {
        score,
        explanation: score ? 'Answer matches expected concept (fallback grading).' : 'Answer does not match expected concept (fallback grading).',
      };
    }
  };

  const markMaterialCompletedForPage = () => {
    setMaterialReadByPage((prev) => ({
      ...prev,
      [pageIndex]: true,
    }));
    setAssessmentMessage(null);
  };

  const openQuizModal = () => {
    if (!isMaterialCompletedForPage) {
      setAssessmentMessage({
        type: 'error',
        text: 'Complete the material first, then click Attempt Quiz.',
      });
      return;
    }
    setIsQuizModalOpen(true);
  };

  const submitAssessment = async () => {
    if (isReviewMode) {
      setAssessmentMessage({
        type: 'error',
        text: 'This course is in review mode. Use Reattempt Course from My Results to attempt again.',
      });
      return;
    }

    if (!activeAnswers.quizChoice) {
      setAssessmentMessage({
        type: 'error',
        text: 'Please select a quiz option before submitting.',
      });
      return;
    }

    if (!(activeAnswers.shortAnswerInput || '').trim()) {
      setAssessmentMessage({
        type: 'error',
        text: 'Please answer the short question before submitting.',
      });
      return;
    }

    const quizCorrect = (activeAnswers.quizChoice || '').trim().toLowerCase() === (activePage.quiz.answer || '').trim().toLowerCase();
    const shortAnswerEvaluation = await evaluateShortAnswerWithAI({
      question: activePage?.shortAnswer?.question,
      expectedAnswer: activePage?.shortAnswer?.answer,
      studentAnswer: activeAnswers.shortAnswerInput,
      content: activePage?.content,
    });
    const score = Number(quizCorrect) + Number(shortAnswerEvaluation.score);
    const attemptedAt = new Date().toISOString();

    setIsSavingAssessment(true);

    // Non-blocking flush for previous pending rows; do not delay current submit.
    flushPendingAssessments().catch((err) => {
      console.warn('Pending flush failed in background:', err?.message || err);
    });

    // Update local state immediately for UI
    const nextAnswers = {
      ...answersByPage,
      [pageIndex]: {
        quizChoice: activeAnswers.quizChoice || '',
        shortAnswerInput: activeAnswers.shortAnswerInput || '',
      },
    };
    setAnswersByPage(nextAnswers);
    localStorage.setItem(answersStorageKey, JSON.stringify(nextAnswers));
    localStorage.setItem(reviewSnapshotKey, JSON.stringify(nextAnswers));

    const nextResults = {
      ...resultsByPage,
      [pageIndex]: {
        score,
        total: 2,
        attemptedAt,
        quizChoice: activeAnswers.quizChoice || '',
        shortAnswerInput: activeAnswers.shortAnswerInput || '',
        shortAnswerFeedback: shortAnswerEvaluation.explanation || '',
      },
    };
    setResultsByPage(nextResults);
    localStorage.setItem(storageKey, JSON.stringify(nextResults));

    // Save resume pointer to next page after a successful page attempt.
    const nextResumePage = pageIndex < totalPages - 1 ? pageIndex + 1 : pageIndex;
    localStorage.setItem(lastPageStorageKey, String(nextResumePage));

    saveAssessmentAnswerEvent({
      attemptedAt,
      index: pageIndex,
      quizChoice: activeAnswers.quizChoice || '',
      fillBlankInput: activeAnswers.shortAnswerInput || '',
      score,
      total: 2,
    });

    let completedPages = 0;
    let updatedTotalScore = 0;
    let updatedTotalQuestions = 0;
    let completionPercent = 0;
    let isCourseCompleted = false;

    try {
      // Calculate aggregates from local state (all pages completed so far)
      const pageEntries = Object.values(nextResults);
      completedPages = pageEntries.length;
      updatedTotalScore = pageEntries.reduce((acc, item) => acc + (item?.score || 0), 0);
      updatedTotalQuestions = pageEntries.reduce((acc, item) => acc + (item?.total || 0), 0);
      completionPercent = updatedTotalQuestions > 0
        ? Math.round((updatedTotalScore / updatedTotalQuestions) * 100)
        : 0;
      isCourseCompleted = completedPages >= totalPages;
    } catch (err) {
      console.error('Error calculating aggregates', err);
    }

    const generateAndSaveFeedback = async () => {
      try {
        const feedbackResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              {
                role: 'system',
                content: 'You are an academic mentor. Give one short actionable sentence based on student performance.',
              },
              {
                role: 'user',
                content: `Course: ${course.title}. Page ${pageIndex + 1} score ${score}/2. Total score ${updatedTotalScore}/${updatedTotalQuestions} (${completionPercent}%). Completed pages ${completedPages}/${totalPages}.`,
              },
            ],
            temperature: 0.4,
            max_tokens: 80,
          }),
        });

        if (!feedbackResponse.ok) return;

        const feedbackData = await feedbackResponse.json();
        const aiFeedback = feedbackData?.choices?.[0]?.message?.content?.trim() || '';
        if (!aiFeedback) return;

        await supabase
          .from(ASSESSMENT_TABLE)
          .update({ ai_feedback: aiFeedback })
          .eq('user_id', user.id)
          .eq('course_id', normalizedCourseId);

        setAssessmentMessage((prev) => {
          if (!prev || prev.type !== 'success') return prev;
          return {
            ...prev,
            text: `Assessment submitted. Score: ${score}/2. ${aiFeedback}`,
          };
        });
      } catch (err) {
        console.warn('AI feedback generation failed:', err?.message || err);
      }
    };

    try {
      // VALIDATION: Check if user is authenticated
      if (!user?.id) {
        console.error('❌ Cannot save assessment: User not authenticated!');
        setAssessmentMessage({
          type: 'error',
          text: 'Authentication error. Please log in again.',
        });
        return;
      }

      if (!supabase) {
        console.error('❌ Cannot save assessment: Supabase client not initialized!');
        setAssessmentMessage({
          type: 'error',
          text: 'Database connection failed. Please try again.',
        });
        return;
      }

      // Save course-level aggregate (one record per course, no per-page tracking)
      const payload = {
        user_id: user.id,
        course_id: normalizedCourseId,
        page_index: pageIndex + 1,
        page_title: activePage?.title || `Page ${pageIndex + 1}`,
        course_title: course.title,
        total_score: updatedTotalScore,
        total_questions: updatedTotalQuestions,
        completion_percent: completionPercent,
        course_completed: isCourseCompleted,
        ai_feedback: '',
        attempted_at: attemptedAt,
      };

      console.log('📊 Assessment Payload:', {
        user_id: user.id,
        course_id: normalizedCourseId,
        page_index: pageIndex + 1,
        total_score: updatedTotalScore,
        total_questions: updatedTotalQuestions,
        completion_percent: completionPercent,
        course_completed: isCourseCompleted,
        attempted_at: attemptedAt,
        table: ASSESSMENT_TABLE,
      });

      let lastInsertError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          console.log(`🔄 Attempt ${attempt + 1}/3 to save assessment...`);

          const { data, error: upsertError } = await supabase
            .from(ASSESSMENT_TABLE)
            .upsert([payload], { onConflict: 'user_id,course_id,page_index' });

          if (!upsertError) {
            lastInsertError = null;
            console.log('✅ Assessment saved successfully!');
            console.log('📝 Response data:', data);
            break;
          }

          if (isMissingTableError(upsertError)) {
            const ensured = await ensureAssessmentResultsTable(supabase);
            if (ensured.ok) {
              continue;
            }
          }

          lastInsertError = upsertError;
          console.error(`❌ Upsert failed:`, {
            message: upsertError.message,
            code: upsertError.code,
            details: upsertError.details,
            hint: upsertError.hint,
            status: upsertError.status,
          });
        } catch (networkErr) {
          lastInsertError = networkErr;
          console.error(`❌ Network Error:`, networkErr);
        }
        
        // Wait a bit before retry
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }

      if (lastInsertError) {
        console.error('❌ All server sync attempts failed. Error details:', {
          message: lastInsertError.message,
          code: lastInsertError.code,
          details: lastInsertError.details || lastInsertError.toString(),
        });
        throw lastInsertError;
      }

      // Also save completion flag to localStorage for immediate availability
      if (isCourseCompleted) {
        localStorage.setItem(completionFlagKey, JSON.stringify({
          completed: true,
          completedAt: new Date().toISOString(),
          completionPercent: completionPercent
        }));
        setIsMarkedCompleted(true);
        localStorage.removeItem(reattemptKey);
        setIsReattemptEnabled(false);
      }

      setAssessmentMessage({
        type: 'success',
        text: `Assessment submitted. Score: ${score}/2`,
      });

      generateAndSaveFeedback();
    } catch (err) {
      const detail = getErrorDetails(err, 'Assessment save failed');
      setLastPersistenceError(detail);
      console.error('❌ Failed to save assessment event:', {
        error: err.message || err,
        stack: err.stack,
      });
      const pendingPayload = {
        user_id: user.id,
        course_id: normalizedCourseId,
        page_index: pageIndex + 1,
        page_title: activePage?.title || `Page ${pageIndex + 1}`,
        course_title: course.title,
        total_score: updatedTotalScore,
        total_questions: updatedTotalQuestions,
        completion_percent: completionPercent,
        course_completed: isCourseCompleted,
        ai_feedback: '',
        attempted_at: attemptedAt,
      };
      queuePendingAssessment(pendingPayload);
      
      // Also save completion flag even if DB fails
      if (isCourseCompleted) {
        localStorage.setItem(completionFlagKey, JSON.stringify({
          completed: true,
          completedAt: new Date().toISOString(),
          completionPercent: completionPercent
        }));
        setIsMarkedCompleted(true);
      }
      
      setAssessmentMessage({
        type: 'error',
        text: `Could not save to database now. Saved locally and will retry auto-sync. Reason: ${detail}`,
      });
    } finally {
      setIsSavingAssessment(false);
    }
  };

  if (isSelfMaterialMode && isSelfMaterialLoading) {
    return (
      <div className="app-shell soft-grid min-h-screen flex items-center justify-center p-4">
        <div className="app-panel panel-strong rounded-3xl p-8 text-center page-enter">
          <Loader2 className="w-16 h-16 text-cyan-600 mx-auto mb-4 animate-spin" />
          <p className="text-slate-900 font-black text-lg mb-2">Loading self-study material...</p>
          <p className="text-slate-500 text-sm">Please wait while we prepare your content.</p>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="app-shell soft-grid min-h-screen flex items-center justify-center p-4">
        <div className="app-panel panel-strong rounded-3xl p-8 text-center page-enter">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <p className="text-slate-900 font-black text-lg mb-4">{isSelfMaterialMode ? 'Self-study material not found' : 'Course not found'}</p>
          <button onClick={() => navigate('/student')} className="px-6 py-3 bg-teal-700 hover:bg-teal-600 text-white font-black rounded-xl transition-all hover:-translate-y-0.5">
            Back to Courses
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell soft-grid min-h-screen p-6 md:p-8 pb-20 page-enter">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-12">
          <button onClick={goBackToStudent} className="flex items-center gap-4 text-slate-600 hover:text-slate-900 transition-all font-black uppercase text-[10px] tracking-widest group">
            <div className="p-3 rounded-2xl bg-white border border-slate-300 group-hover:bg-teal-700 group-hover:text-white transition-all"><ChevronRight className="w-5 h-5 rotate-180" /></div>
            Back
          </button>
          <div className={`flex items-center gap-3 px-6 py-2.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${isChatDisabledForAssessment ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-teal-700 bg-teal-50 border-teal-200'}`}>
            <Activity className="w-4 h-4" /> {isChatDisabledForAssessment ? 'Help Bot Disabled' : 'Help Bot Active'}
          </div>
        </div>

        {/* Course Title */}
        <h1 className="text-4xl md:text-5xl font-black italic mb-12 text-slate-900">{course.title}</h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Main Content */}
          <div className="lg:col-span-12 space-y-10">
            {/* Video/Material Tabs */}
            <div className="app-panel panel-strong rounded-[2rem] overflow-hidden shadow-2xl">
              {/* Tab Buttons */}
              <div className="flex border-b border-slate-200 bg-white/60">
                <button
                  onClick={() => setTab('video')}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 uppercase text-[10px] font-black tracking-widest transition-all ${tab === 'video' ? 'bg-teal-50 text-teal-700 border-b-2 border-teal-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Video className="w-4 h-4" />
                  Video Lesson
                </button>
                <button
                  onClick={() => setTab('material')}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 uppercase text-[10px] font-black tracking-widest transition-all ${tab === 'material' ? 'bg-cyan-50 text-cyan-700 border-b-2 border-cyan-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <BookOpen className="w-4 h-4" />
                  Study Materials
                </button>
              </div>

              {/* Content */}
              {tab === 'video' && (
                <div className="aspect-video bg-black flex items-center justify-center">
                  {(() => {
                    const videoUrl = String(course?.video_url || '').trim();
                    const videoId = getVideoId(videoUrl);
                    const isYoutube = Boolean(videoId);

                    if (!videoUrl) {
                      return <p className="text-slate-300 text-sm font-semibold">No video uploaded for this course yet.</p>;
                    }

                    if (isYoutube) {
                      return <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${videoId}`} frameBorder="0" allowFullScreen></iframe>;
                    }

                    return (
                      <video controls className="w-full h-full">
                        <source src={videoUrl} type="video/mp4" />
                      </video>
                    );
                  })()}
                </div>
              )}

              {tab === 'material' && (
                <div className="p-10 lg:p-16 space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-6">
                    <h2 className="text-3xl md:text-4xl font-black italic uppercase text-slate-900">Study Materials</h2>
                    <div className="text-[10px] uppercase tracking-widest text-slate-500 font-black">Page {pageIndex + 1} / {totalPages}</div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-cyan-700">
                      <span>Course Progress</span>
                      <span>{Math.min(completedPagesCount, totalPages)}/{totalPages} pages ({materialProgressPercent}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="h-2.5 rounded-full bg-cyan-600 transition-all"
                        style={{ width: `${Math.max(4, materialProgressPercent)}%` }}
                      />
                    </div>
                  </div>

                  {/* Page Navigation */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => goToPage(pageIndex - 1)}
                      disabled={pageIndex === 0}
                      className="px-4 py-2 bg-white border border-slate-300 hover:border-teal-400 disabled:opacity-50 rounded-xl text-slate-700 text-xs font-black transition-all"
                    >
                      ← Previous
                    </button>
                    <button
                      onClick={() => goToPage(pageIndex + 1)}
                      disabled={pageIndex === totalPages - 1}
                      className="px-4 py-2 bg-white border border-slate-300 hover:border-teal-400 disabled:opacity-50 rounded-xl text-slate-700 text-xs font-black transition-all"
                    >
                      Next →
                    </button>
                  </div>

                  {/* Page Content */}
                  <div className="rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/70 shadow-sm overflow-hidden">
                    <div className="px-8 md:px-10 py-6 border-b border-slate-200/80 bg-white/80">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-slate-300 bg-slate-100 text-[10px] font-black tracking-widest uppercase text-slate-600">
                          Lesson Page {pageIndex + 1}
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-cyan-200 bg-cyan-50 text-[10px] font-black tracking-widest uppercase text-cyan-700">
                          {readTimeMinutes} min read
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-slate-300 bg-white text-[10px] font-black tracking-widest uppercase text-slate-500">
                          {pageWordCount} words
                        </span>
                      </div>
                      <h3 className="text-2xl md:text-3xl font-black text-slate-900 leading-tight">{activePage.title}</h3>
                    </div>

                    <div className="px-8 md:px-10 py-8 space-y-6">
                      <article className="space-y-4">
                        {materialParagraphs.length > 0 ? (
                          materialParagraphs.map((paragraph, idx) => (
                            <p key={`${pageIndex}-${idx}`} className="text-slate-700 leading-8 text-[15px] md:text-base">
                              {paragraph}
                            </p>
                          ))
                        ) : (
                          <p className="text-slate-600 italic">No material content available for this page.</p>
                        )}
                      </article>

                      {/* Summary */}
                      <div className="p-5 rounded-2xl border border-cyan-200 bg-cyan-50">
                        <p className="text-[10px] uppercase tracking-widest font-black text-cyan-700 mb-2">AI Summary</p>
                        <p className="text-slate-700 text-sm leading-7">{activePage.summary || 'No summary available.'}</p>
                      </div>
                    </div>

                    {/* Assessment Access */}
                    <div className="space-y-4 px-8 md:px-10 pb-8">
                      <div className="p-5 rounded-2xl border border-teal-200 bg-teal-50/60">
                        <h4 className="text-sm font-black text-teal-700 mb-2 uppercase">Page Assessment</h4>
                        <p className="text-xs text-slate-700 mb-4">
                          Complete this page material first. Then click Attempt Quiz to open the assessment in a floating window.
                        </p>

                        {!isMaterialCompletedForPage ? (
                          <button
                            type="button"
                            onClick={markMaterialCompletedForPage}
                            className="px-4 py-2 rounded-xl bg-white border border-teal-300 hover:border-teal-500 text-teal-700 text-xs font-black uppercase tracking-wider"
                          >
                            Mark Material Completed
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={openQuizModal}
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-black uppercase tracking-wider"
                          >
                            Attempt Quiz
                          </button>
                        )}
                      </div>

                      {assessmentMessage && (
                        <div className={`mt-3 px-4 py-3 rounded-xl border text-xs font-bold ${assessmentMessage.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                          {assessmentMessage.text}
                        </div>
                      )}

                      {lastPersistenceError && (
                        <div className="mt-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold break-words">
                          Persistence debug: {lastPersistenceError}
                        </div>
                      )}

                      {resultsByPage[pageIndex] && (
                        <div className="mt-3 space-y-3">
                          <div className="px-4 py-3 rounded-xl border border-blue-300 bg-blue-50 text-blue-700 text-xs font-bold">
                            Saved score for this page: {resultsByPage[pageIndex].score}/2
                          </div>

                          {pageIndex < totalPages - 1 ? (
                            <button
                              type="button"
                              onClick={() => goToPage(pageIndex + 1)}
                              className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-black text-xs uppercase tracking-wider"
                            >
                              Next Page Material
                            </button>
                          ) : (
                            <div className="px-4 py-3 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-bold">
                              You have reached the final page assignment.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {typeof document !== 'undefined' && createPortal(
        <>
          {isQuizModalOpen && (
            <div className="fixed inset-0 z-[10000]">
              <div className="absolute inset-0 bg-slate-950/45" onClick={() => setIsQuizModalOpen(false)} />
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl p-6 md:p-8 relative">
                  <button
                    type="button"
                    onClick={() => setIsQuizModalOpen(false)}
                    className="absolute right-4 top-4 text-slate-500 hover:text-slate-900 text-2xl leading-none"
                    aria-label="Close assessment"
                  >
                    ×
                  </button>

                  <h3 className="text-lg md:text-xl font-black text-slate-900 mb-1">{activePage.title}</h3>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-6">Assessment Window</p>

                  <div className="space-y-5">
                    <div>
                      <h4 className="text-sm font-black text-teal-700 mb-3 uppercase">Quiz Question</h4>
                      <p className="text-slate-800 mb-4">{activePage.quiz.question}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {activePage.quiz.options.map(option => (
                          <button
                            key={option}
                            onClick={() => setQuizChoice(option)}
                            disabled={isReviewMode}
                            className={`text-left px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${activeAnswers.quizChoice === option ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-300 bg-white text-slate-700 hover:border-teal-400'} ${isReviewMode ? 'opacity-75 cursor-not-allowed' : ''}`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                      {isReviewMode && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-slate-600">
                            Your submitted answer: <span className="font-black">{activeAnswers.quizChoice || 'Not available for this older attempt'}</span>
                          </p>
                          <p className="text-xs text-emerald-700 font-bold">
                            Correct answer: {activePage.quiz.answer || 'Not available'}
                          </p>
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-black text-cyan-700 mb-3 uppercase">Short-Answer Question</h4>
                      <p className="text-slate-700 mb-4">{activePage.shortAnswer.question}</p>
                      <textarea
                        rows={4}
                        value={activeAnswers.shortAnswerInput || ''}
                        onChange={(e) => setShortAnswerInput(e.target.value)}
                        placeholder="Type your answer in 1-2 sentences..."
                        disabled={isReviewMode}
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 resize-y"
                      />
                      {isReviewMode && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-slate-600">
                            Your submitted answer: <span className="font-black">{activeAnswers.shortAnswerInput || 'Not available for this older attempt'}</span>
                          </p>
                          <p className="text-xs text-emerald-700 font-bold">
                            Reference answer: {activePage.shortAnswer.answer || 'Not available'}
                          </p>
                        </div>
                      )}
                    </div>

                    {hasSubmittedCurrentPage ? (
                      <button
                        type="button"
                        onClick={() => setIsQuizModalOpen(false)}
                        className="w-full mt-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs rounded-xl uppercase tracking-wider"
                      >
                        Close
                      </button>
                    ) : (
                      <button
                        onClick={submitAssessment}
                        disabled={isSavingAssessment || isReviewMode}
                        className="w-full mt-2 px-4 py-3 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-black text-xs rounded-xl uppercase tracking-wider"
                      >
                        {isReviewMode ? 'Review Mode (Read Only)' : isSavingAssessment ? 'Saving Result...' : 'Submit Assessment'}
                      </button>
                    )}

                    {isReviewMode && (
                      <div className="mt-2 px-4 py-3 rounded-xl border border-cyan-200 bg-cyan-50 text-cyan-700 text-xs font-bold">
                        Showing your previous answers. To attempt again, use Reattempt Course from the My Results section.
                      </div>
                    )}

                    {isReviewMode && currentPageResult && (
                      <div className="mt-2 px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs">
                        <p className="font-black text-emerald-700 uppercase tracking-wider text-[10px] mb-1">AI Answer Review</p>
                        {aiReviewByPage?.[pageIndex]?.loading ? (
                          <p className="text-emerald-700 font-semibold">Generating AI explanation...</p>
                        ) : aiReviewByPage?.[pageIndex]?.error ? (
                          <p className="text-rose-700 font-semibold">{aiReviewByPage[pageIndex].error}</p>
                        ) : (
                          <p className="text-slate-700">{aiReviewByPage?.[pageIndex]?.explanation || 'AI explanation not available yet.'}</p>
                        )}
                      </div>
                    )}

                    {assessmentMessage && (
                      <div className={`mt-3 px-4 py-3 rounded-xl border text-xs font-bold ${assessmentMessage.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                        {assessmentMessage.text}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Launcher button */}
          <button
            type="button"
            onClick={openHelpBot}
            className="fixed bottom-8 right-8 z-[9999] w-12 h-12 rounded-full bg-teal-700 hover:bg-teal-600 text-white shadow-xl flex items-center justify-center"
            aria-label={isHelpBotOpen ? 'Close help bot' : 'Open help bot'}
          >
            <MessageSquare className="w-5 h-5" />
          </button>

          {/* Chat panel */}
          {isHelpBotOpen && (
            <>
              <div
                ref={helpBotPanelRef}
                className="fixed z-[9999] app-panel panel-strong rounded-[1.75rem] flex flex-col overflow-hidden shadow-2xl border border-slate-200"
                style={helpBotPosition.x !== null && helpBotPosition.y !== null ? { left: `${helpBotPosition.x}px`, top: `${helpBotPosition.y}px`, width: `${helpBotSize.width}px`, height: `${helpBotSize.height}px` } : { right: '24px', bottom: '96px', width: `${helpBotSize.width}px`, height: `${helpBotSize.height}px` }}
              >
                <div
                  className={`p-5 border-b border-slate-200 bg-white/80 flex items-center justify-between ${isHelpBotDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onPointerDown={startHelpBotDrag}
                  style={{ userSelect: 'none' }}
                >
                  <div className="flex items-center gap-3">
                    <HelpCircle className="w-5 h-5 text-teal-700" />
                    <h4 className="font-black text-slate-900 text-[10px] uppercase tracking-widest">Help Bot</h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsHelpBotOpen(false)}
                    className="text-slate-500 hover:text-slate-800 text-lg leading-none px-2"
                    aria-label="Close help bot"
                  >
                    ×
                  </button>
                </div>

                {isChatDisabledForAssessment ? (
                  <div className="flex-1 p-5 flex items-center justify-center bg-amber-50/70">
                    <div className="w-full max-w-sm rounded-2xl border border-amber-300 bg-amber-100 px-4 py-5 text-center">
                      <p className="text-sm font-black text-amber-900 uppercase tracking-wider mb-1">Chatbot Disabled</p>
                      <p className="text-xs text-amber-800 font-semibold">Chatbot is disabled for assessments.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar text-[11px] leading-relaxed">
                      <div className="bg-teal-50 border border-teal-200 p-4 rounded-2xl text-[11px] text-teal-700 font-medium italic">
                        "Hello! I'm ready to answer questions about {course.title}. Type below."
                      </div>
                      {messages.map((m, i) => (
                        <div key={i} className={`flex flex-col ${m.is_ai ? 'items-start' : 'items-end'}`}>
                          <div className={`max-w-[88%] p-4 rounded-2xl text-[11px] font-medium shadow-sm ${m.is_ai ? 'bg-slate-100 text-slate-700 rounded-tl-none border border-slate-200' : 'bg-teal-700 text-white rounded-tr-none'}`}>
                            {m.content}
                          </div>
                        </div>
                      ))}
                      {isAiLoading && <div className="flex gap-2 p-3"><div className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-bounce" /></div>}
                    </div>

                    <form onSubmit={sendMessage} className="p-4 border-t border-slate-200 bg-white/80">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Ask a question..."
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-600 transition-all pr-12"
                        />
                        <button type="submit" className="absolute right-2.5 top-2.5 p-2 text-teal-700 hover:text-teal-600" aria-label="Send message">
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </div>

              {/* Invisible edge/corner resize zones */}
              {(() => {
                const left = helpBotPosition.x !== null ? helpBotPosition.x : window.innerWidth - helpBotSize.width - 24;
                const top = helpBotPosition.y !== null ? helpBotPosition.y : window.innerHeight - helpBotSize.height - 96;
                return (
                  <>
                    <div onPointerDown={(e) => startHelpBotResize('top', e)} className="absolute h-1 cursor-ns-resize z-40" style={{ left: `${left}px`, top: `${top}px`, width: `${helpBotSize.width}px` }} />
                    <div onPointerDown={(e) => startHelpBotResize('bottom', e)} className="absolute h-1 cursor-ns-resize z-40" style={{ left: `${left}px`, top: `${top + helpBotSize.height}px`, width: `${helpBotSize.width}px` }} />
                    <div onPointerDown={(e) => startHelpBotResize('left', e)} className="absolute w-1 cursor-ew-resize z-40" style={{ left: `${left}px`, top: `${top}px`, height: `${helpBotSize.height}px` }} />
                    <div onPointerDown={(e) => startHelpBotResize('right', e)} className="absolute w-1 cursor-ew-resize z-40" style={{ left: `${left + helpBotSize.width}px`, top: `${top}px`, height: `${helpBotSize.height}px` }} />
                    <div onPointerDown={(e) => startHelpBotResize('top-left', e)} className="absolute w-2 h-2 cursor-nwse-resize z-40" style={{ left: `${left}px`, top: `${top}px` }} />
                    <div onPointerDown={(e) => startHelpBotResize('top-right', e)} className="absolute w-2 h-2 cursor-nesw-resize z-40" style={{ left: `${left + helpBotSize.width}px`, top: `${top}px` }} />
                    <div onPointerDown={(e) => startHelpBotResize('bottom-left', e)} className="absolute w-2 h-2 cursor-nesw-resize z-40" style={{ left: `${left}px`, top: `${top + helpBotSize.height}px` }} />
                    <div onPointerDown={(e) => startHelpBotResize('bottom-right', e)} className="absolute w-2 h-2 cursor-se-resize z-40" style={{ left: `${left + helpBotSize.width}px`, top: `${top + helpBotSize.height}px` }} />
                  </>
                );
              })()}
            </>
          )}
        </>,
        document.body
      )}
    </div>
  );
}
