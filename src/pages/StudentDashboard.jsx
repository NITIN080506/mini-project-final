import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ensureAssessmentResultsTable,
  ensureStudentGoalsTable,
  ensureStudentSelfMaterialsTable,
  extractTextFromDocument,
  splitTextIntoPages,
  createQuestionsForPage,
  parseCourseMaterial,
  GROQ_API_KEY,
  GROQ_MODEL,
  GOALS_TABLE,
  SELF_MATERIALS_TABLE,
} from '../utils/helpers';
import { BookOpen, Search, Play, Compass, Trophy, Star, Loader2, BarChart3, CheckCircle2, Clock3, Target, HelpCircle, UserCircle2, Mail, BadgeCheck, PlusCircle, Trash2, Upload, FileText, Sparkles } from 'lucide-react';

const ASSESSMENT_TABLE = 'student_assessment_results';

export default function StudentDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { courses, enrollments, enrollCourse, supabase, user, role, profile, updateProfileName } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [resultRows, setResultRows] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [dailyStreak, setDailyStreak] = useState(0);
  const [courseCompletionMap, setCourseCompletionMap] = useState({});
  const [myCoursesFilter, setMyCoursesFilter] = useState('in-progress');
  const [myCoursesType, setMyCoursesType] = useState('admin');
  const [myResultsType, setMyResultsType] = useState('admin');
  const [goals, setGoals] = useState([]);
  const [hasHydratedGoals, setHasHydratedGoals] = useState(false);
  const [goalFormNotice, setGoalFormNotice] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [selfMaterialTitle, setSelfMaterialTitle] = useState('');
  const [selfMaterialFile, setSelfMaterialFile] = useState(null);
  const [selfMaterials, setSelfMaterials] = useState([]);
  const [selectedSelfMaterialId, setSelectedSelfMaterialId] = useState(null);
  const [isSelfMaterialsLoading, setIsSelfMaterialsLoading] = useState(false);
  const [isSelfMaterialUploading, setIsSelfMaterialUploading] = useState(false);
  const [selfMaterialProgress, setSelfMaterialProgress] = useState('');
  const [selfMaterialNotice, setSelfMaterialNotice] = useState('');
  const [goalForm, setGoalForm] = useState({
    title: '',
    courseId: '',
    targetDays: 7,
  });
  const activeTab = searchParams.get('tab') || 'overview';
  const adminUploadedMaterials = [...courses].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  
  const filteredCourses = courses.filter(c => 
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const enrolledCourses = filteredCourses.filter(c => enrollments.includes(c.id));
  const availableCourses = filteredCourses.filter(c => !enrollments.includes(c.id));
  const completedEnrolledCourses = enrolledCourses.filter((course) => Boolean(courseCompletionMap[course.id]));
  const inProgressEnrolledCourses = enrolledCourses.filter((course) => !courseCompletionMap[course.id]);
  const filteredSelfMaterials = selfMaterials.filter((item) => {
    const title = String(item?.title || '').toLowerCase();
    const fileName = String(item?.source_file_name || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return title.includes(query) || fileName.includes(query);
  });
  const selfMaterialIdSet = new Set(selfMaterials.map((item) => item.id));
  const goalItems = [
    ...courses.map((course) => ({
      id: course.id,
      title: course.title,
      material: course.material,
      kind: 'assigned',
    })),
    ...selfMaterials.map((material) => ({
      id: material.id,
      title: material.title,
      material: material.material,
      kind: 'self',
    })),
  ];
  const adminResultRows = resultRows.filter((row) => !selfMaterialIdSet.has(row.courseId));
  const selfResultRows = resultRows.filter((row) => selfMaterialIdSet.has(row.courseId));

  const getCompletionFlagKey = (courseId) => `course-completed-${courseId}-${user?.id}`;
  const getResultsKey = (courseId) => `course-results-${courseId}-${user?.id}`;
  const getAnswersKey = (courseId) => `course-answers-${courseId}-${user?.id}`;
  const getReattemptKey = (courseId) => `course-reattempt-${courseId}-${user?.id}`;
  const getLastPageKey = (courseId) => `course-last-page-${courseId}-${user?.id}`;
  const getGoalsStorageKey = () => `student-goals-${user?.id}`;
  const getResolvedProfileName = () => (profile?.full_name || user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim();

  const toLocalDateKey = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const calculateCurrentStreak = (dateKeys) => {
    if (!dateKeys || dateKeys.size === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayKey = toLocalDateKey(today);
    const yesterdayKey = toLocalDateKey(yesterday);
    const hasToday = dateKeys.has(todayKey);
    const hasYesterday = dateKeys.has(yesterdayKey);

    if (!hasToday && !hasYesterday) return 0;

    const cursor = hasToday ? new Date(today) : new Date(yesterday);
    let streak = 0;

    while (dateKeys.has(toLocalDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  };

  useEffect(() => {
    const existingName = getResolvedProfileName();
    setProfileName(existingName);
  }, [profile?.full_name, user?.user_metadata?.full_name, user?.user_metadata?.name]);

  useEffect(() => {
    if (!user?.id || !supabase) return;
    // Fetch self-materials whenever user navigates to tabs that display them
    if (activeTab === 'help' || activeTab === 'my-courses' || activeTab === 'my-results') {
      fetchSelfMaterials();
    }
  }, [activeTab, user?.id, supabase]);

  useEffect(() => {
    if (!user?.id) {
      setDailyStreak(0);
      return;
    }

    let cancelled = false;

    const getLocalActivityDateKeys = () => {
      const keys = new Set();

      try {
        Object.keys(localStorage).forEach((storageKey) => {
          if (!storageKey.startsWith('course-results-')) return;
          if (!storageKey.endsWith(`-${user.id}`)) return;

          const raw = localStorage.getItem(storageKey);
          if (!raw) return;

          const parsed = JSON.parse(raw);
          Object.values(parsed || {}).forEach((entry) => {
            const key = toLocalDateKey(entry?.attemptedAt);
            if (key) keys.add(key);
          });
        });
      } catch (err) {
        return keys;
      }

      return keys;
    };

    const refreshDailyStreak = async () => {
      const dateKeys = new Set();

      if (supabase) {
        try {
          const tableReady = await ensureAssessmentResultsTable(supabase);
          if (tableReady.ok) {
            const { data, error } = await supabase
              .from(ASSESSMENT_TABLE)
              .select('attempted_at')
              .eq('user_id', user.id)
              .order('attempted_at', { ascending: false })
              .limit(1000);

            if (!error) {
              (data || []).forEach((row) => {
                const key = toLocalDateKey(row?.attempted_at);
                if (key) dateKeys.add(key);
              });
            }
          }
        } catch (err) {
          // Fall back to local activity if database lookup fails.
        }
      }

      const localKeys = getLocalActivityDateKeys();
      localKeys.forEach((key) => dateKeys.add(key));

      if (!cancelled) {
        setDailyStreak(calculateCurrentStreak(dateKeys));
      }
    };

    refreshDailyStreak();

    const poll = setInterval(() => {
      refreshDailyStreak();
    }, 60000);

    const handleFocus = () => refreshDailyStreak();
    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener('focus', handleFocus);
    };
  }, [supabase, user?.id]);

  const isReattemptActive = (courseId) => {
    try {
      const raw = localStorage.getItem(getReattemptKey(courseId));
      const parsed = raw ? JSON.parse(raw) : null;
      return Boolean(parsed?.active);
    } catch (err) {
      return false;
    }
  };

  const getCoursePageCount = (course) => {
    try {
      const parsed = JSON.parse(course?.material || '{}');
      return Array.isArray(parsed?.pages) ? parsed.pages.length : 0;
    } catch (err) {
      return 0;
    }
  };

  const getCoursePages = (course) => {
    try {
      const parsed = JSON.parse(course?.material || '{}');
      return Array.isArray(parsed?.pages) ? parsed.pages : [];
    } catch (err) {
      return [];
    }
  };

  const getMaterialPageCount = (materialValue) => {
    try {
      const parsed = typeof materialValue === 'string' ? parseCourseMaterial(materialValue) : (materialValue || { pages: [] });
      return Array.isArray(parsed?.pages) ? parsed.pages.length : 0;
    } catch (err) {
      return 0;
    }
  };

  const formatDateTime = (value) => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  };

  const parseSelfMaterialPages = (material) => {
    if (!material) return [];

    if (typeof material === 'object' && Array.isArray(material.pages)) {
      return material.pages;
    }

    if (typeof material === 'string') {
      try {
        const parsed = JSON.parse(material);
        return Array.isArray(parsed?.pages) ? parsed.pages : [];
      } catch (err) {
        return [];
      }
    }

    return [];
  };

  const generateSelfStudyPageWithAI = async (pageText, pageNum) => {
    const safeText = String(pageText || '').trim();
    if (!safeText) {
      const fallback = createQuestionsForPage('');
      return {
        title: `Page ${pageNum}`,
        content: fallback.summary || 'No content available.',
        summary: fallback.summary || 'No summary available.',
        quiz: fallback.quiz,
        shortAnswer: fallback.shortAnswer,
      };
    }

    if (!GROQ_API_KEY) {
      const fallback = createQuestionsForPage(safeText);
      return {
        title: `Page ${pageNum}`,
        content: safeText,
        summary: fallback.summary,
        quiz: fallback.quiz,
        shortAnswer: fallback.shortAnswer,
      };
    }

    try {
      const prompt = `You are an educational assistant. Use the source text below to produce one structured study page.

Source text:
${safeText}

Return valid JSON only with this exact shape:
{
  "title": "Short page title",
  "content": "Clear explanation in simple terms (120-180 words)",
  "summary": "One concise summary sentence",
  "quiz": {
    "question": "One multiple-choice question",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": "Exact correct option text"
  },
  "shortAnswer": {
    "question": "One short-answer question that tests understanding",
    "answer": "Ideal answer in 1-2 sentences"
  }
}`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: 1200,
        }),
      });

      if (!response.ok) throw new Error(`AI request failed: ${response.status}`);

      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content?.trim() || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI returned non-JSON output');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: String(parsed?.title || `Page ${pageNum}`),
        content: String(parsed?.content || safeText),
        summary: String(parsed?.summary || ''),
        quiz: {
          question: String(parsed?.quiz?.question || 'Which idea is most important on this page?'),
          options: Array.isArray(parsed?.quiz?.options) && parsed.quiz.options.length >= 2
            ? parsed.quiz.options.slice(0, 4).map((item) => String(item || '').trim()).filter(Boolean)
            : createQuestionsForPage(safeText).quiz.options,
          answer: String(parsed?.quiz?.answer || createQuestionsForPage(safeText).quiz.answer),
        },
        shortAnswer: {
          question: String(parsed?.shortAnswer?.question || createQuestionsForPage(safeText).shortAnswer.question),
          answer: String(parsed?.shortAnswer?.answer || createQuestionsForPage(safeText).shortAnswer.answer),
        },
      };
    } catch (err) {
      const fallback = createQuestionsForPage(safeText);
      return {
        title: `Page ${pageNum}`,
        content: safeText,
        summary: fallback.summary,
        quiz: fallback.quiz,
        shortAnswer: fallback.shortAnswer,
      };
    }
  };

  const fetchSelfMaterials = async () => {
    if (!supabase || !user?.id) return;
    setIsSelfMaterialsLoading(true);
    try {
      const tableReady = await ensureStudentSelfMaterialsTable(supabase);
      if (!tableReady.ok) throw new Error('Self materials table is not ready');

      const { data, error } = await supabase
        .from(SELF_MATERIALS_TABLE)
        .select('id, title, source_file_name, material, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = data || [];
      setSelfMaterials(rows);
      if (!selectedSelfMaterialId && rows.length > 0) {
        setSelectedSelfMaterialId(rows[0].id);
      }
      if (rows.length === 0) {
        setSelectedSelfMaterialId(null);
      }
    } catch (err) {
      setSelfMaterialNotice(err?.message || 'Unable to load your self-study materials.');
    } finally {
      setIsSelfMaterialsLoading(false);
    }
  };

  const handleUploadSelfMaterial = async (e) => {
    e.preventDefault();
    if (!supabase || !user?.id) return;

    const safeTitle = (selfMaterialTitle || '').trim();
    if (!safeTitle) {
      setSelfMaterialNotice('Please add a title for your material.');
      return;
    }
    if (!selfMaterialFile) {
      setSelfMaterialNotice('Please upload a PDF, DOCX, or TXT file.');
      return;
    }

    setSelfMaterialNotice('');
    setIsSelfMaterialUploading(true);
    setSelfMaterialProgress('Extracting text from your document...');

    try {
      const tableReady = await ensureStudentSelfMaterialsTable(supabase);
      if (!tableReady.ok) throw new Error('Self materials table is not ready yet.');

      const text = await extractTextFromDocument(selfMaterialFile);
      if (!text || text.trim().length < 50) {
        throw new Error('The file has too little readable content.');
      }

      const chunks = splitTextIntoPages(text, 220).slice(0, 12);
      const pages = [];

      for (let index = 0; index < chunks.length; index += 1) {
        setSelfMaterialProgress(`Generating AI study content ${index + 1}/${chunks.length}...`);
        const page = await generateSelfStudyPageWithAI(chunks[index], index + 1);
        pages.push({
          pageNumber: index + 1,
          ...page,
        });
      }

      const payload = {
        user_id: user.id,
        title: safeTitle,
        source_file_name: selfMaterialFile.name,
        source_file_type: selfMaterialFile.type,
        source_text: text.slice(0, 15000),
        material: { pages },
      };

      const { error } = await supabase.from(SELF_MATERIALS_TABLE).insert([payload]);
      if (error) throw error;

      setSelfMaterialTitle('');
      setSelfMaterialFile(null);
      setSelfMaterialNotice('Material processed successfully. Only you can access it.');
      await fetchSelfMaterials();
    } catch (err) {
      setSelfMaterialNotice(err?.message || 'Failed to process your material.');
    } finally {
      setIsSelfMaterialUploading(false);
      setSelfMaterialProgress('');
    }
  };

  const getGoalDayLimit = (courseId) => {
    const goalItem = goalItems.find((item) => item.id === courseId);
    const pageCount = Math.max(1, getMaterialPageCount(goalItem?.material));
    // Keep goals realistic for short courses: max days cannot exceed total pages.
    return Math.max(1, Math.min(30, pageCount));
  };

  const getPagesPerDayTarget = (totalPages, targetDays) => {
    const safeDays = Math.max(1, Number(targetDays || 1));
    return Math.max(1, Math.ceil(Math.max(1, totalPages) / safeDays));
  };

  const buildDailyPagePlan = (totalPages, targetDays) => {
    const safeTotalPages = Math.max(1, Number(totalPages || 1));
    const safeDays = Math.max(1, Number(targetDays || 1));
    const pagesPerDay = getPagesPerDayTarget(safeTotalPages, safeDays);

    return Array.from({ length: safeDays }, (_, index) => {
      const day = index + 1;
      const startPage = index * pagesPerDay + 1;
      const endPage = Math.min(safeTotalPages, (index + 1) * pagesPerDay);

      if (startPage > safeTotalPages) {
        return {
          day,
          pages: 0,
          startPage: null,
          endPage: null,
          label: 'Revision / buffer day',
        };
      }

      return {
        day,
        pages: endPage - startPage + 1,
        startPage,
        endPage,
        label: `Page ${startPage}${endPage > startPage ? `-${endPage}` : ''}`,
      };
    });
  };

  const inferTopicFromPage = (page, fallbackLabel = 'This topic') => {
    const title = (page?.title || '').trim();
    const summary = (page?.summary || '').trim();
    const content = (page?.content || '').trim();

    const titleLooksGeneric = !title || /^page\s*\d+$/i.test(title) || /^slide\s*\d+$/i.test(title);
    if (!titleLooksGeneric) return title;

    const sourceText = `${summary} ${content}`.toLowerCase();
    const words = sourceText.match(/[a-z]{4,}/g) || [];
    if (!words.length) return fallbackLabel;

    const stopWords = new Set([
      'that', 'with', 'this', 'from', 'have', 'will', 'into', 'your', 'about', 'which', 'when', 'where',
      'what', 'their', 'there', 'were', 'been', 'than', 'then', 'also', 'using', 'used', 'these', 'those',
      'each', 'more', 'such', 'over', 'under', 'between', 'within', 'while', 'through', 'after', 'before',
      'because', 'should', 'could', 'would', 'other', 'some', 'many', 'much', 'very', 'most', 'only', 'into',
      'them', 'they', 'ours', 'ourselves', 'itself', 'it', 'course', 'topic', 'page', 'student', 'students',
    ]);

    const frequency = {};
    words.forEach((word) => {
      if (stopWords.has(word)) return;
      frequency[word] = (frequency[word] || 0) + 1;
    });

    const topWords = Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);

    if (!topWords.length) return fallbackLabel;
    return topWords.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' / ');
  };

  const getLocalPageResults = (courseId) => {
    if (!user?.id) return null;
    try {
      const key = getResultsKey(courseId);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      return null;
    }
  };

  const buildAiAnalysis = ({
    course,
    totalScore,
    totalQuestions,
    existingFeedback,
    serverPageBreakdown = [],
  }) => {
    const pages = getCoursePages(course);
    const localResults = getLocalPageResults(course?.id);
    let pageLosses = [];

    if (localResults && typeof localResults === 'object') {
      pageLosses = Object.entries(localResults)
        .map(([pageIndex, item]) => {
          const score = Number(item?.score || 0);
          const total = Number(item?.total || 0);
          const lost = Math.max(0, total - score);
          const index = Number(pageIndex);
          const fallbackLabel = `Page ${index + 1}`;
          const topic = inferTopicFromPage(pages[index], fallbackLabel);
          return {
            topic,
            pageLabel: fallbackLabel,
            lost,
            total,
          };
        })
        .filter((entry) => entry.total > 0 && entry.lost > 0)
        .sort((a, b) => b.lost - a.lost);
    } else {
      pageLosses = [...serverPageBreakdown]
        .filter((entry) => Number(entry?.lost || 0) > 0)
        .sort((a, b) => Number(b.lost || 0) - Number(a.lost || 0))
        .map((entry) => ({
          topic: entry.topic,
          pageLabel: entry.pageLabel,
          lost: Number(entry.lost || 0),
          total: Number(entry.total || 0),
        }));
    }

    const totalLost = Math.max(0, Number(totalQuestions || 0) - Number(totalScore || 0));
    const weakAreas = pageLosses.slice(0, 3);

    if (totalQuestions <= 0) {
      return {
        weakAreas: [],
        suggestion: 'Complete more assessments to unlock personalized AI analysis.',
        performanceLabel: 'No assessment data yet',
      };
    }

    if (weakAreas.length === 0) {
      return {
        weakAreas: [],
        suggestion: existingFeedback || 'Strong performance across assessed pages. Keep this pace and challenge yourself with a reattempt for mastery.',
        performanceLabel: 'Great consistency',
      };
    }

    const topTopics = weakAreas.map((item) => item.topic).join(', ');
    let strategy = `Focus revision on ${topTopics}. Re-read each page summary, then retry those assessments before a full course reattempt.`;

    const lossRatio = totalQuestions > 0 ? totalLost / totalQuestions : 0;
    if (lossRatio >= 0.45) {
      strategy = `High mark loss detected in ${topTopics}. Spend 10-15 minutes per weak page reviewing core concepts and key terms, then reattempt in sequence.`;
    } else if (lossRatio <= 0.2) {
      strategy = `You are close to full marks. Tighten accuracy on ${topTopics} by reviewing mistakes once and reattempting immediately.`;
    }

    return {
      weakAreas,
      suggestion: existingFeedback ? `${existingFeedback} ${strategy}` : strategy,
      performanceLabel: 'Targeted improvement needed',
    };
  };

  const handleSelectCourse = (course) => {
    if (!course?.id) return;
    const isCompleted = Boolean(courseCompletionMap[course.id]);
    if (isCompleted && user?.id) {
      const reattemptKey = getReattemptKey(course.id);
      localStorage.removeItem(reattemptKey);
    }

    const totalPages = Math.max(1, getCoursePageCount(course));
    let resumeIndex = 0;

    try {
      const rawLastPage = localStorage.getItem(getLastPageKey(course.id));
      const parsedLastPage = Number(rawLastPage);
      if (Number.isFinite(parsedLastPage) && parsedLastPage >= 0) {
        resumeIndex = parsedLastPage;
      }

      const rawResults = localStorage.getItem(getResultsKey(course.id));
      const parsedResults = rawResults ? JSON.parse(rawResults) : {};
      const completedPages = Object.keys(parsedResults || {}).length;
      const nextUnattemptedIndex = Math.min(Math.max(completedPages, 0), totalPages - 1);
      if (!isCompleted) {
        resumeIndex = Math.max(resumeIndex, nextUnattemptedIndex);
      }
    } catch (err) {
      // Keep resumeIndex fallback.
    }

    const safeResumeIndex = Math.min(Math.max(resumeIndex, 0), totalPages - 1);
    navigate(`/course/${encodeURIComponent(String(course.id))}?page=${safeResumeIndex + 1}`);
  };

  const handleReattempt = async (courseId) => {
    if (!user?.id) return;

    localStorage.setItem(getReattemptKey(courseId), JSON.stringify({
      active: true,
      startedAt: new Date().toISOString(),
    }));
    localStorage.removeItem(getCompletionFlagKey(courseId));
    localStorage.removeItem(getResultsKey(courseId));
    localStorage.removeItem(getAnswersKey(courseId));
    localStorage.removeItem(`course-last-page-${courseId}-${user.id}`);

    setCourseCompletionMap((prev) => ({ ...prev, [courseId]: false }));

    // Reset server-side attempt state so the course does not bounce back to "Completed".
    if (supabase) {
      try {
        await ensureAssessmentResultsTable(supabase);
        await supabase
          .from(ASSESSMENT_TABLE)
          .delete()
          .eq('user_id', user.id)
          .eq('course_id', courseId);
      } catch (err) {
        console.warn('Could not reset server assessment rows for reattempt:', err?.message || err);
      }
    }

    setResultRows((prev) => prev.map((row) => {
      if (row.courseId !== courseId) return row;
      return {
        ...row,
        completedPages: 0,
        completionPercent: 0,
        isCompleted: false,
        feedback: '',
      };
    }));

    navigate(`/course/${courseId}`);
  };

  const createDefaultGoalTitle = (courseTitle, targetDays) => {
    return `Complete ${courseTitle} in ${targetDays} days`;
  };

  const getCourseProgress = (courseId) => {
    const goalItem = goalItems.find((item) => item.id === courseId);
    const totalPages = Math.max(1, getMaterialPageCount(goalItem?.material));

    const fromRows = resultRows.find((row) => row.courseId === courseId);
    if (fromRows) {
      const completedPages = Math.min(totalPages, Number(fromRows.completedPages || 0));
      const percent = Math.min(100, Math.round((completedPages / totalPages) * 100));
      return {
        completedPages,
        totalPages,
        percent,
        isCompleted: Boolean(courseCompletionMap[courseId]) || percent >= 100,
      };
    }

    const localResults = getLocalPageResults(courseId) || {};
    const completedPages = Math.min(totalPages, Object.keys(localResults).length);
    const percent = Math.min(100, Math.round((completedPages / totalPages) * 100));

    return {
      completedPages,
      totalPages,
      percent,
      isCompleted: Boolean(courseCompletionMap[courseId]) || percent >= 100,
    };
  };

  const selectedGoalCourse = goalItems.find((item) => item.id === goalForm.courseId) || goalItems[0] || null;
  const selectedGoalTotalPages = Math.max(1, getMaterialPageCount(selectedGoalCourse?.material));
  const selectedGoalMaxDays = selectedGoalCourse ? getGoalDayLimit(selectedGoalCourse.id) : 1;
  const normalizedGoalFormDays = Math.min(selectedGoalMaxDays, Math.max(1, Number(goalForm.targetDays || 1)));
  const selectedGoalPagesPerDay = getPagesPerDayTarget(selectedGoalTotalPages, normalizedGoalFormDays);
  const selectedSelfMaterial = selfMaterials.find((item) => item.id === selectedSelfMaterialId) || selfMaterials[0] || null;
  const selectedSelfMaterialPages = parseSelfMaterialPages(selectedSelfMaterial?.material);

  const handleCreateGoal = (e) => {
    e.preventDefault();
    if (!user?.id) return;

    const courseId = goalForm.courseId || goalItems?.[0]?.id;
    if (!courseId) return;

    const selectedCourse = goalItems.find((item) => item.id === courseId);
    const totalPages = Math.max(1, getMaterialPageCount(selectedCourse?.material));
    const maxAllowedDays = getGoalDayLimit(courseId);
    const requestedDays = Math.max(1, Number(goalForm.targetDays || 1));
    const targetDays = Math.min(requestedDays, maxAllowedDays);
    const pagesPerDay = getPagesPerDayTarget(totalPages, targetDays);
    const dailyPlan = buildDailyPagePlan(totalPages, targetDays);
    const courseTitle = selectedCourse?.title || 'Selected course';
    const title = (goalForm.title || '').trim() || createDefaultGoalTitle(courseTitle, targetDays);

    const createdAt = new Date().toISOString();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + targetDays);

    if (requestedDays > maxAllowedDays) {
      setGoalFormNotice(`For this course, days are limited to ${maxAllowedDays} based on content size.`);
    } else {
      setGoalFormNotice('');
    }

    const newGoal = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      courseId,
      targetDays,
      totalPages,
      maxAllowedDays,
      pagesPerDay,
      dailyPlan,
      createdAt,
      dueDate: dueDate.toISOString(),
      type: 'course-deadline',
    };

    setGoals((prev) => [newGoal, ...prev]);
    const resetMaxDays = getGoalDayLimit(courseId);
    setGoalForm({
      title: '',
      courseId,
      targetDays: Math.min(7, resetMaxDays),
    });
  };

  const handleDeleteGoal = (goalId) => {
    setGoals((prev) => prev.filter((goal) => goal.id !== goalId));
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    const safeName = (profileName || '').trim();
    if (!safeName) {
      setProfileNotice('Name is required.');
      return;
    }

    setProfileNotice('');
    setIsSavingProfile(true);
    try {
      await updateProfileName({ fullName: safeName });
      setProfileNotice('Profile updated successfully.');
      setIsEditingProfile(false);
    } catch (err) {
      setProfileNotice(err?.message || 'Failed to update profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleStartProfileEdit = () => {
    setProfileNotice('');
    setProfileName(getResolvedProfileName());
    setIsEditingProfile(true);
  };

  const handleCancelProfileEdit = () => {
    setProfileNotice('');
    setProfileName(getResolvedProfileName());
    setIsEditingProfile(false);
  };

  const rankingRows = enrolledCourses
    .map((course) => {
      const row = resultRows.find((item) => item.courseId === course.id);
      const progress = getCourseProgress(course.id);

      const completionPercent = Math.max(
        progress.percent,
        Math.min(100, Number(row?.completionPercent || 0))
      );
      const totalQuestions = Math.max(0, Number(row?.totalQuestions || 0));
      const totalScore = Math.max(0, Number(row?.totalScore || 0));
      const accuracy = totalQuestions > 0 ? totalScore / totalQuestions : 0;

      const dayKeys = new Set();
      try {
        const raw = localStorage.getItem(getResultsKey(course.id));
        const parsed = raw ? JSON.parse(raw) : {};
        Object.values(parsed || {}).forEach((entry) => {
          const key = toLocalDateKey(entry?.attemptedAt);
          if (key) dayKeys.add(key);
        });
      } catch (err) {
        // Ignore malformed local cache.
      }

      if (dayKeys.size === 0 && row?.createdAt) {
        const lastAttemptKey = toLocalDateKey(row.createdAt);
        if (lastAttemptKey) dayKeys.add(lastAttemptKey);
      }

      const streak = calculateCurrentStreak(dayKeys);
      const xp = Math.round(
        completionPercent * 4 +
        accuracy * 320 +
        progress.completedPages * 10 +
        (streak > 0 ? streak * 12 : 0)
      );

      return {
        id: course.id,
        title: course.title,
        streak,
        xp,
      };
    })
    .sort((a, b) => b.xp - a.xp || b.streak - a.streak)
    .slice(0, 5);

  const getCourseProgressSummary = (course) => {
    const totalPages = Math.max(1, getCoursePageCount(course));
    let completedPages = 0;

    try {
      const raw = localStorage.getItem(getResultsKey(course.id));
      const parsed = raw ? JSON.parse(raw) : {};
      completedPages = Math.min(totalPages, Object.keys(parsed || {}).length);
    } catch (err) {
      completedPages = 0;
    }

    if (courseCompletionMap[course.id]) {
      completedPages = totalPages;
    }

    const percent = Math.min(100, Math.round((completedPages / totalPages) * 100));
    return { completedPages, totalPages, percent };
  };

  useEffect(() => {
    if (!user?.id) {
      setGoals([]);
      setHasHydratedGoals(false);
      return;
    }

    let cancelled = false;

    const readLocalGoals = () => {
      try {
        const raw = localStorage.getItem(getGoalsStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    };

    const hydrateGoals = async () => {
      setHasHydratedGoals(false);
      const localGoals = readLocalGoals();

      if (!supabase) {
        if (!cancelled) {
          setGoals(localGoals);
          setHasHydratedGoals(true);
        }
        return;
      }

      try {
        const tableReady = await ensureStudentGoalsTable(supabase);
        if (!tableReady.ok) {
          if (!cancelled) {
            setGoals(localGoals);
            setHasHydratedGoals(true);
          }
          return;
        }

        const { data, error } = await supabase
          .from(GOALS_TABLE)
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const remoteGoals = (data || []).map((row) => ({
          id: row.goal_id || row.id,
          title: row.title || '',
          courseId: row.course_id,
          targetDays: Number(row.target_days || 1),
          totalPages: Number(row.total_pages || 1),
          maxAllowedDays: Number(row.max_allowed_days || 1),
          pagesPerDay: Number(row.pages_per_day || 1),
          dailyPlan: Array.isArray(row.daily_plan) ? row.daily_plan : [],
          createdAt: row.created_at,
          dueDate: row.due_date,
          type: row.goal_type || 'course-deadline',
        }));

        if (!cancelled) {
          const nextGoals = remoteGoals.length ? remoteGoals : localGoals;
          setGoals(nextGoals);
          localStorage.setItem(getGoalsStorageKey(), JSON.stringify(nextGoals));
          setHasHydratedGoals(true);
        }
      } catch (err) {
        if (!cancelled) {
          setGoals(localGoals);
          setHasHydratedGoals(true);
        }
      }
    };

    hydrateGoals();

    return () => {
      cancelled = true;
    };
  }, [user?.id, supabase]);

  useEffect(() => {
    if (!user?.id || !hasHydratedGoals) return;
    localStorage.setItem(getGoalsStorageKey(), JSON.stringify(goals));

    if (!supabase) return;

    let cancelled = false;
    const syncGoalsToDatabase = async () => {
      try {
        const tableReady = await ensureStudentGoalsTable(supabase);
        if (!tableReady.ok || cancelled) return;

        const { error: deleteError } = await supabase
          .from(GOALS_TABLE)
          .delete()
          .eq('user_id', user.id);
        if (deleteError || cancelled) return;

        if (!goals.length) return;

        const rows = goals.map((goal) => ({
          user_id: user.id,
          goal_id: goal.id,
          title: goal.title,
          course_id: goal.courseId,
          target_days: Number(goal.targetDays || 1),
          total_pages: Number(goal.totalPages || 1),
          max_allowed_days: Number(goal.maxAllowedDays || 1),
          pages_per_day: Number(goal.pagesPerDay || 1),
          daily_plan: Array.isArray(goal.dailyPlan) ? goal.dailyPlan : [],
          due_date: goal.dueDate,
          goal_type: goal.type || 'course-deadline',
          created_at: goal.createdAt || new Date().toISOString(),
        }));

        await supabase.from(GOALS_TABLE).insert(rows);
      } catch (err) {
        // Keep local storage as fallback when database sync fails.
      }
    };

    syncGoalsToDatabase();

    return () => {
      cancelled = true;
    };
  }, [goals, user?.id, hasHydratedGoals, supabase]);

  useEffect(() => {
    if (!courses.length) return;
    setGoalForm((prev) => {
      if (prev.courseId) return prev;
      return { ...prev, courseId: courses[0].id };
    });
  }, [courses]);

  useEffect(() => {
    if (!goalForm.courseId) return;
    const maxDays = getGoalDayLimit(goalForm.courseId);
    const currentDays = Math.max(1, Number(goalForm.targetDays || 1));
    if (currentDays <= maxDays) return;

    setGoalForm((prev) => ({ ...prev, targetDays: maxDays }));
    setGoalFormNotice(`For this course, max allowed days is ${maxDays}.`);
  }, [goalForm.courseId]);

  useEffect(() => {
    if (!user?.id || !courses.length) {
      setCourseCompletionMap({});
      return;
    }

    const buildLocalCompletionMap = () => {
      const localMap = {};
      courses.forEach((course) => {
        if (isReattemptActive(course.id)) {
          localMap[course.id] = false;
          return;
        }

        // First check for explicit completion flag (saved after course is fully completed)
        const completionFlagKey = `course-completed-${course.id}-${user.id}`;
        const completionFlag = localStorage.getItem(completionFlagKey);
        
        if (completionFlag) {
          try {
            const flagData = JSON.parse(completionFlag);
            if (flagData.completed === true) {
              localMap[course.id] = true;
              return;
            }
          } catch (err) {
            // Fall through to check results
          }
        }
        
        // Fall back to checking if all pages have assessment results
        const key = `course-results-${course.id}-${user.id}`;
        const raw = localStorage.getItem(key);
        if (!raw) {
          localMap[course.id] = false;
          return;
        }

        try {
          const parsed = JSON.parse(raw);
          const completedPages = Object.keys(parsed || {}).length;
          const totalPages = getCoursePageCount(course);
          localMap[course.id] = totalPages > 0 ? completedPages >= totalPages : completedPages > 0;
        } catch (err) {
          localMap[course.id] = false;
        }
      });
      return localMap;
    };

    const refreshCompletionMap = async () => {
      const localMap = buildLocalCompletionMap();

      if (!supabase) {
        setCourseCompletionMap(localMap);
        return;
      }

      try {
        const tableReady = await ensureAssessmentResultsTable(supabase);
        if (!tableReady.ok) {
          console.error('Unable to auto-create assessment table while loading completion map:', tableReady.error || tableReady.reason);
          setCourseCompletionMap(localMap);
          return;
        }

        const { data } = await supabase
          .from(ASSESSMENT_TABLE)
          .select('*')
          .eq('user_id', user.id);

        const merged = { ...localMap };
        (data || []).forEach((entry) => {
          if (isReattemptActive(entry.course_id)) {
            merged[entry.course_id] = false;
            return;
          }

          // Mark as completed if: explicitly marked OR completion_percent >= 100
          const isCompleted = Boolean(entry.course_completed) || Number(entry.completion_percent || 0) >= 100;
          if (isCompleted) {
            merged[entry.course_id] = true;
            // Also save to localStorage as backup if DB says it's complete
            const completionFlagKey = `course-completed-${entry.course_id}-${user.id}`;
            localStorage.setItem(completionFlagKey, JSON.stringify({
              completed: true,
              completedAt: entry.attempted_at || new Date().toISOString(),
              completionPercent: entry.completion_percent
            }));
          }
        });

        setCourseCompletionMap(merged);
      } catch (err) {
        console.error('Failed to fetch completion status from database:', err);
        // Table not ready or query failed: keep local completion only.
        setCourseCompletionMap(localMap);
      }
    };

    refreshCompletionMap();

    const poll = setInterval(() => {
      refreshCompletionMap();
    }, 10000);

    const handleFocus = () => refreshCompletionMap();
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', handleFocus);
    };
  }, [courses, user?.id, supabase]);

  useEffect(() => {
    if ((activeTab !== 'my-results' && activeTab !== 'goals' && activeTab !== 'daily-rankings') || !supabase || !user?.id) return;

    const getLocalRows = () => {
      const rows = [];
      courses.forEach((course) => {
        const key = `course-results-${course.id}-${user.id}`;
        const raw = localStorage.getItem(key);
        if (!raw) return;

        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object') return;

          const entries = Object.values(parsed);
          if (entries.length === 0) return;

          const totalScore = entries.reduce((acc, item) => acc + Number(item?.score || 0), 0);
          const totalQuestions = entries.reduce((acc, item) => acc + Number(item?.total || 0), 0);
          const completedPages = entries.length;
          const totalPages = getCoursePageCount(course) || completedPages;
          const latestAttempt = entries.reduce((latest, item) => {
            const t = item?.attemptedAt ? new Date(item.attemptedAt).getTime() : 0;
            return t > latest ? t : latest;
          }, 0);

          const aiAnalysis = buildAiAnalysis({
            course,
            totalScore,
            totalQuestions,
            existingFeedback: '',
          });

          rows.push({
            id: `local-${course.id}`,
            courseId: course.id,
            title: course.title || 'Untitled Course',
            totalScore,
            totalQuestions,
            completionPercent: totalQuestions > 0 ? Math.round((totalScore / totalQuestions) * 100) : 0,
            completedPages,
            totalPages,
            isCompleted: completedPages >= totalPages,
            feedback: '',
            aiAnalysis,
            createdAt: latestAttempt ? new Date(latestAttempt).toISOString() : new Date().toISOString(),
            source: 'local',
          });
        } catch (err) {
          // Ignore malformed local cache entries.
        }
      });
      return rows;
    };

    const mapRows = (records) => {
      const byCourse = {};
      records.forEach((item) => {
        const courseKey = item.course_id;
        if (!byCourse[courseKey]) {
          byCourse[courseKey] = {
            latest: item,
            pageMap: {},
          };
        }

        if (item.page_index) {
          byCourse[courseKey].pageMap[item.page_index] = item;
        }

        if (new Date(item.attempted_at) > new Date(byCourse[courseKey].latest.attempted_at)) {
          byCourse[courseKey].latest = item;
        }
      });

      const rows = Object.values(byCourse).map((entry) => {
        const item = entry.latest;
        const courseInfo = courses.find((course) => course.id === item.course_id);
        const activeReattempt = isReattemptActive(item.course_id);
        const pageEntries = Object.values(entry.pageMap).sort((a, b) => Number(a.page_index || 0) - Number(b.page_index || 0));

        let previousScore = 0;
        let previousQuestions = 0;
        const pageBreakdown = pageEntries.map((pageEntry, idx) => {
          const currentScore = Number(pageEntry.total_score || 0);
          const currentQuestions = Number(pageEntry.total_questions || 0);
          const pageScore = Math.max(0, currentScore - previousScore);
          const pageTotal = Math.max(0, currentQuestions - previousQuestions) || 2;
          const lost = Math.max(0, pageTotal - pageScore);
          previousScore = currentScore;
          previousQuestions = currentQuestions;

          const pageIndex = Number(pageEntry.page_index || idx + 1) - 1;
          const fallbackLabel = pageEntry.page_title || `Page ${Number(pageEntry.page_index || idx + 1)}`;
          const topic = inferTopicFromPage(getCoursePages(courseInfo)[pageIndex], fallbackLabel);

          return {
            topic,
            pageLabel: fallbackLabel,
            lost,
            total: pageTotal,
          };
        });

        const completedPages = Object.keys(entry.pageMap).length;
        const totalPages = getCoursePageCount(courseInfo) || completedPages;
        const localResultsForCourse = getLocalPageResults(item.course_id) || {};
        const localCompletedPages = Object.keys(localResultsForCourse).length;
        const effectiveCompletedPages = activeReattempt ? Math.min(totalPages || localCompletedPages, localCompletedPages) : completedPages;
        const effectiveCompletionPercent = activeReattempt
          ? (totalPages > 0 ? Math.round((effectiveCompletedPages / totalPages) * 100) : 0)
          : (item.completion_percent || 0);
        const aiAnalysis = buildAiAnalysis({
          course: courseInfo,
          totalScore: item.total_score || 0,
          totalQuestions: item.total_questions || 0,
          existingFeedback: item.ai_feedback || '',
          serverPageBreakdown: pageBreakdown,
        });

        return {
          id: item.course_id,
          courseId: item.course_id,
          title: item.course_title || courseInfo?.title || 'Untitled Course',
          totalScore: item.total_score || 0,
          totalQuestions: item.total_questions || 0,
          completionPercent: effectiveCompletionPercent,
          completedPages: effectiveCompletedPages,
          totalPages,
          isCompleted: activeReattempt ? false : Boolean(item.course_completed),
          feedback: item.ai_feedback || '',
          aiAnalysis,
          createdAt: item.attempted_at,
          source: 'server',
        };
      });

      const localRows = getLocalRows();
      localRows.forEach((localRow) => {
        const existing = rows.find((row) => row.courseId === localRow.courseId);
        if (!existing) {
          rows.push(localRow);
          return;
        }

        // If a server row exists for the same course, keep server as source of truth.
        if (existing.source === 'server') return;

        if (new Date(localRow.createdAt) > new Date(existing.createdAt)) {
          const index = rows.findIndex((row) => row.courseId === localRow.courseId);
          if (index >= 0) rows[index] = localRow;
        }
      });

      rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setResultRows(rows);
    };

    const fetchResults = async () => {
      setResultsLoading(true);
      try {
        const tableReady = await ensureAssessmentResultsTable(supabase);
        if (!tableReady.ok) {
          console.error('Unable to auto-create assessment table while loading results:', tableReady.error || tableReady.reason);
          mapRows([]);
          return;
        }

        const { data } = await supabase
          .from(ASSESSMENT_TABLE)
          .select('course_id, attempted_at, course_title, total_score, total_questions, completion_percent, course_completed, ai_feedback, page_index, page_title')
          .eq('user_id', user.id)
          .order('attempted_at', { ascending: false });
        mapRows(data || []);
      } catch (err) {
        // Table not ready or query failed: show local rows only.
        mapRows([]);
      } finally {
        setResultsLoading(false);
      }
    };

    fetchResults();

    const poll = setInterval(() => {
      fetchResults();
    }, 10000);

    const handleFocus = () => fetchResults();
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', handleFocus);
    };
  }, [activeTab, supabase, user?.id, courses]);

  return (
    <div className="max-w-7xl page-enter">
      {/* Header */}
      <div className="mb-12">
        <div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 italic mb-2">STUDENT PORTAL</h1>
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Focus, progress, and consistent daily growth</p>
        </div>
      </div>
      {(activeTab === 'overview' || activeTab === 'my-courses' || activeTab === 'browse') && (
      <div className="mb-12">
        <div className="relative max-w-2xl">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search courses..."
            className="w-full bg-white border border-slate-300 rounded-2xl pl-12 pr-6 py-4 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 font-semibold"
          />
        </div>
      </div>
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12 animate-stagger">
          <div className="app-panel rounded-2xl p-5 hover-lift">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Enrolled</p>
            <p className="text-3xl font-black text-slate-900">{enrolledCourses.length}</p>
          </div>
          <div className="app-panel rounded-2xl p-5 hover-lift">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Available</p>
            <p className="text-3xl font-black text-slate-900">{availableCourses.length}</p>
          </div>
          <div className="app-panel rounded-2xl p-5 hover-lift">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Daily Streak</p>
            <p className="text-3xl font-black text-teal-700">{dailyStreak} {dailyStreak === 1 ? 'Day' : 'Days'}</p>
          </div>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'my-courses') && (
      <>
        {activeTab === 'overview' && enrolledCourses.length > 0 && (
          <div className="mb-16">
            <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-teal-700" />
              Assigned Course Materials
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
              {enrolledCourses.map(course => (
                (() => {
                  const isCompleted = Boolean(courseCompletionMap[course.id]);
                  return (
                <div
                  key={course.id}
                  onClick={() => handleSelectCourse(course)}
                  className={`app-panel rounded-3xl overflow-hidden cursor-pointer transition-all group hover-lift ${isCompleted ? 'hover:border-emerald-500' : 'hover:border-teal-600'}`}
                >
                  <div className="p-6 space-y-4">
                    {isCompleted && (
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-wider">
                        <CheckCircle2 className="w-3 h-3" /> Completed
                      </div>
                    )}
                    <h3 className="text-xl font-black text-slate-900 group-hover:text-teal-700 transition-colors line-clamp-2">{course.title}</h3>
                    <p className="text-slate-600 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
                    <button className={`w-full text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${isCompleted ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500' : 'bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-600 hover:to-cyan-600'}`}>
                      <Play className="w-4 h-4" />
                      {isCompleted ? 'Review Course' : 'Continue Learning'}
                    </button>
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
          </div>
        )}

        {activeTab === 'my-courses' && (
          <div className="space-y-10 mb-16">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setMyCoursesType('admin')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  myCoursesType === 'admin'
                    ? 'bg-cyan-700 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:border-cyan-400'
                }`}
              >
                Assigned Courses
              </button>
              <button
                type="button"
                onClick={() => setMyCoursesType('self')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  myCoursesType === 'self'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:border-emerald-400'
                }`}
              >
                Self Study
              </button>
            </div>

            {myCoursesType === 'admin' && (
            <>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setMyCoursesFilter('in-progress')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  myCoursesFilter === 'in-progress'
                    ? 'bg-cyan-700 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:border-cyan-400'
                }`}
              >
                In Progress ({inProgressEnrolledCourses.length})
              </button>
              <button
                type="button"
                onClick={() => setMyCoursesFilter('completed')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  myCoursesFilter === 'completed'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:border-emerald-400'
                }`}
              >
                Completed Courses ({completedEnrolledCourses.length})
              </button>
            </div>

            {myCoursesFilter === 'in-progress' && (
            <div>
              <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
                <Clock3 className="w-6 h-6 text-cyan-700" />
                In Progress
              </h2>
              {inProgressEnrolledCourses.length === 0 ? (
                <div className="app-panel rounded-2xl p-5 text-slate-500 font-semibold">No in-progress courses.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
                  {inProgressEnrolledCourses.map(course => (
                    (() => {
                      const progress = getCourseProgressSummary(course);
                      return (
                    <div
                      key={course.id}
                      onClick={() => handleSelectCourse(course)}
                      className="app-panel rounded-3xl overflow-hidden hover:border-cyan-600 cursor-pointer transition-all group hover-lift"
                    >
                      <div className="p-6 space-y-4">
                        <h3 className="text-xl font-black text-slate-900 group-hover:text-cyan-700 transition-colors line-clamp-2">{course.title}</h3>
                        <p className="text-slate-600 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
                        <div className="space-y-2">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-700">Progress {progress.completedPages}/{progress.totalPages} pages ({progress.percent}%)</p>
                          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                            <div
                              className="h-2.5 rounded-full bg-cyan-600 transition-all"
                              style={{ width: `${Math.max(4, progress.percent)}%` }}
                            />
                          </div>
                        </div>
                        <button className="w-full bg-gradient-to-r from-cyan-700 to-sky-700 hover:from-cyan-600 hover:to-sky-600 text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                          <Play className="w-4 h-4" />
                          Continue Learning
                        </button>
                      </div>
                    </div>
                      );
                    })()
                  ))}
                </div>
              )}
            </div>
            )}

            {myCoursesFilter === 'completed' && (
            <div>
              <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                Completed Courses
              </h2>
              {completedEnrolledCourses.length === 0 ? (
                <div className="app-panel rounded-2xl p-5 text-slate-500 font-semibold">No completed courses yet.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
                  {completedEnrolledCourses.map(course => (
                    (() => {
                      const progress = getCourseProgressSummary(course);
                      return (
                    <div
                      key={course.id}
                      onClick={() => handleSelectCourse(course)}
                      className="app-panel rounded-3xl overflow-hidden border-emerald-200 hover:border-emerald-400 cursor-pointer transition-all group hover-lift"
                    >
                      <div className="p-6 space-y-4">
                        <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-wider">
                          <CheckCircle2 className="w-3 h-3" /> Completed
                        </div>
                        <h3 className="text-xl font-black text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-2">{course.title}</h3>
                        <p className="text-slate-600 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Progress {progress.completedPages}/{progress.totalPages} pages (100%)</p>
                        <button className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                          <Play className="w-4 h-4" />
                          Review Course
                        </button>
                      </div>
                    </div>
                      );
                    })()
                  ))}
                </div>
              )}
            </div>
            )}
            </>
            )}

            {myCoursesType === 'self' && (
              <div>
                <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
                  <FileText className="w-6 h-6 text-emerald-700" />
                  Self Study Materials
                </h2>
                {isSelfMaterialsLoading ? (
                  <div className="app-panel rounded-2xl p-5 text-slate-500 font-semibold flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
                    Loading self study materials...
                  </div>
                ) : filteredSelfMaterials.length === 0 ? (
                  <div className="app-panel rounded-2xl p-5 text-slate-500 font-semibold">No self-study materials found.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
                    {filteredSelfMaterials.map((mat) => (
                      <div
                        key={mat.id}
                        onClick={() => navigate(`/course/${encodeURIComponent(String(mat.id))}?isSelfMaterial=true`)}
                        className="app-panel rounded-3xl overflow-hidden border-emerald-200 hover:border-emerald-400 cursor-pointer transition-all group hover-lift"
                      >
                        <div className="p-6 space-y-4">
                          <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-wider">
                            <Sparkles className="w-3 h-3" /> Self Study
                          </div>
                          <h3 className="text-xl font-black text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-2">{mat.title}</h3>
                          <p className="text-slate-600 text-sm line-clamp-2 leading-relaxed">Uploaded on {formatDateTime(mat.created_at)}</p>
                          <button className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                            <Play className="w-4 h-4" />
                            Continue Learning
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </>
      )}

      {(activeTab === 'overview' || activeTab === 'browse') && (
      <>
        {availableCourses.length > 0 && (
          <div>
            <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
              <Compass className="w-6 h-6 text-cyan-700" />
              {activeTab === 'browse' ? 'Browse Course Library' : 'Explore More Courses'}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
              {availableCourses.map(course => (
                <div
                  key={course.id}
                  className="app-panel rounded-3xl overflow-hidden hover:border-cyan-600 transition-all group hover-lift"
                >
                  <div className="p-6 space-y-4">
                    <h3 className="text-xl font-black text-slate-900 group-hover:text-cyan-700 transition-colors line-clamp-2">{course.title}</h3>
                    <p className="text-slate-600 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
                    <button
                      onClick={() => enrollCourse(course.id)}
                      className="w-full bg-gradient-to-r from-cyan-700 to-sky-700 hover:from-cyan-600 hover:to-sky-600 text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all"
                    >
                      Enroll Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
      )}

      {activeTab === 'daily-rankings' && (
        <div className="app-panel rounded-3xl p-6 md:p-8">
          <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            Daily Rankings
          </h2>
          <p className="text-slate-500 text-sm mb-6">Live ranking based on your course progress, accuracy, and activity streak.</p>

          {rankingRows.length === 0 ? (
            <p className="text-slate-500">Enroll in a course to join the rankings.</p>
          ) : (
            <div className="space-y-3">
              {rankingRows.map((row, idx) => (
                <div key={row.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 font-black text-sm grid place-items-center">#{idx + 1}</div>
                    <div>
                      <p className="font-bold text-slate-900 text-sm">{row.title}</p>
                      <p className="text-xs text-slate-500">{row.streak} day streak</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-amber-500 font-black text-sm">
                    <Star className="w-4 h-4" />
                    {row.xp} XP
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'my-results' && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setMyResultsType('admin')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                myResultsType === 'admin'
                  ? 'bg-cyan-700 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:border-cyan-400'
              }`}
            >
              Assigned Course Results
            </button>
            <button
              type="button"
              onClick={() => setMyResultsType('self')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                myResultsType === 'self'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:border-emerald-400'
              }`}
            >
              Self Study Results
            </button>
          </div>

          {myResultsType === 'admin' && (
          <div className="app-panel rounded-3xl p-6 md:p-8">
            <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-teal-700" />
              Assigned Course Results
            </h2>
            <p className="text-slate-500 text-sm mb-6">Live performance updates from your assigned courses.</p>

            {resultsLoading ? (
              <div className="py-10 text-center text-slate-500 font-semibold flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
                Loading your results...
              </div>
            ) : adminResultRows.length === 0 ? (
              <p className="text-slate-500">No results for assigned courses yet.</p>
            ) : (
              <div className="space-y-3">
                {adminResultRows.map((row) => (
                  <div key={row.id} className="bg-white border border-slate-200 rounded-xl px-4 py-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{row.title}</p>
                        <p className="text-xs text-slate-500">
                          Score {row.totalScore}/{row.totalQuestions || 0} | Pages {row.completedPages}/{row.totalPages || 0}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-teal-700">{row.completionPercent}%</p>
                        <p className={`text-[11px] font-bold uppercase ${row.isCompleted ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {row.isCompleted ? 'Course Completed' : 'In Progress'}
                        </p>
                      </div>
                    </div>
                    {row.feedback && (
                      <p className="text-xs text-slate-600 mt-2 border-t border-slate-100 pt-2">AI Coach: {row.feedback}</p>
                    )}
                    {row.aiAnalysis && (
                      <div className="mt-3 border-t border-slate-100 pt-3 space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-wider text-cyan-700">AI Performance Analysis</p>
                        <p className="text-xs text-slate-700">{row.aiAnalysis.performanceLabel}</p>
                        {row.aiAnalysis.weakAreas?.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {row.aiAnalysis.weakAreas.map((area, index) => (
                              <span key={`${row.id}-weak-${index}`} className="text-[11px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                                {area.topic} (-{area.lost}/{area.total})
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-slate-600">Suggestion: {row.aiAnalysis.suggestion}</p>
                      </div>
                    )}
                    {row.source === 'local' && (
                      <p className="text-[11px] text-amber-600 mt-2">Waiting to sync to server. Your local result is saved.</p>
                    )}
                    {row.isCompleted && (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleReattempt(row.courseId)}
                          className="px-3 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-[11px] font-black uppercase tracking-wider"
                        >
                          Reattempt Course
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {myResultsType === 'self' && (
          <div className="app-panel rounded-3xl p-6 md:p-8 border-emerald-100">
            <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
              <FileText className="w-6 h-6 text-emerald-700" />
              Self Uploaded Material Results
            </h2>
            <p className="text-slate-500 text-sm mb-6">Performance updates from your personal AI-generated materials.</p>

            {resultsLoading ? (
              <div className="py-10 text-center text-slate-500 font-semibold flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-700" />
                Loading your results...
              </div>
            ) : selfResultRows.length === 0 ? (
              <p className="text-slate-500">No results for self uploaded materials yet.</p>
            ) : (
              <div className="space-y-3">
                {selfResultRows.map((row) => (
                  <div key={row.id} className="bg-white border border-emerald-100 rounded-xl px-4 py-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{row.title}</p>
                        <p className="text-xs text-slate-500">
                          Score {row.totalScore}/{row.totalQuestions || 0} | Pages {row.completedPages}/{row.totalPages || 0}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-emerald-700">{row.completionPercent}%</p>
                        <p className={`text-[11px] font-bold uppercase ${row.isCompleted ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {row.isCompleted ? 'Completed' : 'In Progress'}
                        </p>
                      </div>
                    </div>
                    {row.feedback && (
                      <p className="text-xs text-slate-600 mt-2 border-t border-slate-100 pt-2">AI Coach: {row.feedback}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {activeTab === 'goals' && (
        <div className="app-panel rounded-[2rem] p-6 md:p-8 bg-gradient-to-b from-slate-50 to-white border border-slate-200 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-7">
            <div>
              <h2 className="text-2xl md:text-3xl font-black text-slate-900 flex items-center gap-2">
                <Target className="w-6 h-6 text-cyan-700" />
                Goals
              </h2>
              <p className="text-slate-600 text-sm mt-2 max-w-2xl">Create structured completion plans for each course and track progress with a clear daily execution target.</p>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] uppercase tracking-wider font-black text-slate-500">
              Planning Workspace
            </div>
          </div>

          <form onSubmit={handleCreateGoal} className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6 mb-7 space-y-5 shadow-sm">
            <div className="flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-cyan-700" />
              <p className="text-[11px] font-black uppercase tracking-wider text-cyan-700">Create New Goal</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Goal Title</label>
                <input
                  type="text"
                  value={goalForm.title}
                  onChange={(e) => setGoalForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="Optional: e.g. Complete React Basics this week"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Learning Material</label>
                <select
                  value={goalForm.courseId}
                  onChange={(e) => setGoalForm((prev) => ({ ...prev, courseId: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 text-sm"
                >
                  {goalItems.length === 0 && (
                    <option value="">No materials available</option>
                  )}
                  {courses.length > 0 && (
                    <optgroup label="Institution Learning Paths">
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>{course.title}</option>
                      ))}
                    </optgroup>
                  )}
                  {selfMaterials.length > 0 && (
                    <optgroup label="Personal Study Library">
                      {selfMaterials.map((material) => (
                        <option key={material.id} value={material.id}>{material.title}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p className="text-xs text-slate-500 pt-1">Select from institution learning paths or your personal study library.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-4 items-end">
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Target Days</label>
                <input
                  type="number"
                  min="1"
                  max={selectedGoalMaxDays}
                  value={goalForm.targetDays}
                  onChange={(e) => {
                    const nextValue = Number(e.target.value || 1);
                    const clamped = Math.min(selectedGoalMaxDays, Math.max(1, nextValue));
                    setGoalForm((prev) => ({ ...prev, targetDays: clamped }));
                    if (nextValue > selectedGoalMaxDays) {
                      setGoalFormNotice(`For this course, max allowed days is ${selectedGoalMaxDays}.`);
                    } else {
                      setGoalFormNotice('');
                    }
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 text-sm"
                />
              </div>
              <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-wider text-cyan-700">Daily Plan Preview</p>
                <p className="text-xs text-slate-700 mt-1">
                  Course size: {selectedGoalTotalPages} page(s). Max days: {selectedGoalMaxDays}. Suggested pace: {selectedGoalPagesPerDay} page(s) per day.
                </p>
                {goalFormNotice && (
                  <p className="text-xs font-semibold text-amber-700 mt-2">{goalFormNotice}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={!goalItems.length}
                className="h-[46px] px-5 rounded-xl bg-cyan-700 hover:bg-cyan-600 text-white font-black text-xs uppercase tracking-wider disabled:opacity-60"
              >
                Add Goal
              </button>
            </div>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-7">
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm">
              <p className="text-[11px] uppercase tracking-wider font-black text-slate-500">Enrolled Courses</p>
              <p className="text-3xl font-black text-slate-900 mt-1">{enrolledCourses.length}</p>
            </div>
            <div className="bg-white border border-emerald-200 rounded-2xl px-5 py-4 shadow-sm">
              <p className="text-[11px] uppercase tracking-wider font-black text-emerald-700">Completed</p>
              <p className="text-3xl font-black text-emerald-700 mt-1">{completedEnrolledCourses.length}</p>
            </div>
            <div className="bg-white border border-cyan-200 rounded-2xl px-5 py-4 shadow-sm">
              <p className="text-[11px] uppercase tracking-wider font-black text-cyan-700">In Progress</p>
              <p className="text-3xl font-black text-cyan-700 mt-1">{inProgressEnrolledCourses.length}</p>
            </div>
          </div>

          {goals.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center">
              <p className="text-sm font-semibold text-slate-600">No goals created yet. Create your first structured plan above.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {goals.map((goal) => {
                if (!goal?.courseId) return null;

                const progress = getCourseProgress(goal.courseId);
                const isCompleted = progress.isCompleted;
                const goalItem = goalItems.find((item) => item.id === goal.courseId);
                const courseTitle = goalItem?.title || 'Course not found';
                const materialLabel = goalItem?.kind === 'self' ? 'Self Study' : 'Assigned Course';
                const targetDays = Math.max(1, Number(goal?.targetDays || 1));
                const plannedPagesPerDay = Number(goal?.pagesPerDay || getPagesPerDayTarget(progress.totalPages, targetDays));
                const planRows = Array.isArray(goal?.dailyPlan) && goal.dailyPlan.length
                  ? goal.dailyPlan
                  : buildDailyPagePlan(progress.totalPages, targetDays);
                const planPreview = planRows.slice(0, 4);

                const dueDate = goal?.dueDate ? new Date(goal.dueDate) : null;
                const hasValidDueDate = dueDate && !Number.isNaN(dueDate.getTime());
                const now = new Date();
                const msPerDay = 1000 * 60 * 60 * 24;
                const daysLeft = hasValidDueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / msPerDay) : null;
                const isOverdue = !isCompleted && hasValidDueDate && daysLeft < 0;
                const deadlineLabel = hasValidDueDate
                  ? isCompleted
                    ? 'Completed'
                    : isOverdue
                    ? `${Math.abs(daysLeft)} day(s) overdue`
                    : `${daysLeft} day(s) left`
                  : 'No deadline';

                return (
                  <div key={goal.id} className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6 shadow-sm">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
                      <div>
                        <p className="font-black text-slate-900 text-base md:text-lg">{goal.title}</p>
                        <p className="text-sm text-slate-500 mt-1">{courseTitle}</p>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-700 mt-2">{materialLabel}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-slate-600">
                          <p>Pages completed: {progress.completedPages}/{progress.totalPages}</p>
                          <p>Target: {targetDays} day(s)</p>
                          <p>Pace: {plannedPagesPerDay} page(s)/day</p>
                        </div>
                        <p className={`text-xs font-semibold mt-2 ${isOverdue ? 'text-rose-600' : 'text-slate-500'}`}>{deadlineLabel}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full ${isCompleted ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : isOverdue ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                          {isCompleted ? 'Completed' : isOverdue ? 'Overdue' : 'In Progress'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteGoal(goal.id)}
                          className="p-2 rounded-lg border border-slate-300 text-slate-600 hover:text-rose-600 hover:border-rose-300"
                          aria-label="Delete goal"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-1">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Progress</p>
                        <p className="text-xs font-black text-cyan-700">{progress.percent}%</p>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-2.5 rounded-full transition-all ${isCompleted ? 'bg-emerald-500' : 'bg-cyan-600'}`}
                          style={{ width: `${Math.max(4, progress.percent)}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-5 p-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                        <p className="text-[11px] font-black uppercase tracking-wider text-cyan-700">Daily Plan Review</p>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full">
                          {planRows.length} scheduled days
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5">
                        {planPreview.map((plan) => (
                          <div
                            key={`${goal.id}-day-${plan.day}`}
                            className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 flex items-start justify-between gap-3"
                          >
                            <div>
                              <p className="text-xs font-black text-slate-900">Day {plan.day}</p>
                              <p className="text-xs text-slate-600 mt-1">{plan.label}</p>
                            </div>
                            <span className={`shrink-0 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${plan.pages > 0 ? 'bg-cyan-100 text-cyan-700 border border-cyan-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                              {plan.pages > 0 ? `${plan.pages} page${plan.pages > 1 ? 's' : ''}` : 'Buffer'}
                            </span>
                          </div>
                        ))}
                      </div>

                      {planRows.length > planPreview.length && (
                        <p className="text-[11px] text-slate-500 mt-3">+{planRows.length - planPreview.length} additional day(s) hidden for quick view</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'help' && (
        <div className="app-panel rounded-3xl p-6 md:p-8">
          <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-teal-700" />
            Personal AI Study Library
          </h2>
          <p className="text-slate-500 text-sm mb-6">Create private AI-powered study material and manage it from a focused workspace.</p>

          <div className="mb-8 bg-white border border-slate-200 rounded-2xl p-4 md:p-5">
            <p className="text-[11px] font-black uppercase tracking-wider text-emerald-700 mb-3">Self Study Upload (Private)</p>
            <form className="space-y-3" onSubmit={handleUploadSelfMaterial}>
              <input
                type="text"
                value={selfMaterialTitle}
                onChange={(e) => setSelfMaterialTitle(e.target.value)}
                placeholder="Material title"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 text-sm"
              />
              <input
                id="self-study-upload-input"
                type="file"
                accept="application/pdf,.docx,.txt"
                onChange={(e) => setSelfMaterialFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label
                  htmlFor="self-study-upload-input"
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-black uppercase tracking-wider cursor-pointer"
                >
                  Choose File
                </label>
                <p className="text-xs text-slate-500 truncate">
                  {selfMaterialFile?.name || 'No file selected'}
                </p>
              </div>
              <button
                type="submit"
                disabled={isSelfMaterialUploading}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-60 inline-flex items-center gap-2"
              >
                {isSelfMaterialUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {isSelfMaterialUploading ? 'Processing Material...' : 'Upload & Generate'}
              </button>
            </form>
            {selfMaterialProgress && (
              <p className="text-xs text-slate-600 mt-3">{selfMaterialProgress}</p>
            )}
            {selfMaterialNotice && (
              <p className={`text-xs mt-2 font-semibold ${selfMaterialNotice.toLowerCase().includes('success') ? 'text-emerald-700' : 'text-rose-600'}`}>
                {selfMaterialNotice}
              </p>
            )}
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-black text-slate-900 mb-3">My Self Study Materials</h3>
            {isSelfMaterialsLoading ? (
              <div className="text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-700" /> Loading materials...
              </div>
            ) : selfMaterials.length === 0 ? (
              <p className="text-sm text-slate-500">No self-study material uploaded yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selfMaterials.map((material) => (
                  <div
                    key={material.id}
                    onClick={() => {
                      setMyCoursesType('self');
                      setSelectedSelfMaterialId(material.id);
                      navigate('/student?tab=my-courses');
                    }}
                    className="bg-white border border-emerald-200 rounded-xl p-4 hover:border-emerald-400 transition-all cursor-pointer"
                  >
                    <p className="font-black text-sm text-slate-900 line-clamp-2">{material.title}</p>
                    <p className="text-xs text-slate-500 mt-1">{formatDateTime(material.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gradient-to-r from-slate-50 to-cyan-50 border border-cyan-100 rounded-2xl p-4 md:p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-cyan-700">Recommended Workflow</p>
                <p className="text-sm text-slate-700 mt-1">Upload material here, then continue learning from <span className="font-black text-slate-900">My Courses → Self Study</span> and track performance in <span className="font-black text-slate-900">My Results → Self Study</span>.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMyCoursesType('self');
                  navigate('/student?tab=my-courses');
                }}
                className="px-4 py-2.5 rounded-xl bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-black uppercase tracking-wider"
              >
                Go To Self Study
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'profile' && (
        <div className="app-panel rounded-3xl p-6 md:p-8">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <UserCircle2 className="w-6 h-6 text-cyan-700" />
              Profile
            </h2>
            {!isEditingProfile && (
              <button
                type="button"
                onClick={handleStartProfileEdit}
                className="px-3 py-1.5 bg-white border border-slate-300 hover:border-teal-500 text-slate-700 hover:text-teal-700 rounded-lg text-[11px] font-black uppercase tracking-wider"
              >
                Edit
              </button>
            )}
          </div>
          <p className="text-slate-500 text-sm mb-6">Keep your required account details updated.</p>

          <form onSubmit={handleSaveProfile} className="space-y-4 mb-5">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <label className="text-xs uppercase tracking-wider font-black text-slate-500">Full Name *</label>
              {isEditingProfile ? (
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  required
                  placeholder="Enter your full name"
                  className="mt-2 w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm"
                />
              ) : (
                <p className="mt-2 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-semibold">
                  {profileName || 'Not set'}
                </p>
              )}
            </div>

            {isEditingProfile && (
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="px-5 py-3 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white font-black text-xs rounded-xl uppercase tracking-widest transition-all flex items-center gap-2"
                >
                  {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleCancelProfileEdit}
                  disabled={isSavingProfile}
                  className="px-5 py-3 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 font-black text-xs rounded-xl uppercase tracking-widest transition-all"
                >
                  Cancel
                </button>
              </div>
            )}

            {profileNotice && (
              <p className={`text-xs font-bold ${profileNotice.toLowerCase().includes('success') ? 'text-teal-700' : 'text-rose-600'}`}>
                {profileNotice}
              </p>
            )}
          </form>

          <div className="space-y-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
              <Mail className="w-5 h-5 text-slate-500 mt-0.5" />
              <div>
                <p className="text-xs uppercase tracking-wider font-black text-slate-500">Email</p>
                <p className="text-sm font-bold text-slate-900">{user?.email || 'Not available'}</p>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
              <BadgeCheck className="w-5 h-5 text-teal-700 mt-0.5" />
              <div>
                <p className="text-xs uppercase tracking-wider font-black text-slate-500">Role</p>
                <p className="text-sm font-bold text-slate-900">{role === 'admin' ? 'Admin' : 'Student'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {(activeTab !== 'daily-rankings' && activeTab !== 'my-results' && activeTab !== 'goals' && activeTab !== 'help' && activeTab !== 'profile' && filteredCourses.length === 0) && (
          <div className="text-center py-20">
            <p className="text-slate-500 text-lg font-semibold">No courses found</p>
          </div>
      )}
    </div>
  );
}
