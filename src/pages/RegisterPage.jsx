import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, User, LogIn, AlertCircle, Loader2 } from 'lucide-react';
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

export default function RegisterPage() {
  const navigate = useNavigate();
  const { supabase } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('student');
  const [showGoogleDetailsModal, setShowGoogleDetailsModal] = useState(false);
  const [googleName, setGoogleName] = useState('');
  const [googleRole, setGoogleRole] = useState('student');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const getOAuthSetupMessage = (message) => {
    const raw = (message || '').toLowerCase();
    const providerDisabled =
      raw.includes('provider is not enabled') ||
      raw.includes('unsupported provider') ||
      raw.includes('oauth provider not enabled') ||
      raw.includes('invalid provider');
    if (!providerDisabled) return message || 'Google sign-up failed.';
    return 'Google login is not enabled in Supabase. Enable Google provider and add this app URL in Supabase Auth Redirect URLs.';
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError(null);
    if (!fullName || !email || !password || !confirmPassword || !selectedRole) {
      setError('Please fill in all fields');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setIsLoading(true);
    try {
      const { data: { user }, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role: selectedRole,
          },
        },
      });
      if (signUpError) throw signUpError;
      if (user) {
        const { error: profileError } = await supabase.from('profiles').insert([{ id: user.id, email, role: selectedRole }]);
        if (profileError) throw profileError;
        navigate(selectedRole === 'admin' ? '/admin' : '/student');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleRegister = async () => {
    if (!supabase) {
      setError('Authentication is still loading. Please try again.');
      return;
    }

    if (!googleName.trim()) {
      setError('Please enter your name to continue with Google.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      localStorage.setItem('eduflow_pending_role', googleRole);
      localStorage.setItem('eduflow_pending_name', googleName.trim());

      await signInWithGooglePopup({
        supabase,
        redirectTo: `${window.location.origin}`,
      });
      setShowGoogleDetailsModal(false);
      navigate(googleRole === 'admin' ? '/admin' : '/student');
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
              <User className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Create your account</h1>
            <p className="text-slate-500 text-sm">Start learning with EduFlow today</p>
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

          <form onSubmit={handleRegister} className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Full Name</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm"
                />
              </div>
            </div>

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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Confirm</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">I am a</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedRole('student')}
                  className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                    selectedRole === 'student'
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  Student
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRole('admin')}
                  className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                    selectedRole === 'admin'
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  Admin / Teacher
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl py-3 flex items-center justify-center gap-2 transition-all mt-6"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create account'
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
            onClick={() => {
              setError(null);
              setGoogleName(fullName.trim() || googleName);
              setGoogleRole(selectedRole || 'student');
              setShowGoogleDetailsModal(true);
            }}
            disabled={isLoading || !supabase}
            className="w-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-semibold text-sm rounded-xl py-3 transition-all flex items-center justify-center gap-2.5"
          >
            <GoogleLogo className="w-5 h-5" />
            Google
          </button>

          <p className="text-center text-slate-600 text-sm mt-8 pt-6 border-t border-slate-100">
            Already have an account?{' '}
            <Link to="/login" className="text-teal-600 font-semibold hover:text-teal-700">Sign in</Link>
          </p>
        </div>
      </div>

      {showGoogleDetailsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl page-enter">
            <h2 className="text-slate-900 text-xl font-bold mb-1">Complete your profile</h2>
            <p className="text-slate-500 text-sm mb-6">Tell us your name and role before continuing with Google.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Full Name</label>
                <input
                  type="text"
                  value={googleName}
                  onChange={(e) => setGoogleName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">I am a</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setGoogleRole('student')}
                    className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                      googleRole === 'student'
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Student
                  </button>
                  <button
                    type="button"
                    onClick={() => setGoogleRole('admin')}
                    className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                      googleRole === 'admin'
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Admin / Teacher
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowGoogleDetailsModal(false)}
                className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-sm rounded-xl py-3 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGoogleRegister}
                disabled={isLoading}
                className="flex-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-sm rounded-xl py-3 transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleLogo className="w-4 h-4" />}
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
