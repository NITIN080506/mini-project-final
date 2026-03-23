import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { 
  BookOpen, 
  Video, 
  PlusCircle, 
  LogOut, 
  ShieldCheck, 
  GraduationCap, 
  Trash2, 
  Play, 
  FileText,
  ChevronRight,
  LayoutDashboard,
  BrainCircuit,
  MessageSquare,
  Zap,
  Activity,
  Award,
  Users,
  HelpCircle,
  Eye,
  Settings,
  X,
  CheckCircle,
  Clock,
  Upload,
  Link as LinkIcon,
  Loader2,
  AlertCircle
} from 'lucide-react';

const SUPABASE_URL = "https://rnjxhwhvfaccxhkjeosi.supabase.co"; 
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuanhod2h2ZmFjY3hoa2plb3NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjAzNTMsImV4cCI6MjA4ODQzNjM1M30.xSdsDrjnAOuKhWh9ACFqjlyCFaFwQpmuKtx2hTWg2jk"; 
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = import.meta.env.VITE_GROQ_MODEL || 'llama-3.3-70b-versatile';
const REQUIRE_LLM_SUCCESS = String(import.meta.env.VITE_REQUIRE_LLM_SUCCESS || 'false').toLowerCase() === 'true';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const splitTextIntoPages = (text, wordsPerPage = 220) => {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const words = normalized.split(' ');
  const pages = [];
  for (let index = 0; index < words.length; index += wordsPerPage) {
    pages.push(words.slice(index, index + wordsPerPage).join(' '));
  }
  return pages;
};

const uniqueWords = (text) => {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'have', 'will', 'about', 'which', 'when', 'where', 'what', 'there', 'their', 'been', 'were', 'them', 'than', 'then', 'also', 'into']);
  return [...new Set((text.toLowerCase().match(/[a-z]{5,}/g) || []).filter(word => !stopWords.has(word)))];
};

const createQuestionsForPage = (pageText) => {
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

const extractJsonObject = (rawText) => {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch (error) {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(rawText.slice(start, end + 1));
      } catch (parseError) {
        return null;
      }
    }
    return null;
  }
};

const normalizeLlmPagePayload = (llmPayload, pageText, pageNumber) => {
  const fallback = createQuestionsForPage(pageText);
  const options = Array.isArray(llmPayload?.quiz?.options)
    ? llmPayload.quiz.options.filter(Boolean).slice(0, 4)
    : [];

  while (options.length < 4) options.push(`Option ${options.length + 1}`);

  return {
    pageNumber,
    title: llmPayload?.title || `Page ${pageNumber}`,
    content: pageText,
    summary: llmPayload?.summary || fallback.summary,
    quiz: {
      question: llmPayload?.quiz?.question || fallback.quiz.question,
      options,
      answer: llmPayload?.quiz?.answer || options[0] || fallback.quiz.answer,
    },
    fillBlank: {
      prompt: llmPayload?.fillBlank?.prompt || fallback.fillBlank.prompt,
      answer: llmPayload?.fillBlank?.answer || fallback.fillBlank.answer,
    },
  };
};

const generatePageWithLLM = async (pageText, pageNumber, totalPages) => {
  if (!GROQ_API_KEY) throw new Error('Missing VITE_GROQ_API_KEY');

  const prompt = `You are an educational content generator. Analyze this course page and return STRICT JSON only with this shape:
{
  "title": "short page title",
  "summary": "3-4 sentence student-friendly summary",
  "quiz": {
    "question": "multiple choice question based only on this page",
    "options": ["A", "B", "C", "D"],
    "answer": "exactly one option text"
  },
  "fillBlank": {
    "prompt": "one sentence from this page with one blank as ________",
    "answer": "word that fits the blank"
  }
}

Rules:
- Keep options distinct and plausible.
- Keep answer present in options.
- No markdown, no explanation, JSON only.

Page ${pageNumber} of ${totalPages} content:
${pageText}`;

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
          role: 'user',
          content: `Return only valid JSON. ${prompt}`,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const outputText = data?.choices?.[0]?.message?.content || '';
  const parsed = extractJsonObject(outputText);
  if (!parsed) throw new Error('LLM returned invalid JSON payload.');

  return normalizeLlmPagePayload(parsed, pageText, pageNumber);
};

const buildStructuredMaterialWithLLM = async (text, sourceName = 'manual-input') => {
  const textPages = splitTextIntoPages(text);
  if (!textPages.length) throw new Error('Document has no text content to analyze.');

  const pages = [];
  for (let index = 0; index < textPages.length; index += 1) {
    const pageNumber = index + 1;
    const pageResult = await generatePageWithLLM(textPages[index], pageNumber, textPages.length);
    pages.push(pageResult);
  }

  return {
    type: 'structured-material-v1',
    sourceName,
    generatedAt: new Date().toISOString(),
    generation: 'groq',
    model: GROQ_MODEL,
    pages,
  };
};

const buildStructuredMaterialFromText = (text, sourceName = 'manual-input') => {
  const pages = splitTextIntoPages(text).map((pageContent, pageIndex) => {
    const questions = createQuestionsForPage(pageContent);
    return {
      pageNumber: pageIndex + 1,
      title: `Page ${pageIndex + 1}`,
      content: pageContent,
      ...questions,
    };
  });

  return {
    type: 'structured-material-v1',
    sourceName,
    generatedAt: new Date().toISOString(),
    pages,
  };
};

const parseCourseMaterial = (material) => {
  if (!material) return buildStructuredMaterialFromText('No study material added yet.');
  try {
    const parsed = JSON.parse(material);
    if (parsed?.type === 'structured-material-v1' && Array.isArray(parsed.pages)) return parsed;
  } catch (error) {
    // fallback to plain text
  }
  return buildStructuredMaterialFromText(material, 'legacy-text');
};

const extractTextFromDocument = async (file) => {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'txt') {
    return file.text();
  }

  if (extension === 'pdf') {
    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdf = await loadingTask.promise;
    let finalText = '';

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str || '').join(' ');
      finalText += `${pageText}\n\n`;
    }

    return finalText;
  }

  if (extension === 'docx' || extension === 'doc') {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  throw new Error('Unsupported file format. Upload TXT, PDF, DOC, or DOCX.');
};

