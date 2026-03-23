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

    console.log(`Flushing ${queued.length} pending assessments to server...`);

    const remaining = [];
    for (const payload of queued) {
      let flushed = false;
      // Retry up to 3 times for each pending item
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { error } = await supabase
          .from(ASSESSMENT_TABLE)
          .upsert([payload], { onConflict: 'user_id,course_id' });
        if (!error) {
          flushed = true;
          console.log(`✓ Flushed pending assessment for course ${payload.course_id}`);
          break;
        }
        console.warn(`Attempt ${attempt + 1}/3 to flush failed:`, error);
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }
      if (!flushed) {
        remaining.push(payload);
      }
    }

    writePendingAssessments(remaining);
    if (remaining.length === 0) {
      console.log('✓ All pending assessments flushed successfully!');
    } else {
      console.warn(`⚠ ${remaining.length} assessments still pending after retries`);
    }
  };

  const totalPages = materialDoc.pages.length || 1;
  const activePage = materialDoc.pages[pageIndex] || { pageNumber: 1, title: 'Page 1', content: 'No content.', quiz: { question: '', options: [], answer: '' }, fillBlank: { prompt: '', answer: '' } };
  const activeAnswers = answersByPage[pageIndex] || { quizChoice: '', fillBlankInput: '' };
  const storageKey = `course-results-${courseId}-${user.id}`;

  const totalQuestionsAnswered = Object.values(resultsByPage).reduce((acc, item) => acc + (item?.total || 0), 0);
  const totalScore = Object.values(resultsByPage).reduce((acc, item) => acc + (item?.score || 0), 0);

  if (!course) {
    return (
      <div className="app-shell soft-grid min-h-screen flex items-center justify-center p-4">
        <div className="app-panel panel-strong rounded-3xl p-8 text-center page-enter">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <p className="text-slate-900 font-black text-lg mb-4">Course not found</p>
          <button onClick={() => navigate('/student')} className="px-6 py-3 bg-teal-700 hover:bg-teal-600 text-white font-black rounded-xl transition-all hover:-translate-y-0.5">
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
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { error: insertError } = await supabase
          .from(ASSESSMENT_TABLE)
          .upsert([payload], { onConflict: 'user_id,course_id' });
        if (!insertError) {
          lastInsertError = null;
          console.log('✓ Assessment saved to server successfully');
          break;
        }
        lastInsertError = insertError;
        console.warn(`Attempt ${attempt + 1} failed:`, insertError);
        // Wait a bit before retry
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }

      if (lastInsertError) {
        console.error('All server sync attempts failed, queuing for later:', lastInsertError);
        throw lastInsertError;
      }

      // Also save completion flag to localStorage for immediate availability
      if (isCourseCompleted) {
        const completionFlagKey = `course-completed-${courseId}-${user.id}`;
        localStorage.setItem(completionFlagKey, JSON.stringify({
          completed: true,
          completedAt: new Date().toISOString(),
          completionPercent: completionPercent
        }));
      }

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
      
      // Also save completion flag even if DB fails
      if (isCourseCompleted) {
        const completionFlagKey = `course-completed-${courseId}-${user.id}`;
        localStorage.setItem(completionFlagKey, JSON.stringify({
          completed: true,
          completedAt: new Date().toISOString(),
          completionPercent: completionPercent
        }));
      }
      
      setAssessmentMessage({
        type: 'success',
        text: 'Assessment saved locally. It will auto-sync when connection is stable.',
      });
    } finally {
      setIsSavingAssessment(false);
    }
  };

  return (
    <div className="app-shell soft-grid min-h-screen p-6 md:p-8 pb-20 page-enter">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-12">
          <button onClick={() => navigate('/student')} className="flex items-center gap-4 text-slate-600 hover:text-slate-900 transition-all font-black uppercase text-[10px] tracking-widest group">
            <div className="p-3 rounded-2xl bg-white border border-slate-300 group-hover:bg-teal-700 group-hover:text-white transition-all"><ChevronRight className="w-5 h-5 rotate-180" /></div>
            Back
          </button>
          <div className="flex items-center gap-3 text-teal-700 bg-teal-50 px-6 py-2.5 rounded-full border border-teal-200 text-[10px] font-black uppercase tracking-widest">
            <Activity className="w-4 h-4" /> Help Bot Active
          </div>
        </div>

        {/* Course Title */}
        <h1 className="text-4xl md:text-5xl font-black italic mb-12 text-slate-900">{course.title}</h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Main Content */}
          <div className="lg:col-span-8 space-y-10">
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
                  {course.video_type === 'link' ? (
                    <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${getVideoId(course.video_url)}`} frameBorder="0" allowFullScreen></iframe>
                  ) : (
                    <video controls className="w-full h-full"><source src={course.video_url} type="video/mp4" /></video>
                  )}
                </div>
              )}

              {tab === 'material' && (
                <div className="p-10 lg:p-16 space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-6">
                    <h2 className="text-3xl md:text-4xl font-black italic uppercase text-slate-900">Study Materials</h2>
                    <div className="text-[10px] uppercase tracking-widest text-slate-500 font-black">Page {pageIndex + 1} / {totalPages}</div>
                  </div>

                  {/* Page Navigation */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
                      disabled={pageIndex === 0}
                      className="px-4 py-2 bg-white border border-slate-300 hover:border-teal-400 disabled:opacity-50 rounded-xl text-slate-700 text-xs font-black transition-all"
                    >
                      ← Previous
                    </button>
                    <button
                      onClick={() => setPageIndex(Math.min(totalPages - 1, pageIndex + 1))}
                      disabled={pageIndex === totalPages - 1}
                      className="px-4 py-2 bg-white border border-slate-300 hover:border-teal-400 disabled:opacity-50 rounded-xl text-slate-700 text-xs font-black transition-all"
                    >
                      Next →
                    </button>
                  </div>

                  {/* Page Content */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-8">
                    <h3 className="text-xl font-black text-slate-900 mb-4">{activePage.title}</h3>
                    <p className="text-slate-700 whitespace-pre-wrap mb-6">{activePage.content}</p>
                    
                    {/* Summary */}
                    <div className="p-4 rounded-xl border border-cyan-200 bg-cyan-50 mb-6">
                      <p className="text-[10px] uppercase tracking-widest font-black text-cyan-700 mb-2">AI Summary</p>
                      <p className="text-slate-700 text-sm">{activePage.summary || 'No summary available.'}</p>
                    </div>

                    {/* Quiz */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-black text-teal-700 mb-3 uppercase">Quiz Question</h4>
                        <p className="text-slate-800 mb-4">{activePage.quiz.question}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {activePage.quiz.options.map(option => (
                            <button
                              key={option}
                              onClick={() => setQuizChoice(option)}
                              className={`text-left px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${activeAnswers.quizChoice === option ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-300 bg-white text-slate-700 hover:border-teal-400'}`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Fill Blank */}
                      <div>
                        <h4 className="text-sm font-black text-cyan-700 mb-3 uppercase">Fill in the Blank</h4>
                        <p className="text-slate-700 mb-4">{activePage.fillBlank.prompt}</p>
                        <input
                          type="text"
                          value={activeAnswers.fillBlankInput || ''}
                          onChange={(e) => setFillBlankInput(e.target.value)}
                          placeholder="Type your answer..."
                          className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
                        />
                      </div>

                      <button
                        onClick={submitAssessment}
                        disabled={isSavingAssessment}
                        className="w-full mt-6 px-4 py-3 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-black text-xs rounded-xl uppercase tracking-wider"
                      >
                        {isSavingAssessment ? 'Saving Result...' : 'Submit Assessment'}
                      </button>

                      {assessmentMessage && (
                        <div className={`mt-3 px-4 py-3 rounded-xl border text-xs font-bold ${assessmentMessage.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
                          {assessmentMessage.text}
                        </div>
                      )}

                      {resultsByPage[pageIndex] && (
                        <div className="mt-3 space-y-3">
                          <div className="px-4 py-3 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300 text-xs font-bold">
                            Saved score for this page: {resultsByPage[pageIndex].score}/2
                          </div>

                          {pageIndex < totalPages - 1 ? (
                            <button
                              type="button"
                              onClick={() => setPageIndex(Math.min(totalPages - 1, pageIndex + 1))}
                              className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-black text-xs uppercase tracking-wider"
                            >
                              Next Page Assignment
                            </button>
                          ) : (
                            <div className="px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-bold">
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

          {/* Help Bot Sidebar */}
          <div className="lg:col-span-4">
            <div className="app-panel panel-strong rounded-[2rem] flex flex-col overflow-hidden shadow-2xl h-[600px] sticky top-8">
              <div className="p-6 border-b border-slate-200 bg-white/65 flex items-center justify-between">
                <div className="flex items-center gap-3"><HelpCircle className="w-6 h-6 text-teal-700" /><h4 className="font-black text-slate-900 text-[10px] uppercase tracking-widest">Help Bot</h4></div>
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              </div>

              <div className="h-[400px] overflow-y-auto p-6 space-y-6 custom-scrollbar text-[11px] leading-relaxed">
                <div className="bg-teal-50 border border-teal-200 p-5 rounded-3xl text-[11px] text-teal-700 font-medium italic">
                  "Hello! I'm ready to answer questions about {course.title}. Type below."
                </div>
                {messages.map((m, i) => (
                  <div key={i} className={`flex flex-col ${m.is_ai ? 'items-start' : 'items-end'}`}>
                    <div className={`max-w-[85%] p-5 rounded-3xl text-[11px] font-medium shadow-sm ${m.is_ai ? 'bg-slate-100 text-slate-700 rounded-tl-none border border-slate-200' : 'bg-teal-700 text-white rounded-tr-none'}`}>{m.content}</div>
                  </div>
                ))}
                {isAiLoading && <div className="flex gap-2 p-3"><div className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-bounce" /></div>}
              </div>

              <form onSubmit={sendMessage} className="p-6 border-t border-slate-200 bg-white/65">
                <div className="relative">
                  <input type="text" placeholder="Ask a question..." value={input} onChange={(e) => setInput(e.target.value)} className="w-full bg-white border border-slate-300 rounded-2xl px-6 py-5 text-xs outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-600 transition-all pr-14" />
                  <button type="submit" className="absolute right-3 top-3 p-3 text-teal-700 hover:text-teal-600"><MessageSquare className="w-5 h-5" /></button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
