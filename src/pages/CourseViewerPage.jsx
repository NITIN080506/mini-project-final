import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const parseCourseMaterial = (materialJson) => {
  if (!materialJson) return { pages: [] };
  try {
    const parsed = JSON.parse(materialJson);
    return parsed && parsed.pages ? parsed : { pages: [] };
  } catch (e) {
    return { pages: [] };
  }
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
    fillBlank: {
      prompt: blankPrompt,
      answer: blankableWord,
    },
  };
};

const isAssessmentEvent = (message) => message?.metadata?.type === 'assessment_result';

export default function CourseViewerPage() {
  const navigate = useNavigate();
  const { courseId } = useParams();
  const { supabase, user, courses } = useAuth();

  const course = courses.find(c => c.id === courseId);

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

    const remaining = [];
    for (const payload of queued) {
      const { error } = await supabase
        .from(ASSESSMENT_TABLE)
        .upsert([payload], { onConflict: 'user_id,course_id' });
      if (error) remaining.push(payload);
    }

    writePendingAssessments(remaining);
  };

  const totalPages = materialDoc.pages.length || 1;
  const activePage = materialDoc.pages[pageIndex] || { pageNumber: 1, title: 'Page 1', content: 'No content.', quiz: { question: '', options: [], answer: '' }, fillBlank: { prompt: '', answer: '' } };
  const activeAnswers = answersByPage[pageIndex] || { quizChoice: '', fillBlankInput: '' };
  const storageKey = `course-results-${courseId}-${user.id}`;

  const totalQuestionsAnswered = Object.values(resultsByPage).reduce((acc, item) => acc + (item?.total || 0), 0);
  const totalScore = Object.values(resultsByPage).reduce((acc, item) => acc + (item?.score || 0), 0);

  if (!course) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm page-enter">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-slate-900 font-semibold text-lg mb-4">Course not found</p>
          <button onClick={() => navigate('/student')} className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-lg transition-all">
            Back to Courses
          </button>
        </div>
      </div>
    );
  }

  // Persist tab state
  useEffect(() => {
    localStorage.setItem(`courseTab-${courseId}`, tab);
  }, [tab, courseId]);

  useEffect(() => {
    setMaterialDoc(parseCourseMaterial(course.material));
    setPageIndex(0);
    setAnswersByPage({});
    setAssessmentMessage(null);
  }, [course.material, course.id]);

  useEffect(() => {
    setAssessmentMessage(null);
  }, [pageIndex]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setResultsByPage(parsed);
      }
    } catch (error) {
      setResultsByPage({});
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(resultsByPage));
  }, [resultsByPage, storageKey]);

  useEffect(() => {
    fetchMessages();
    const sub = supabase.channel('chat_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'neural_messages', filter: `course_id=eq.${courseId}` }, (payload) => {
        if (payload.new.user_id === user.id && !isAssessmentEvent(payload.new)) {
          setMessages(prev => [...prev, payload.new]);
        }
      }).subscribe();
    return () => supabase.removeChannel(sub);
  }, [courseId, supabase, user.id]);

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

  const fetchMessages = async () => {
    const { data } = await supabase.from('neural_messages').select('*').eq('course_id', courseId).eq('user_id', user.id).order('created_at', { ascending: true });
    if (data) setMessages(data.filter(message => !isAssessmentEvent(message)));
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput('');

    const userMessageObj = {
      user_id: user.id,
      course_id: courseId,
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
        course_id: courseId,
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
        course_id: courseId,
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
      if (url.includes('v=')) return url.split('v=')[1]?.split('&')[0];
      if (url.includes('youtu.be/')) return url.split('/').pop();
    } catch (e) {}
    return 'dQw4w9WgXcQ';
  };

  const setQuizChoice = (value) => {
    setAnswersByPage(prev => ({
      ...prev,
      [pageIndex]: {
        ...prev[pageIndex],
        quizChoice: value,
      },
    }));
  };

  const setFillBlankInput = (value) => {
    setAnswersByPage(prev => ({
      ...prev,
      [pageIndex]: {
        ...prev[pageIndex],
        fillBlankInput: value,
      },
    }));
  };

  const submitAssessment = async () => {
    if (!activeAnswers.quizChoice) {
      setAssessmentMessage({
        type: 'error',
        text: 'Please select a quiz option before submitting.',
      });
      return;
    }

    if (!(activeAnswers.fillBlankInput || '').trim()) {
      setAssessmentMessage({
        type: 'error',
        text: 'Please fill in the blank before submitting.',
      });
      return;
    }

    const quizCorrect = (activeAnswers.quizChoice || '').trim().toLowerCase() === (activePage.quiz.answer || '').trim().toLowerCase();
    const fillCorrect = (activeAnswers.fillBlankInput || '').trim().toLowerCase() === (activePage.fillBlank.answer || '').trim().toLowerCase();
    const score = Number(quizCorrect) + Number(fillCorrect);
    const attemptedAt = new Date().toISOString();

    setIsSavingAssessment(true);

    // Try syncing previously failed submissions before creating a new one.
    await flushPendingAssessments();

    // Update local state immediately for UI
    const nextResults = { ...resultsByPage, [pageIndex]: { score, total: 2, attemptedAt } };
    setResultsByPage(nextResults);

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

    let aiFeedback = '';
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

      if (feedbackResponse.ok) {
        const feedbackData = await feedbackResponse.json();
        aiFeedback = feedbackData?.choices?.[0]?.message?.content?.trim() || '';
      }
    } catch (err) {
      aiFeedback = '';
    }

    try {
      // Save course-level aggregate (one record per course, no per-page tracking)
      const payload = {
        user_id: user.id,
        course_id: courseId,
        course_title: course.title,
        total_score: updatedTotalScore,
        total_questions: updatedTotalQuestions,
        completion_percent: completionPercent,
        course_completed: isCourseCompleted,
        ai_feedback: aiFeedback,
        attempted_at: attemptedAt,
      };

      let lastInsertError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error: insertError } = await supabase
          .from(ASSESSMENT_TABLE)
          .upsert([payload], { onConflict: 'user_id,course_id' });
        if (!insertError) {
          lastInsertError = null;
          break;
        }
        lastInsertError = insertError;
      }

      if (lastInsertError) throw lastInsertError;

      setAssessmentMessage({
        type: 'success',
        text: aiFeedback ? `Assessment submitted. Score: ${score}/2. ${aiFeedback}` : `Assessment submitted. Score: ${score}/2`,
      });
    } catch (err) {
      console.error('Failed to save assessment event', err);
      const pendingPayload = {
        user_id: user.id,
        course_id: courseId,
        course_title: course.title,
        total_score: updatedTotalScore,
        total_questions: updatedTotalQuestions,
        completion_percent: completionPercent,
        course_completed: isCourseCompleted,
        ai_feedback: aiFeedback,
        attempted_at: attemptedAt,
      };
      queuePendingAssessment(pendingPayload);
      setAssessmentMessage({
        type: 'success',
        text: 'Assessment saved locally. It will auto-sync when connection is stable.',
      });
    } finally {
      setIsSavingAssessment(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-5 md:p-8 pb-20 page-enter">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <button onClick={() => navigate('/student')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-all font-medium text-sm">
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back to Dashboard
          </button>
          <div className="flex items-center gap-2 text-teal-700 bg-teal-50 px-4 py-2 rounded-full text-xs font-semibold">
            <Activity className="w-4 h-4" /> AI Help Active
          </div>
        </div>

        {/* Course Title */}
        <h1 className="text-2xl md:text-3xl font-bold mb-8 text-slate-900">{course.title}</h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-8 space-y-6">
            {/* Video/Material Tabs */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              {/* Tab Buttons */}
              <div className="flex border-b border-slate-200">
                <button
                  onClick={() => setTab('video')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all ${tab === 'video' ? 'bg-slate-50 text-slate-900 border-b-2 border-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Video className="w-4 h-4" />
                  Video
                </button>
                <button
                  onClick={() => setTab('material')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all ${tab === 'material' ? 'bg-slate-50 text-slate-900 border-b-2 border-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <BookOpen className="w-4 h-4" />
                  Materials
                </button>
              </div>

              {/* Content */}
              {tab === 'video' && (
                <div className="aspect-video bg-black flex items-center justify-center">
                  {course.video_type === 'link' ? (
                    <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${getVideoId(course.video_url)}`} frameBorder="0" allowFullScreen></iframe>
                  ) : (
                    <video controls className="w-full h-full"><source src={course.video_url} type="video/mp4" /></video>
                  )}
                </div>
              )}

              {tab === 'material' && (
                <div className="p-6 md:p-8 space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 pb-4">
                    <h2 className="text-lg font-semibold text-slate-900">Study Materials</h2>
                    <span className="text-sm text-slate-500 font-medium">Page {pageIndex + 1} of {totalPages}</span>
                  </div>

                  {/* Page Navigation */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
                      disabled={pageIndex === 0}
                      className="px-4 py-2 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50 rounded-lg text-slate-700 text-sm font-medium transition-all"
                    >
                      ← Previous
                    </button>
                    <button
                      onClick={() => setPageIndex(Math.min(totalPages - 1, pageIndex + 1))}
                      disabled={pageIndex === totalPages - 1}
                      className="px-4 py-2 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50 rounded-lg text-slate-700 text-sm font-medium transition-all"
                    >
                      Next →
                    </button>
                  </div>

                  {/* Page Content */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-3">{activePage.title}</h3>
                    <p className="text-slate-600 whitespace-pre-wrap mb-5 text-sm leading-relaxed">{activePage.content}</p>
                    
                    {/* Summary */}
                    <div className="p-4 rounded-lg border border-indigo-100 bg-indigo-50 mb-6">
                      <p className="text-xs font-semibold text-indigo-600 mb-1">AI Summary</p>
                      <p className="text-slate-700 text-sm">{activePage.summary || 'No summary available.'}</p>
                    </div>

                    {/* Quiz */}
                    <div className="space-y-5">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">Quiz Question</h4>
                        <p className="text-slate-700 text-sm mb-3">{activePage.quiz.question}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {activePage.quiz.options.map(option => (
                            <button
                              key={option}
                              onClick={() => setQuizChoice(option)}
                              className={`text-left px-4 py-3 rounded-lg border text-sm font-medium transition-all ${activeAnswers.quizChoice === option ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Fill Blank */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">Fill in the Blank</h4>
                        <p className="text-slate-600 text-sm mb-3">{activePage.fillBlank.prompt}</p>
                        <input
                          type="text"
                          value={activeAnswers.fillBlankInput || ''}
                          onChange={(e) => setFillBlankInput(e.target.value)}
                          placeholder="Type your answer..."
                          className="w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 text-sm"
                        />
                      </div>

                      <button
                        onClick={submitAssessment}
                        disabled={isSavingAssessment}
                        className="w-full mt-4 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-all"
                      >
                        {isSavingAssessment ? 'Saving...' : 'Submit Assessment'}
                      </button>

                      {assessmentMessage && (
                        <div className={`mt-3 px-4 py-3 rounded-lg border text-sm font-medium ${assessmentMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                          {assessmentMessage.text}
                        </div>
                      )}

                      {resultsByPage[pageIndex] && (
                        <div className="mt-3 space-y-3">
                          <div className="px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium">
                            Your score for this page: {resultsByPage[pageIndex].score}/2
                          </div>

                          {pageIndex < totalPages - 1 ? (
                            <button
                              type="button"
                              onClick={() => setPageIndex(Math.min(totalPages - 1, pageIndex + 1))}
                              className="w-full px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-all"
                            >
                              Continue to Next Page
                            </button>
                          ) : (
                            <div className="px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-medium">
                              You've completed all page assignments.
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

          {/* Help Bot Sidebar */}
          <div className="lg:col-span-4">
            <div className="bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden shadow-sm h-[600px] sticky top-8">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-teal-600" />
                  <h4 className="font-semibold text-slate-900 text-sm">AI Help</h4>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
                <div className="bg-teal-50 border border-teal-100 p-4 rounded-lg text-sm text-teal-700">
                  Hello! I can help answer questions about {course.title}.
                </div>
                {messages.map((m, i) => (
                  <div key={i} className={`flex flex-col ${m.is_ai ? 'items-start' : 'items-end'}`}>
                    <div className={`max-w-[85%] p-3 rounded-lg text-sm ${m.is_ai ? 'bg-slate-100 text-slate-700 rounded-tl-sm' : 'bg-teal-600 text-white rounded-tr-sm'}`}>{m.content}</div>
                  </div>
                ))}
                {isAiLoading && <div className="flex gap-1 p-2"><div className="w-2 h-2 bg-teal-600 rounded-full animate-bounce" /></div>}
              </div>

              <form onSubmit={sendMessage} className="p-4 border-t border-slate-100">
                <div className="relative">
                  <input type="text" placeholder="Ask a question..." value={input} onChange={(e) => setInput(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 transition-all pr-12" />
                  <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-teal-600 hover:text-teal-700"><MessageSquare className="w-5 h-5" /></button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