export default function App() {
  const [supabase, setSupabase] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); 
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => {
    try {
      const saved = localStorage.getItem('appView');
      return saved || 'auth';
    } catch (e) {
      return 'auth';
    }
  });
  const [authMode, setAuthMode] = useState('login'); 
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(() => {
    try {
      const saved = localStorage.getItem('selectedCourse');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });
  const [error, setError] = useState(null);

  // Persist view state to localStorage
  useEffect(() => {
    localStorage.setItem('appView', view);
  }, [view]);

  // Persist selectedCourse to localStorage
  useEffect(() => {
    if (selectedCourse) {
      localStorage.setItem('selectedCourse', JSON.stringify(selectedCourse));
      setView('viewer');
    } else {
      localStorage.removeItem('selectedCourse');
    }
  }, [selectedCourse]);

  const getOAuthSetupMessage = (message) => {
    const raw = (message || '').toLowerCase();
    const providerDisabled =
      raw.includes('provider is not enabled') ||
      raw.includes('unsupported provider') ||
      raw.includes('oauth provider not enabled') ||
      raw.includes('invalid provider');

    if (!providerDisabled) return message || 'Google sign-in failed.';

    return `Google login is not enabled in Supabase. In Supabase Dashboard open Authentication > Providers > Google and enable it. Add Google OAuth Client ID/Secret, then set redirect URL to ${SUPABASE_URL}/auth/v1/callback and your app URL (${window.location.origin}) in Authentication > URL Configuration.`;
  };

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.async = true;
    script.onload = () => {
      if (window.supabase) {
        const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        setSupabase(client);
      }
    };
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) await handleUserSession(session.user);
        else setLoading(false);
      } catch (err) { setLoading(false); }
    };
    checkSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) handleUserSession(session.user);
      else { setUser(null); setRole(null); setView('auth'); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const handleUserSession = async (u) => {
    setUser(u);
    try {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', u.id).single();
      if (profile) {
        setRole(profile.role);
        // Check if we should restore to a previously opened course
        const savedView = localStorage.getItem('appView');
        const savedCourse = localStorage.getItem('selectedCourse');
        if (savedView === 'viewer' && savedCourse) {
          // Restore the viewer state - don't override it
          try {
            const courseData = JSON.parse(savedCourse);
            setSelectedCourse(courseData);
          } catch (e) {
            // If parsing fails, go to dashboard
            setView('dashboard');
          }
        } else {
          setView('dashboard');
        }
      } else {
        setView('auth');
        setAuthMode('complete-profile');
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => {
    if (!user || !role || !supabase) return;
    fetchCourses();
    fetchEnrollments();

    const channel = supabase.channel('global_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, fetchCourses)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, fetchEnrollments)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user, role, supabase]);

  const fetchCourses = async () => {
    const { data } = await supabase.from('courses').select('*, enrollments(count)').order('created_at', { ascending: false });
    if (data) setCourses(data);
  };

  const fetchEnrollments = async () => {
    if (role === 'admin') return;
    const { data } = await supabase.from('enrollments').select('course_id').eq('user_id', user.id);
    if (data) setEnrollments(data.map(e => e.course_id));
  };

  const handleRegister = async (email, password, selectedRole) => {
    setLoading(true); setError(null);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
      if (data.user) {
        await supabase.from('profiles').upsert([{ id: data.user.id, email, role: selectedRole }]);
        setRole(selectedRole); setUser(data.user); setView('dashboard');
      }
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const handleLogin = async (email, password) => {
    setLoading(true); setError(null);
    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: 'select_account' },
          skipBrowserRedirect: true,
        },
      });

      if (oauthError) throw oauthError;
      if (!data?.url) throw new Error('Unable to start Google sign-in.');

      const popupWidth = 520;
      const popupHeight = 680;
      const left = window.screenX + Math.max(0, (window.outerWidth - popupWidth) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - popupHeight) / 2);
      const popupFeatures = `width=${popupWidth},height=${popupHeight},left=${left},top=${top},resizable=yes,scrollbars=yes`;
      const popup = window.open(data.url, 'google-oauth', popupFeatures);

      if (!popup) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(getOAuthSetupMessage(err?.message));
    }
  };

  const handleCompleteProfile = async (fullName, selectedRole) => {
    setLoading(true);
    setError(null);
    try {
      if (!user?.id) throw new Error('No authenticated user found. Please sign in again.');

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert([{ id: user.id, email: user.email, role: selectedRole }]);

      if (profileError) throw profileError;

      await supabase.auth.updateUser({ data: { full_name: fullName } });
      setUser((prev) => ({ ...prev, user_metadata: { ...(prev?.user_metadata || {}), full_name: fullName } }));
      setRole(selectedRole);
      setView('dashboard');
      setAuthMode('login');
    } catch (err) {
      setError(err.message || 'Profile setup failed.');
    } finally {
      setLoading(false);
    }
  };

  const enrollCourse = async (courseId) => {
    try {
      await supabase.from('enrollments').insert([{ user_id: user.id, course_id: courseId }]);
      fetchEnrollments();
    } catch (err) { setError("Enrollment failed."); }
  };

  const addCourse = async (courseData) => {
    setError(null);
    try {
      const { error: insertError } = await supabase.from('courses').insert([{ ...courseData, created_by: user.id }]);
      if (insertError) throw insertError;
      await fetchCourses();
      return { success: true };
    } catch (err) { 
      const msg = err.message || "Something went wrong.";
      setError(`Database Error: ${msg}`);
      return { success: false, error: msg };
    }
  };

  const deleteCourse = async (course) => {
    try {
      if (course.video_type === 'upload' && course.video_url) {
        const filePath = course.video_url.split('/').pop();
        await supabase.storage.from('videos').remove([filePath]);
      }
      await supabase.from('courses').delete().eq('id', course.id);
      fetchCourses();
    } catch (err) { setError("Delete failed."); }
  };

  if (loading || !supabase) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-blue-500">
        <div className="flex flex-col items-center gap-4 p-8">
          <BrainCircuit className="w-16 h-16 animate-pulse text-blue-600" />
          <h2 className="text-xl font-bold tracking-widest uppercase italic">EduFlow</h2>
          <p className="text-xs font-mono text-slate-500 animate-pulse uppercase">Entering System...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30">
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setView('dashboard')}>
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-lg group-hover:rotate-12 transition-all duration-500 shadow-lg shadow-blue-500/20">
              <BrainCircuit className="text-white w-6 h-6" />
            </div>
            <span className="text-2xl font-black italic tracking-tighter">Edu<span className="text-blue-500">Flow</span></span>
          </div>
          {user && role && (
            <div className="flex items-center gap-6">
              <div className="hidden md:flex flex-col items-end">
                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${role === 'admin' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' : 'text-blue-400 bg-blue-500/10 border-blue-500/20'}`}>
                  {role === 'admin' ? 'Instructor' : 'Student'}
                </span>
                <span className="text-xs text-slate-400 font-mono mt-1">{user.email?.split('@')[0]}</span>
              </div>
              <button onClick={() => supabase.auth.signOut()} className="p-3 bg-slate-900 hover:bg-red-500/10 rounded-2xl border border-slate-800 transition-all text-slate-400 hover:text-red-500">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10 min-h-[calc(100vh-160px)]">
        {error && view !== 'dashboard' && (
          <div className="mb-8 p-5 bg-red-950/20 border border-red-500/30 rounded-2xl text-red-400 flex items-center gap-4 animate-in slide-in-from-top-4">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="flex-1 text-sm font-medium">{error}</p>
            <button onClick={() => setError(null)} className="text-[10px] font-black uppercase bg-red-500/10 px-3 py-1 rounded-lg">Close</button>
          </div>
        )}

        {view === 'auth' && (
          <AuthPage
            mode={authMode}
            setMode={setAuthMode}
            currentUser={user}
            onRegister={handleRegister}
            onLogin={handleLogin}
            onGoogleLogin={handleGoogleLogin}
            onCompleteProfile={handleCompleteProfile}
          />
        )}
        {user && role && (
          <div className="animate-in fade-in duration-1000">
            {view === 'dashboard' && role === 'admin' && <AdminDashboard supabase={supabase} courses={courses} onAdd={addCourse} onDelete={deleteCourse} error={error} clearError={() => setError(null)} />}
            {view === 'dashboard' && role === 'student' && <StudentDashboard courses={courses} enrolledIds={enrollments} onEnroll={enrollCourse} onSelect={(c) => { setSelectedCourse(c); setView('viewer'); }} />}
            {view === 'viewer' && selectedCourse && <CourseViewer course={selectedCourse} user={user} supabase={supabase} onBack={() => { setSelectedCourse(null); setView('dashboard'); localStorage.removeItem('selectedCourse'); localStorage.removeItem('appView'); }} />}
          </div>
        )}
      </main>
    </div>
  );
}

function AuthPage({ mode, setMode, currentUser, onRegister, onLogin, onGoogleLogin, onCompleteProfile }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [profileRole, setProfileRole] = useState('student');

  useEffect(() => {
    if (mode === 'complete-profile') {
      setFullName(currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || '');
      setProfileRole('student');
    }
  }, [mode, currentUser]);

  const isLogin = mode === 'login';
  const isGoogleOnboarding = mode === 'complete-profile';
  const isRoleRegistration = mode === 'register-student' || mode === 'register-admin';
  const isStudentRegistration = mode === 'register-student';
  const registerRole = isStudentRegistration ? 'student' : 'admin';
  const portalLabel = isGoogleOnboarding
    ? 'Complete Google Profile'
    : isLogin
      ? 'Secure Login Portal'
      : isStudentRegistration
        ? 'Student Registration Portal'
        : 'Instructor Registration Portal';
  const submitLabel = isGoogleOnboarding
    ? 'Continue to Dashboard'
    : isLogin
      ? 'Log In'
      : isStudentRegistration
        ? 'Create Student Account'
        : 'Create Instructor Account';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isGoogleOnboarding) {
      onCompleteProfile(fullName, profileRole);
      return;
    }
    if (isLogin) {
      onLogin(email, password);
      return;
    }
    onRegister(email, password, registerRole);
  };

  return (
    <div className="max-w-md mx-auto py-10">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-slate-900 border border-slate-800 mb-8 shadow-2xl relative">
          <ShieldCheck className="w-10 h-10 text-blue-500" />
        </div>
        <h1 className="text-5xl font-black text-white italic tracking-tighter uppercase mb-2">EduFlow</h1>
        <p className="text-slate-500 font-bold uppercase text-[9px] tracking-widest">{portalLabel}</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] shadow-2xl relative">
        {isRoleRegistration && (
          <div className="flex gap-3 mb-6">
            <button
              type="button"
              onClick={() => setMode('register-student')}
              className={`flex-1 p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${isStudentRegistration ? 'border-blue-600 bg-blue-600/10 text-blue-400' : 'border-slate-800 bg-slate-950 text-slate-600'}`}
            >
              <GraduationCap className="w-6 h-6" />
              <span className="text-[10px] font-black uppercase">Student</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('register-admin')}
              className={`flex-1 p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${!isStudentRegistration ? 'border-purple-600 bg-purple-600/10 text-purple-400' : 'border-slate-800 bg-slate-950 text-slate-600'}`}
            >
              <ShieldCheck className="w-6 h-6" />
              <span className="text-[10px] font-black uppercase tracking-widest">Instructor</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {isGoogleOnboarding ? (
            <>
              <input
                type="text"
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-blue-600/50 outline-none"
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              <input
                type="email"
                readOnly
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-slate-500"
                value={currentUser?.email || ''}
              />
              <div className="grid grid-cols-2 gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => setProfileRole('student')}
                  className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${profileRole === 'student' ? 'border-blue-600 bg-blue-600/10 text-blue-400' : 'border-slate-800 bg-slate-950 text-slate-600'}`}
                >
                  <GraduationCap className="w-6 h-6" />
                  <span className="text-[10px] font-black uppercase">Student</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProfileRole('admin')}
                  className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${profileRole === 'admin' ? 'border-purple-600 bg-purple-600/10 text-purple-400' : 'border-slate-800 bg-slate-950 text-slate-600'}`}
                >
                  <ShieldCheck className="w-6 h-6" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Instructor</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <input type="email" required className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-blue-600/50 outline-none" placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="password" required className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-blue-600/50 outline-none" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          )}

          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-2xl font-black text-white uppercase text-sm tracking-widest flex items-center justify-center gap-3">
            {submitLabel} <ChevronRight className="w-5 h-5" />
          </button>

          {isLogin && (
            <>
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800" /></div>
                <div className="relative flex justify-center text-[9px] font-black uppercase tracking-widest">
                  <span className="bg-slate-900 px-3 text-slate-500">Or</span>
                </div>
              </div>
              <button
                type="button"
                disabled={googleLoading}
                onClick={async () => {
                  setGoogleLoading(true);
                  try {
                    await onGoogleLogin();
                  } finally {
                    setGoogleLoading(false);
                  }
                }}
                className="w-full bg-white hover:bg-slate-200 disabled:opacity-60 py-5 rounded-2xl font-black text-slate-900 uppercase text-sm tracking-widest flex items-center justify-center gap-3"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                  <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4 6.9 2.4 2.7 6.6 2.7 11.7s4.2 9.3 9.3 9.3c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.7H12z" />
                  <path fill="#34A853" d="M2.7 11.7c0 1.6.4 3.1 1.2 4.4l3-2.3c-.2-.6-.3-1.3-.3-2.1s.1-1.4.3-2.1l-3-2.3c-.8 1.3-1.2 2.8-1.2 4.4z" />
                  <path fill="#FBBC05" d="M12 21c2.7 0 4.9-.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.7-1.8-5.5-4.1l-3 2.3C5.2 18.8 8.3 21 12 21z" />
                  <path fill="#4285F4" d="M20.8 10H12v4h8.4c.1-.6.2-1.2.2-1.9 0-.7-.1-1.4-.2-2.1z" />
                </svg>
                {googleLoading ? 'Opening Google...' : 'Continue with Google'}
              </button>
            </>
          )}
        </form>

        {isGoogleOnboarding ? (
          <button onClick={() => setMode('login')} className="w-full mt-10 text-blue-500 text-[10px] font-black uppercase tracking-widest">
            Back to Login
          </button>
        ) : isLogin ? (
          <div className="w-full mt-10 grid grid-cols-2 gap-4">
            <button onClick={() => setMode('register-student')} className="text-blue-500 text-[10px] font-black uppercase tracking-widest p-3 rounded-xl border border-slate-800 hover:border-blue-500/40 transition-all">
              Register as Student
            </button>
            <button onClick={() => setMode('register-admin')} className="text-purple-400 text-[10px] font-black uppercase tracking-widest p-3 rounded-xl border border-slate-800 hover:border-purple-500/40 transition-all">
              Register as Instructor
            </button>
          </div>
        ) : (
          <button onClick={() => setMode('login')} className="w-full mt-10 text-blue-500 text-[10px] font-black uppercase tracking-widest">
            Back to Login
          </button>
        )}
      </div>
    </div>
  );
}

