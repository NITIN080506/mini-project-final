import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [supabase, setSupabase] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);

  const SUPABASE_URL = "https://rnjxhwhvfaccxhkjeosi.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuanhod2h2ZmFjY3hoa2plb3NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjAzNTMsImV4cCI6MjA4ODQzNjM1M30.xSdsDrjnAOuKhWh9ACFqjlyCFaFwQpmuKtx2hTWg2jk";

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
        setNeedsProfileSetup(false);
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
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', u.id)
        .maybeSingle();

      if (profile?.role) {
        setRole(profile.role);
        setNeedsProfileSetup(false);
      } else {
        const pendingRole = localStorage.getItem('eduflow_pending_role');
        const pendingName = localStorage.getItem('eduflow_pending_name');
        if (!pendingRole) {
          setRole(null);
          setNeedsProfileSetup(true);
          setLoading(false);
          return;
        }

        const metadataRole = u?.user_metadata?.role;
        const resolvedRole = (pendingRole || metadataRole || 'student').toLowerCase() === 'admin' ? 'admin' : 'student';
        const fullName = pendingName || u?.user_metadata?.full_name || u?.user_metadata?.name || 'User';

        // Update user metadata with full name
        await supabase.auth.updateUser({ data: { full_name: fullName } });

        const { error: insertProfileError } = await supabase.from('profiles').insert([
          {
            id: u.id,
            email: u.email,
            role: resolvedRole,
          },
        ]);

        if (insertProfileError && !String(insertProfileError.message || '').toLowerCase().includes('duplicate')) {
          throw insertProfileError;
        }

        setRole(resolvedRole);
        setNeedsProfileSetup(false);
      }

      localStorage.removeItem('eduflow_pending_role');
      localStorage.removeItem('eduflow_pending_name');
    } catch (err) {
      console.error(err);
      setRole(null);
      setNeedsProfileSetup(true);
    }
    setLoading(false);
  };

  const completeProfile = async ({ fullName, role: selectedRole }) => {
    if (!user || !supabase) throw new Error('Session not ready');
    const normalizedRole = String(selectedRole || 'student').toLowerCase() === 'admin' ? 'admin' : 'student';
    const safeName = (fullName || '').trim() || user?.user_metadata?.full_name || user?.user_metadata?.name || 'User';

    // Update user metadata with full name
    await supabase.auth.updateUser({ data: { full_name: safeName } });

    const { error } = await supabase.from('profiles').upsert([
      {
        id: user.id,
        email: user.email,
        role: normalizedRole,
      },
    ]);

    if (error) throw error;

    setRole(normalizedRole);
    setNeedsProfileSetup(false);
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

  const enrollCourse = async (courseId) => {
    try {
      await supabase.from('enrollments').insert([{ user_id: user.id, course_id: courseId }]);
      fetchEnrollments();
    } catch (err) {
      console.error(err);
      alert('Failed to enroll in course');
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{
      supabase,
      user,
      role,
      needsProfileSetup,
      loading,
      courses,
      enrollments,
      enrollCourse,
      completeProfile,
      logout,
      fetchCourses,
      fetchEnrollments
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
