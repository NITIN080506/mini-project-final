import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import StudentDashboard from './pages/StudentDashboard';
import AdminDashboard from './pages/AdminDashboard';
import CourseViewer from './pages/CourseViewer';

const SUPABASE_URL = "https://rnjxhwhvfaccxhkjeosi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuanhod2h2ZmFjY3hoa2plb3NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjAzNTMsImV4cCI6MjA4ODQzNjM1M30.xSdsDrjnAOuKhWh9ACFqjlyCFaFwQpmuKtx2hTWg2jk";
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = import.meta.env.VITE_GROQ_MODEL || 'llama-3.3-70b-versatile';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export default function App() {
  const [supabase, setSupabase] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [error, setError] = useState(null);
  
  // Page state - persisted to localStorage
  const [currentPage, setCurrentPage] = useState(() => {
    try {
      return localStorage.getItem('currentPage') || 'auth';
    } catch {
      return 'auth';
    }
  });
  
  const [authMode, setAuthMode] = useState(() => {
    try {
      return localStorage.getItem('authMode') || 'login';
    } catch {
      return 'login';
    }
  });
  
  const [selectedCourse, setSelectedCourse] = useState(() => {
    try {
      const saved = localStorage.getItem('selectedCourse');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Persist page state
  useEffect(() => {
    localStorage.setItem('currentPage', currentPage);
  }, [currentPage]);

  useEffect(() => {
    localStorage.setItem('authMode', authMode);
  }, [authMode]);

  useEffect(() => {
    if (selectedCourse) {
      localStorage.setItem('selectedCourse', JSON.stringify(selectedCourse));
    } else {
      localStorage.removeItem('selectedCourse');
    }
  }, [selectedCourse]);

  // Initialize Supabase
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

  // Check session
  useEffect(() => {
    if (!supabase) return;
    
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) await handleUserSession(session.user);
        else setLoading(false);
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    };
    
    checkSession();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        handleUserSession(session.user);
      } else {
        setUser(null);
        setRole(null);
        setCurrentPage('auth');
        setLoading(false);
      }
    });
    
    return () => subscription?.unsubscribe();
  }, [supabase]);

  // Fetch data when user/role changes
  useEffect(() => {
    if (!user || !role || !supabase) return;
    fetchCourses();
    fetchEnrollments();
    const channel = supabase
      .channel('global_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, fetchCourses)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, fetchEnrollments)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user, role, supabase]);

  const handleUserSession = async (u) => {
    setUser(u);
    try {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', u.id).single();
      if (profile) {
        setRole(profile.role);
        // Restore last page
        const savedPage = localStorage.getItem('currentPage');
        if (savedPage && (savedPage === 'admin' || savedPage === 'student' || savedPage === 'viewer')) {
          setCurrentPage(savedPage);
        } else {
          setCurrentPage(profile.role === 'admin' ? 'admin' : 'student');
        }
      } else {
        setCurrentPage('complete-profile');
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const fetchCourses = async () => {
    const { data } = await supabase.from('courses').select('*, enrollments(count)').order('created_at', { ascending: false });
    if (data) setCourses(data);
  };

  const fetchEnrollments = async () => {
    if (role === 'admin') return;
    const { data } = await supabase.from('enrollments').select('course_id').eq('user_id', user.id);
    if (data) setEnrollments(data.map(e => e.course_id));
  };

  const getOAuthSetupMessage = (message) => {
    const raw = (message || '').toLowerCase();
    const providerDisabled =
      raw.includes('provider is not enabled') ||
      raw.includes('unsupported provider') ||
      raw.includes('oauth provider not enabled') ||
      raw.includes('invalid provider');
    if (!providerDisabled) return message || 'Google sign-in failed.';
    return `Google login is not enabled in Supabase. In Supabase Dashboard open Authentication > Providers > Google and enable it.`;
  };

  const handleLoginSuccess = (sessionUser) => {
    setUser(sessionUser);
    setCurrentPage(role === 'admin' ? 'admin' : 'student');
  };

  const handleRegisterSuccess = (sessionUser) => {
    setUser(sessionUser);
    setAuthMode('complete-profile');
    setCurrentPage('complete-profile');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRole(null);
    setCurrentPage('auth');
    setSelectedCourse(null);
    localStorage.clear();
  };

  const handleSelectCourse = (course) => {
    setSelectedCourse(course);
    setCurrentPage('viewer');
  };

  const handleBackFromCourse = () => {
    setSelectedCourse(null);
    setCurrentPage(role === 'admin' ? 'admin' : 'student');
    localStorage.removeItem('selectedCourse');
  };

  const enrollCourse = async (courseId) => {
    try {
      await supabase.from('enrollments').insert([{ user_id: user.id, course_id: courseId }]);
      fetchEnrollments();
    } catch (err) {
      console.error(err);
      alert('Failed to enroll in course');
    }
  };

  const clearError = () => setError(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white font-black text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  // Auth pages
  if (currentPage === 'auth' || !user) {
    if (authMode === 'register') {
      return (
        <RegisterPage
          supabase={supabase}
          onRegisterSuccess={handleRegisterSuccess}
          error={error}
          clearError={clearError}
        />
      );
    }
    return (
      <LoginPage
        supabase={supabase}
        onLoginSuccess={handleLoginSuccess}
        error={error}
        clearError={clearError}
        getOAuthSetupMessage={getOAuthSetupMessage}
      />
    );
  }

  // Student dashboard
  if (currentPage === 'student') {
    return (
      <StudentDashboard
        courses={courses}
        enrolledIds={enrollments}
        onEnroll={enrollCourse}
        onSelect={handleSelectCourse}
        user={user}
        onLogout={handleLogout}
      />
    );
  }

  // Admin dashboard
  if (currentPage === 'admin') {
    return (
      <AdminDashboard
        supabase={supabase}
        courses={courses}
        onAdd={fetchCourses}
        onDelete={fetchCourses}
        error={error}
        clearError={clearError}
        user={user}
        onLogout={handleLogout}
      />
    );
  }

  // Course viewer
  if (currentPage === 'viewer' && selectedCourse) {
    return (
      <CourseViewer
        course={selectedCourse}
        user={user}
        supabase={supabase}
        onBack={handleBackFromCourse}
      />
    );
  }

  return null;
}