function AdminDashboard({ supabase, courses, onAdd, onDelete, error, clearError }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newCourse, setNewCourse] = useState({ title: '', description: '', video_url: '', video_type: 'link', material: '' });
  const [isPreview, setIsPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isMaterialProcessing, setIsMaterialProcessing] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [materialSourceName, setMaterialSourceName] = useState('');
  const fileInputRef = useRef(null);
  const materialInputRef = useRef(null);

  const materialPreview = parseCourseMaterial(newCourse.material);

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!newCourse.title || !newCourse.video_url) {
      alert("Please add a title and a video.");
      return;
    }

    let finalCourse = { ...newCourse };
    try {
      const parsed = JSON.parse(newCourse.material || '{}');
      const hasStructuredMaterial = parsed?.type === 'structured-material-v1' && Array.isArray(parsed.pages);
      if (!hasStructuredMaterial && (newCourse.material || '').trim()) {
        try {
          const llmStructured = await buildStructuredMaterialWithLLM(newCourse.material, materialSourceName || 'manual-input');
          finalCourse.material = JSON.stringify(llmStructured);
        } catch (llmError) {
          if (REQUIRE_LLM_SUCCESS) {
            throw new Error(`LLM generation failed and fallback is disabled: ${llmError.message}`);
          }
          const fallbackStructured = buildStructuredMaterialFromText(newCourse.material, materialSourceName || 'manual-input');
          finalCourse.material = JSON.stringify(fallbackStructured);
          alert(`LLM generation failed, using fallback generator: ${llmError.message}`);
        }
      }
    } catch (error) {
      if ((newCourse.material || '').trim()) {
        try {
          const llmStructured = await buildStructuredMaterialWithLLM(newCourse.material, materialSourceName || 'manual-input');
          finalCourse.material = JSON.stringify(llmStructured);
        } catch (llmError) {
          if (REQUIRE_LLM_SUCCESS) {
            throw new Error(`LLM generation failed and fallback is disabled: ${llmError.message}`);
          }
          const fallbackStructured = buildStructuredMaterialFromText(newCourse.material, materialSourceName || 'manual-input');
          finalCourse.material = JSON.stringify(fallbackStructured);
          alert(`LLM generation failed, using fallback generator: ${llmError.message}`);
        }
      }
    }
    
    setIsUploading(true);
    const result = await onAdd(finalCourse);
    setIsUploading(false);

    if (result && result.success) {
      setNewCourse({ title: '', description: '', video_url: '', video_type: 'link', material: '' });
      setMaterialSourceName('');
      setShowAdd(false);
      setIsPreview(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Check file type
    if (!file.type.startsWith('video/')) {
      alert('Please select a valid video file.');
      return;
    }
    
    // Check file size (e.g., 100MB limit)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      alert('File size exceeds 100MB limit. Please choose a smaller video.');
      return;
    }
    
    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      
      console.log('Uploading file:', fileName, 'Size:', file.size);
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('videos')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });
      
      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }
      
      console.log('Upload successful:', uploadData);
      
      const { data } = supabase.storage.from('videos').getPublicUrl(fileName);
      
      if (!data || !data.publicUrl) {
        throw new Error('Failed to get public URL for uploaded video');
      }
      
      console.log('Public URL:', data.publicUrl);
      setNewCourse({ ...newCourse, video_url: data.publicUrl, video_type: 'upload' });
    } catch (err) {
      console.error('Upload failed:', err);
      alert("Upload failed: " + err.message + "\n\nPlease ensure:\n1. The 'videos' storage bucket exists in Supabase\n2. The bucket is set to public\n3. You have upload permissions");
    } finally {
      setIsUploading(false);
    }
  };

  const handleMaterialUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsMaterialProcessing(true);
    try {
      const extractedText = await extractTextFromDocument(file);
      if (!extractedText.trim()) throw new Error('No readable text found in this document.');

      let structured;
      try {
        structured = await buildStructuredMaterialWithLLM(extractedText, file.name);
      } catch (llmError) {
        if (REQUIRE_LLM_SUCCESS) {
          throw new Error(`LLM generation failed and fallback is disabled: ${llmError.message}`);
        }
        structured = buildStructuredMaterialFromText(extractedText, file.name);
        alert(`LLM generation failed, using fallback generator: ${llmError.message}`);
      }

      setNewCourse(prev => ({ ...prev, material: JSON.stringify(structured) }));
      setMaterialSourceName(file.name);
    } catch (err) {
      alert(`Material processing failed: ${err.message}`);
    } finally {
      setIsMaterialProcessing(false);
      e.target.value = '';
    }
  };

  const generateAISummary = async () => {
    if (!newCourse.title.trim()) {
      alert('Please enter a course title first.');
      return;
    }
    
    if (!GROQ_API_KEY) {
      alert('Groq API key is not configured. Please add VITE_GROQ_API_KEY to your .env file.');
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const prompt = `Generate a concise, engaging 2-3 sentence course description for a course titled: "${newCourse.title}". The description should be professional, informative, and appealing to students. Return only the description text, no additional formatting or explanation.`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 150,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI request failed (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const summary = data?.choices?.[0]?.message?.content?.trim() || '';
      
      if (summary) {
        setNewCourse({ ...newCourse, description: summary });
      } else {
        throw new Error('No summary generated');
      }
    } catch (err) {
      alert(`AI summary generation failed: ${err.message}`);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const getVideoId = (url) => { try { if (url.includes('v=')) return url.split('v=')[1]?.split('&')[0]; if (url.includes('youtu.be/')) return url.split('/').pop(); } catch (e) {} return null; };

  return (
    <div className="space-y-12">
      <div className="bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-8">
        <div>
          <h2 className="text-4xl font-black tracking-tighter text-white italic uppercase tracking-tighter">Instructor Hub</h2>
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Manage your courses</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="bg-indigo-600 hover:bg-indigo-500 px-10 py-5 rounded-2xl font-black text-white text-xs tracking-widest uppercase shadow-xl">
          <PlusCircle className="w-5 h-5 inline mr-2" /> Add Course
        </button>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col animate-in fade-in duration-300">
          <div className="h-20 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-8 backdrop-blur-md">
            <div className="flex items-center gap-4">
              <button onClick={() => { setShowAdd(false); clearError(); }} className="p-2 hover:bg-slate-800 rounded-xl transition-all text-slate-400"><X className="w-6 h-6" /></button>
              <h3 className="text-xl font-black italic">COURSE BUILDER</h3>
            </div>
            <div className="flex items-center gap-4">
               <button onClick={() => setIsPreview(!isPreview)} className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black text-[10px] uppercase border transition-all ${isPreview ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-800 text-slate-400'}`}>
                {isPreview ? <Settings className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {isPreview ? 'Back to Editor' : 'Live Preview'}
              </button>
              <button onClick={handlePublish} disabled={isUploading} className="bg-green-600 hover:bg-green-500 disabled:opacity-50 px-10 py-3 rounded-xl font-black text-[10px] uppercase text-white shadow-lg">
                {isUploading ? 'Publishing...' : 'Publish Now'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex">
            <div className={`flex-1 overflow-y-auto p-12 custom-scrollbar bg-slate-950 transition-all ${isPreview ? 'hidden lg:block lg:opacity-30' : 'block'}`}>
              <div className="max-w-3xl mx-auto space-y-12">
                {error && (
                  <div className="p-5 bg-red-950/20 border border-red-500/30 rounded-2xl text-red-400 flex items-center gap-4">
                    <AlertCircle className="w-6 h-6 flex-shrink-0" />
                    <p className="flex-1 text-sm font-medium"><b>Failed to Save:</b> {error}</p>
                    <button onClick={clearError} className="text-[10px] font-black uppercase">Dismiss</button>
                  </div>
                )}

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-blue-500 uppercase font-black text-[10px] tracking-widest"><Activity className="w-4 h-4" /> Course Name</div>
                  <input placeholder="Course Title..." className="w-full bg-transparent border-b-2 border-slate-800 py-4 text-4xl font-black focus:border-blue-500 outline-none" value={newCourse.title} onChange={e => setNewCourse({...newCourse, title: e.target.value})} />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-400 text-xs font-semibold">Course Description</label>
                      <button 
                        onClick={generateAISummary} 
                        disabled={isGeneratingSummary || !newCourse.title.trim()}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white text-[10px] font-black uppercase tracking-wider transition-all shadow-lg"
                      >
                        {isGeneratingSummary ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Zap className="w-3 h-3" />
                            AI Summarize
                          </>
                        )}
                      </button>
                    </div>
                    <textarea placeholder="Write a short summary..." className="w-full bg-slate-900 border border-slate-800 p-8 rounded-[2rem] h-32 outline-none focus:border-blue-500 text-slate-400 leading-relaxed" value={newCourse.description} onChange={e => setNewCourse({...newCourse, description: e.target.value})} />
                  </div>
                </section>

                <section className="space-y-6">
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2 text-indigo-500 uppercase font-black text-[10px] tracking-widest"><Video className="w-4 h-4" /> Video Lesson</div>
                     <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
                       <button onClick={() => setNewCourse({...newCourse, video_type: 'link', video_url: ''})} className={`px-5 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${newCourse.video_type === 'link' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Use Link</button>
                       <button onClick={() => setNewCourse({...newCourse, video_type: 'upload', video_url: ''})} className={`px-5 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${newCourse.video_type === 'upload' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Upload File</button>
                     </div>
                   </div>
                  {newCourse.video_type === 'link' ? (
                    <input placeholder="YouTube Link (https://...)" className="w-full bg-slate-900 border border-slate-800 p-6 rounded-2xl outline-none focus:border-blue-500 font-mono text-xs" value={newCourse.video_url} onChange={e => setNewCourse({...newCourse, video_url: e.target.value})} />
                  ) : (
                    <div onClick={() => !isUploading && fileInputRef.current.click()} className={`w-full border-2 border-dashed border-slate-800 rounded-3xl p-16 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-blue-500 transition-all bg-slate-900/30 ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                      <input type="file" hidden ref={fileInputRef} accept="video/*" onChange={handleFileUpload} />
                      {isUploading ? <Loader2 className="w-12 h-12 text-blue-500 animate-spin" /> : newCourse.video_url ? <CheckCircle className="w-12 h-12 text-green-500" /> : <Upload className="w-12 h-12 text-slate-500" />}
                      <p className="text-[10px] font-black uppercase tracking-widest">{isUploading ? 'Uploading Video...' : newCourse.video_url ? 'Video Attached' : 'Select Video File'}</p>
                    </div>
                  )}
                </section>

                <section className="space-y-4">
                   <div className="flex items-center gap-2 text-purple-500 uppercase font-black text-[10px] tracking-widest"><FileText className="w-4 h-4" /> Study Materials</div>
                   <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => !isMaterialProcessing && materialInputRef.current.click()}
                      className="px-6 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:border-blue-500 text-[10px] font-black uppercase tracking-widest"
                    >
                      {isMaterialProcessing ? 'Analyzing with LLM...' : 'Upload TXT / PDF / DOCX'}
                    </button>
                    {materialSourceName && <span className="text-[10px] uppercase tracking-widest text-slate-500 self-center">Source: {materialSourceName}</span>}
                   </div>
                   <input
                    ref={materialInputRef}
                    type="file"
                    hidden
                    accept=".txt,.pdf,.doc,.docx,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleMaterialUpload}
                   />
                   <textarea
                    placeholder="Or paste full lessons and notes here..."
                    className="w-full bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] h-96 outline-none focus:border-blue-500 font-mono text-sm leading-relaxed"
                    value={materialPreview.pages.map(page => page.content).join('\n\n')}
                    onChange={e => {
                      setMaterialSourceName('manual-input');
                      setNewCourse({ ...newCourse, material: e.target.value });
                    }}
                   />
                   <div className="text-[10px] text-slate-500 uppercase tracking-widest">
                    LLM Analysis Ready: {materialPreview.pages.length} Pages • 1 Quiz + 1 Fill Blank per page
                   </div>
                </section>
              </div>
            </div>

            <div className={`bg-slate-900/50 flex-1 overflow-y-auto border-l border-slate-800 p-12 custom-scrollbar transition-all ${isPreview ? 'block w-full' : 'hidden lg:block opacity-40 grayscale pointer-events-none'}`}>
               <div className="mb-10 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /><span className="text-[10px] font-black uppercase text-slate-500">Preview Mode</span></div>
               <div className="space-y-12">
                  <div className="bg-slate-950 border-4 border-slate-800 rounded-[3rem] overflow-hidden shadow-2xl aspect-video flex items-center justify-center">
                    {newCourse.video_type === 'link' ? (
                      getVideoId(newCourse.video_url) ? <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${getVideoId(newCourse.video_url)}`} frameBorder="0"></iframe> : <Video className="w-12 h-12 text-slate-800" />
                    ) : (
                      newCourse.video_url ? <video controls className="w-full h-full" key={newCourse.video_url}><source src={newCourse.video_url} type="video/mp4" /></video> : <Upload className="w-12 h-12 text-slate-800" />
                    )}
                  </div>
                  <h2 className="text-4xl font-black italic uppercase text-white">{newCourse.title || "Module Name"}</h2>
                  <div className="bg-slate-950 border border-slate-800 p-10 rounded-[2.5rem] whitespace-pre-wrap text-slate-400 leading-relaxed italic">{materialPreview.pages[0]?.content || "Your study notes will show here..."}</div>
               </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
        {courses.map(course => (
          <div key={course.id} className="bg-slate-900 border border-slate-800 p-8 rounded-[2rem] relative group hover:border-slate-600 transition-all shadow-xl">
            <button onClick={() => onDelete(course)} className="absolute top-6 right-6 p-3 bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 rounded-2xl hover:bg-red-500 transition-all"><Trash2 className="w-5 h-5" /></button>
            <div className="bg-blue-500/10 w-12 h-12 rounded-2xl flex items-center justify-center mb-6 text-blue-500">
              {course.video_type === 'upload' ? <Upload className="w-6 h-6" /> : <BookOpen className="w-6 h-6" />}
            </div>
            <h3 className="text-xl font-black mb-2 text-white italic line-clamp-1 uppercase tracking-tight">{course.title}</h3>
            <div className="flex items-center gap-4 text-slate-500 text-[9px] font-black uppercase tracking-widest mb-4">
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {course.enrollments?.[0]?.count || 0} Students</span>
              <span className="font-mono text-slate-600">{new Date(course.created_at).toLocaleDateString()}</span>
            </div>
            <p className="text-slate-500 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudentDashboard({ courses, enrolledIds, onEnroll, onSelect }) {
  return (
    <div className="space-y-12">
      <h2 className="text-6xl font-black tracking-tighter text-white italic mb-2 uppercase">My Learning</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
        {courses.map(course => {
          const isEnrolled = enrolledIds.includes(course.id);
          return (
            <div key={course.id} className="bg-slate-900 border border-slate-800 rounded-[3rem] overflow-hidden hover:border-blue-500/40 transition-all group shadow-2xl">
              <div className="h-52 bg-slate-950 flex items-center justify-center relative overflow-hidden">
                <BrainCircuit className={`w-20 h-20 transition-all duration-1000 ${isEnrolled ? 'text-blue-600 scale-110' : 'text-slate-900 opacity-20'}`} />
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-transparent" />
              </div>
              <div className="p-10">
                <div className="mb-6 flex justify-between items-center">
                  <span className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-full border ${isEnrolled ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-950 border-slate-800 text-slate-600'}`}>
                    {isEnrolled ? 'Joined' : 'Available'}
                  </span>
                </div>
                <h3 className="text-3xl font-black mb-4 group-hover:text-blue-500 italic uppercase transition-colors tracking-tight">{course.title}</h3>
                <p className="text-slate-500 text-sm mb-10 line-clamp-3 leading-relaxed font-medium">{course.description}</p>
                {isEnrolled ? (
                  <button onClick={() => onSelect(course)} className="w-full flex items-center justify-between pt-8 border-t border-slate-800/50 group/btn">
                    <span className="text-white font-black text-[10px] uppercase tracking-widest">Open Course</span>
                    <ChevronRight className="w-5 h-5 text-blue-500 group-hover:translate-x-3 transition-transform" />
                  </button>
                ) : (
                  <button onClick={() => onEnroll(course.id)} className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-2xl font-black text-white text-[10px] uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-xl shadow-blue-500/20">
                    <Zap className="w-4 h-4" /> Start Learning
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CourseViewer({ course, user, supabase, onBack }) {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem(`courseTab-${course.id}`);
      return saved || 'video';
    } catch (e) {
      return 'video';
    }
  });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [materialDoc, setMaterialDoc] = useState(() => parseCourseMaterial(course.material));
  const [pageIndex, setPageIndex] = useState(0);
  const [answersByPage, setAnswersByPage] = useState({});
  const [resultsByPage, setResultsByPage] = useState({});

  const totalPages = materialDoc.pages.length || 1;
  const activePage = materialDoc.pages[pageIndex] || { pageNumber: 1, title: 'Page 1', content: 'No content.', quiz: { question: '', options: [], answer: '' }, fillBlank: { prompt: '', answer: '' } };
  const activeAnswers = answersByPage[pageIndex] || { quizChoice: '', fillBlankInput: '' };
  const storageKey = `course-results-${course.id}-${user.id}`;

  const totalQuestionsAnswered = Object.values(resultsByPage).reduce((acc, item) => acc + (item?.total || 0), 0);
  const totalScore = Object.values(resultsByPage).reduce((acc, item) => acc + (item?.score || 0), 0);

  // Persist tab state
  useEffect(() => {
    localStorage.setItem(`courseTab-${course.id}`, tab);
  }, [tab, course.id]);

  useEffect(() => {
    setMaterialDoc(parseCourseMaterial(course.material));
    setPageIndex(0);
    setAnswersByPage({});
  }, [course.material, course.id]);

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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'neural_messages', filter: `course_id=eq.${course.id}` }, (payload) => {
        if (payload.new.user_id === user.id) setMessages(prev => [...prev, payload.new]);
      }).subscribe();
    return () => supabase.removeChannel(sub);
  }, [course.id, supabase, user.id]);

  const fetchMessages = async () => {
    const { data } = await supabase.from('neural_messages').select('*').eq('course_id', course.id).eq('user_id', user.id).order('created_at', { ascending: true });
    if (data) setMessages(data);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    const userMsg = input.trim();
    setInput('');
    
    // Optimistically update UI with user message
    const userMessageObj = {
      user_id: user.id,
      course_id: course.id,
      content: userMsg,
      is_ai: false,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessageObj]);
    
    // Add user message to database
    await supabase.from('neural_messages').insert([userMessageObj]);
    
    setIsAiLoading(true);
    
    try {
      // Prepare course context from material
      let courseContext = `Course: ${course.title}\n`;
      courseContext += `Description: ${course.description}\n\n`;
      
      if (materialDoc && materialDoc.pages) {
        courseContext += `Course Content:\n`;
        materialDoc.pages.forEach((page, idx) => {
          courseContext += `\nPage ${page.pageNumber}: ${page.title}\n`;
          if (page.summary) courseContext += `Summary: ${page.summary}\n`;
          if (page.content) courseContext += `${page.content.substring(0, 500)}\n`;
        });
      }
      
      // Limit context length to avoid token limits
      if (courseContext.length > 3000) {
        courseContext = courseContext.substring(0, 3000) + '...';
      }
      
      // Call Groq API
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
              content: `You are a helpful educational assistant for an online learning platform. Answer student questions about the course based on the provided course material. Be concise, friendly, and educational. If the question is outside the course material, politely guide the student back to the course topics.\n\n${courseContext}`
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
      const aiResponse = data?.choices?.[0]?.message?.content?.trim() || 
        "I'm having trouble processing your question right now. Please try again.";
      
      // Optimistically update UI with AI response
      const aiMessageObj = {
        user_id: user.id,
        course_id: course.id,
        content: aiResponse,
        is_ai: true,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMessageObj]);
      
      // Add AI response to database
      await supabase.from('neural_messages').insert([aiMessageObj]);
      
    } catch (error) {
      console.error('Help bot error:', error);
      
      // Fallback response
      const fallbackResponse = `I apologize, but I'm having trouble accessing my AI capabilities right now. However, I can tell you that this question relates to "${course.title}". Please review the course materials or try asking again in a moment.`;
      
      const fallbackMessageObj = {
        user_id: user.id,
        course_id: course.id,
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

  const getVideoId = (url) => { try { if (url.includes('v=')) return url.split('v=')[1]?.split('&')[0]; if (url.includes('youtu.be/')) return url.split('/').pop(); } catch (e) {} return 'dQw4w9WgXcQ'; };

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

  const submitAssessment = () => {
    const quizCorrect = (activeAnswers.quizChoice || '').trim().toLowerCase() === (activePage.quiz.answer || '').trim().toLowerCase();
    const fillCorrect = (activeAnswers.fillBlankInput || '').trim().toLowerCase() === (activePage.fillBlank.answer || '').trim().toLowerCase();
    const score = Number(quizCorrect) + Number(fillCorrect);

    setResultsByPage(prev => ({
      ...prev,
      [pageIndex]: {
        score,
        total: 2,
        attemptedAt: new Date().toISOString(),
      },
    }));
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-16 duration-1000 pb-20">
      <div className="flex justify-between items-center mb-12">
        <button onClick={onBack} className="flex items-center gap-4 text-slate-500 hover:text-white transition-all font-black uppercase text-[10px] tracking-widest group">
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 group-hover:bg-blue-600 transition-all"><ChevronRight className="w-5 h-5 rotate-180" /></div>
          Back
        </button>
        <div className="flex items-center gap-3 text-blue-500 bg-blue-500/10 px-6 py-2.5 rounded-full border border-blue-500/20 text-[10px] font-black uppercase tracking-widest">
          <Activity className="w-4 h-4" /> Help Bot Active
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-8 space-y-10">
          <div className="bg-slate-900 border-4 border-slate-800 rounded-[4rem] overflow-hidden shadow-2xl relative">
            {tab === 'video' && (
              <div className="aspect-video bg-black flex items-center justify-center">
                {course.video_type === 'link' ? (
                  <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${getVideoId(course.video_url)}`} frameBorder="0" allowFullScreen></iframe>
                ) : (
                  <video controls className="w-full h-full shadow-inner"><source src={course.video_url} type="video/mp4" /></video>
                )}
              </div>
            )}
            {tab === 'material' && <div className="p-10 lg:p-16 prose prose-invert max-w-none">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-6 mb-8">
                <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter">Study Materials</h2>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-black">Page {pageIndex + 1} of {totalPages}</div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-[2rem] p-8 mb-8">
                <h3 className="text-xl font-black text-white mb-4 uppercase tracking-widest">{activePage.title}</h3>
                <div className="mb-5 p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5">
                  <p className="text-[10px] uppercase tracking-widest font-black text-indigo-300 mb-2">LLM Summary</p>
                  <p className="text-slate-300 text-sm leading-7">{activePage.summary || 'Summary not available for this page.'}</p>
                </div>
                <p className="whitespace-pre-wrap text-slate-300 text-base leading-8 font-medium">{activePage.content}</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-8 space-y-8">
                <div>
                  <h4 className="text-sm uppercase tracking-widest text-blue-400 font-black mb-3">Quiz Question</h4>
                  <p className="text-slate-200 mb-4">{activePage.quiz.question}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activePage.quiz.options.map(option => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setQuizChoice(option)}
                        className={`text-left px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${activeAnswers.quizChoice === option ? 'border-blue-500 bg-blue-600/10 text-blue-300' : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500'}`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm uppercase tracking-widest text-indigo-400 font-black mb-3">Fill in the Blank</h4>
                  <p className="text-slate-300 mb-4">{activePage.fillBlank.prompt}</p>
                  <input
                    type="text"
                    value={activeAnswers.fillBlankInput || ''}
                    onChange={(e) => setFillBlankInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-600"
                    placeholder="Type your answer"
                  />
                </div>

                <button onClick={submitAssessment} type="button" className="w-full bg-green-600 hover:bg-green-500 py-4 rounded-2xl font-black text-white uppercase text-xs tracking-widest">
                  Submit Page Assessment
                </button>

                {resultsByPage[pageIndex] && (
                  <div className="text-[11px] uppercase tracking-widest text-emerald-400 font-black">
                    Score for this page: {resultsByPage[pageIndex].score}/2
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-8 gap-4">
                <button
                  type="button"
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex(prev => Math.max(0, prev - 1))}
                  className="px-6 py-3 rounded-xl border border-slate-700 text-xs font-black uppercase tracking-widest text-slate-300 disabled:opacity-40"
                >
                  Previous Page
                </button>
                <button
                  type="button"
                  disabled={pageIndex >= totalPages - 1}
                  onClick={() => setPageIndex(prev => Math.min(totalPages - 1, prev + 1))}
                  className="px-6 py-3 rounded-xl border border-slate-700 text-xs font-black uppercase tracking-widest text-slate-300 disabled:opacity-40"
                >
                  Next Page
                </button>
              </div>
            </div>}
          </div>
          <div className="bg-slate-900/40 border border-slate-800 p-12 rounded-[3.5rem] backdrop-blur-sm shadow-xl">
            <h2 className="text-4xl font-black mb-6 text-white uppercase italic tracking-tight">{course.title}</h2>
            <p className="text-slate-400 text-xl leading-relaxed font-medium">{course.description}</p>
          </div>
        </div>

        <div className="lg:col-span-4 flex flex-col space-y-8">
          <div className="flex bg-slate-900 border-2 border-slate-800 rounded-3xl p-2 shadow-2xl">
            <button onClick={() => setTab('video')} className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase transition-all ${tab === 'video' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}>Watch</button>
            <button onClick={() => setTab('material')} className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase transition-all ${tab === 'material' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500'}`}>Read</button>
          </div>

          <div className="bg-slate-900 border-2 border-slate-800 rounded-[2.25rem] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-black text-white text-[10px] uppercase tracking-widest">Results Column</h4>
              <Award className="w-5 h-5 text-amber-400" />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] uppercase text-slate-500 font-black tracking-widest">Total Score</p>
                <p className="text-lg font-black text-emerald-400">{totalScore}/{totalQuestionsAnswered || 0}</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] uppercase text-slate-500 font-black tracking-widest">Pages Done</p>
                <p className="text-lg font-black text-blue-400">{Object.keys(resultsByPage).length}/{totalPages}</p>
              </div>
            </div>
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {materialDoc.pages.map((page, idx) => {
                const result = resultsByPage[idx];
                return (
                  <button
                    type="button"
                    key={page.pageNumber}
                    onClick={() => {
                      setTab('material');
                      setPageIndex(idx);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-[10px] uppercase tracking-widest font-black transition-all ${idx === pageIndex && tab === 'material' ? 'border-blue-500 bg-blue-600/10 text-blue-300' : 'border-slate-800 bg-slate-950 text-slate-500'}`}
                  >
                    Page {page.pageNumber} {result ? `• ${result.score}/2` : '• Pending'}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 bg-slate-900 border-2 border-slate-800 rounded-[3rem] flex flex-col overflow-hidden shadow-2xl min-h-[550px] relative">
            <div className="p-6 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
              <div className="flex items-center gap-3"><HelpCircle className="w-6 h-6 text-blue-500" /><h4 className="font-black text-white text-[10px] uppercase tracking-widest">Help Bot</h4></div>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            </div>

            <div className="h-[400px] overflow-y-auto p-6 space-y-6 custom-scrollbar text-[11px] leading-relaxed">
              <div className="bg-blue-600/5 border border-blue-500/10 p-5 rounded-3xl text-[11px] text-blue-400 font-medium italic leading-relaxed">
                "Hello! I am ready to answer questions about {course.title}. Type below."
              </div>
              {messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.is_ai ? 'items-start' : 'items-end'}`}>
                  <div className={`max-w-[85%] p-5 rounded-3xl text-[11px] font-medium shadow-sm ${m.is_ai ? 'bg-slate-800 text-slate-300 rounded-tl-none' : 'bg-blue-600 text-white rounded-tr-none'}`}>{m.content}</div>
                </div>
              ))}
              {isAiLoading && <div className="flex gap-2 p-3"><div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" /></div>}
            </div>

            <form onSubmit={sendMessage} className="p-6 border-t border-slate-800 bg-slate-950/30">
              <div className="relative">
                <input type="text" placeholder="Ask a question..." value={input} onChange={(e) => setInput(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-6 py-5 text-xs outline-none focus:ring-2 focus:ring-blue-600 transition-all pr-14" />
                <button type="submit" className="absolute right-3 top-3 p-3 text-blue-500"><MessageSquare className="w-5 h-5" /></button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}