import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export default function PopupAuthCallbackPage() {
  const { supabase } = useAuth();
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (!supabase || hasRunRef.current) return;
    hasRunRef.current = true;

    const notify = (payload) => {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch {
        // ignore messaging errors
      }
    };

    const completeAuth = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (code && typeof supabase.auth.exchangeCodeForSession === 'function') {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;
        if (!session?.user) {
          throw new Error('Google sign-in did not complete.');
        }

        notify({ type: 'eduflow:oauth:success' });
      } catch (err) {
        notify({
          type: 'eduflow:oauth:error',
          message: err?.message || 'Google sign-in failed.',
        });
      } finally {
        window.close();
      }
    };

    completeAuth();
  }, [supabase]);

  return (
    <div className="app-shell soft-grid min-h-screen text-slate-900 flex items-center justify-center p-6">
      <div className="app-panel panel-strong rounded-3xl p-8 text-center page-enter max-w-md w-full">
        <p className="text-sm uppercase tracking-widest text-slate-500 mb-2 font-black">EduFlow</p>
        <h1 className="text-xl font-black mb-2">Completing Google Sign-In</h1>
        <p className="text-slate-500 text-sm">You can close this popup if it does not close automatically.</p>
      </div>
    </div>
  );
}
