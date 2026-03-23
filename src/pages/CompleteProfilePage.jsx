import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const { user, completeProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || user?.user_metadata?.name || '');
  const [selectedRole, setSelectedRole] = useState('student');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    setIsSaving(true);
    try {
      await completeProfile({ fullName: fullName.trim(), role: selectedRole });
      navigate(selectedRole === 'admin' ? '/admin' : '/student', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to complete profile.');
    } finally {
      setIsSaving(false);
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
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Complete your profile</h1>
            <p className="text-slate-500 text-sm">Tell us a bit about yourself</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-600 text-sm font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Full Name</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
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
              disabled={isSaving}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl py-3 flex items-center justify-center gap-2 transition-all mt-6"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isSaving ? 'Saving...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
