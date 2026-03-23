import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, LogIn, AlertCircle, Loader2 } from 'lucide-react';
import { signInWithGooglePopup } from '../utils/googlePopupAuth';

function GoogleLogo({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-.9 2.2-1.9 2.9v2.4h3.1c1.8-1.7 2.8-4.2 2.8-7.1 0-.6-.1-1.3-.2-1.9H12z" />
      <path fill="#34A853" d="M12 22c2.6 0 4.8-.9 6.4-2.5l-3.1-2.4c-.9.6-2 .9-3.3.9-2.5 0-4.7-1.7-5.5-4H3.3v2.5C4.9 19.8 8.2 22 12 22z" />
      <path fill="#4A90E2" d="M6.5 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.5H3.3C2.5 9 2 10.5 2 12s.5 3 1.3 4.5L6.5 14z" />
      <path fill="#FBBC05" d="M12 6.1c1.4 0 2.6.5 3.6 1.4l2.7-2.7C16.8 3.2 14.6 2 12 2 8.2 2 4.9 4.2 3.3 7.5l3.2 2.5c.8-2.3 3-3.9 5.5-3.9z" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { supabase } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const getOAuthSetupMessage = (message) => {
    const raw = (message || '').toLowerCase();
    const providerDisabled =
      raw.includes('provider is not enabled') ||
      raw.includes('unsupported provider') ||
      raw.includes('oauth provider not enabled') ||
      raw.includes('invalid provider');
    if (!providerDisabled) return message || 'Google sign-in failed.';
    return 'Google login is not enabled in Supabase. Enable Google provider and add this app URL in Supabase Auth Redirect URLs.';
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      if (user) navigate('/student');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!supabase) {
      setError('Authentication is still loading. Please try again.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await signInWithGooglePopup({
        supabase,
        redirectTo: `${window.location.origin}`,
      });
      navigate('/student');
    } catch (err) {
      setError(getOAuthSetupMessage(err.message));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="ambient-orb w-[500px] h-[500px] bg-teal-200/50 -top-40 -left-40" />
      <div className="ambient-orb w-[400px] h-[400px] bg-indigo-200/40 -bottom-32 -right-32" />
      
      <div className="w-full max-w-md page-enter relative z-10">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/60 p-8 md:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-500/20">
              <LogIn className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Welcome back</h1>
            <p className="text-slate-500 text-sm">Sign in to continue to EduFlow</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-600 text-sm font-medium">{error}</p>
                <button onClick={() => setError(null)} className="text-xs font-semibold text-red-500 hover:text-red-600 mt-1">Dismiss</button>
              </div>
            </div>
          )}

          <form onSubmit={handleEmailLogin} className="space-y-5 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl py-3 flex items-center justify-center gap-2 transition-all"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-white text-slate-400 text-xs font-medium">or continue with</span>
            </div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={isLoading || !supabase}
            className="w-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-semibold text-sm rounded-xl py-3 transition-all flex items-center justify-center gap-2.5"
          >
            <GoogleLogo className="w-5 h-5" />
            Google
          </button>

          <p className="mt-2 text-center text-xs text-slate-400">
            New to Google sign-in? You'll set up your profile after.
          </p>

          <p className="text-center text-slate-600 text-sm mt-8 pt-6 border-t border-slate-100">
            Don't have an account?{' '}
            <Link to="/register" className="text-teal-600 font-semibold hover:text-teal-700">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
