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
    <div className="app-shell soft-grid min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="ambient-orb w-80 h-80 bg-teal-300 top-10 -left-20" />
      <div className="ambient-orb w-[22rem] h-[22rem] bg-cyan-300 -bottom-16 -right-16" />
      <div className="w-full max-w-md page-enter relative z-10">
        <div className="app-panel panel-strong rounded-3xl p-8 md:p-12">
          <div className="text-center mb-10 animate-stagger">
            <h1 className="text-4xl font-black text-slate-900 mb-2 italic">EduFlow</h1>
            <p className="text-slate-500 text-sm uppercase tracking-widest font-bold">Create Your Account</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 text-sm font-semibold mb-2">{error}</p>
                <button onClick={() => setError(null)} className="text-xs font-black uppercase text-red-300 hover:text-red-200">Dismiss</button>
              </div>
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-5 mb-8 animate-stagger">
            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Full Name</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full bg-white border border-slate-300 rounded-xl pl-12 pr-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full bg-white border border-slate-300 rounded-xl pl-12 pr-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full bg-white border border-slate-300 rounded-xl pl-12 pr-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className="w-full bg-white border border-slate-300 rounded-xl pl-12 pr-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Register As</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors text-sm"
              >
                <option value="student">Student</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50 text-white font-black text-sm rounded-xl py-3 uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg transition-all hover:-translate-y-0.5"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Create Account
                </>
              )}
            </button>
          </form>

          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white/70 text-slate-500 uppercase text-xs font-black">Or</span>
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
            className="w-full bg-white border border-slate-300 hover:border-teal-500 disabled:opacity-50 text-slate-800 font-black text-sm rounded-xl py-3 uppercase tracking-widest transition-all flex items-center justify-center gap-2 hover:-translate-y-0.5"
          >
            <GoogleLogo className="w-5 h-5" />
            Continue with Google
          </button>

          <p className="text-center text-slate-500 text-xs">
            Already have an account? <Link to="/login" className="text-teal-700 font-bold hover:text-teal-600">Sign in</Link>
          </p>
        </div>
      </div>

      {showGoogleDetailsModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl page-enter">
            <h2 className="text-slate-900 text-xl font-black mb-2">Complete Google Registration</h2>
            <p className="text-slate-500 text-sm mb-6">Tell us your name and role before continuing with Google.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Full Name</label>
                <input
                  type="text"
                  value={googleName}
                  onChange={(e) => setGoogleName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Register As</label>
                <select
                  value={googleRole}
                  onChange={(e) => setGoogleRole(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors text-sm"
                >
                  <option value="student">Student</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowGoogleDetailsModal(false)}
                className="flex-1 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 font-black text-xs uppercase tracking-widest rounded-xl py-3 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGoogleRegister}
                disabled={isLoading}
                className="flex-1 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest rounded-xl py-3 transition-all flex items-center justify-center gap-2"
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
