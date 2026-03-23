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
    <div className="app-shell soft-grid min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="ambient-orb w-80 h-80 bg-teal-300 top-10 -left-20" />
      <div className="ambient-orb w-[22rem] h-[22rem] bg-sky-300 -bottom-16 -right-16" />
      <div className="w-full max-w-md page-enter relative z-10">
        <div className="app-panel panel-strong rounded-3xl p-10 shadow-2xl backdrop-blur-sm">
          <div className="text-center mb-8 animate-stagger">
            <h1 className="text-4xl font-black text-slate-900 mb-2 italic">EduFlow</h1>
            <p className="text-slate-500 text-xs uppercase tracking-widest font-bold">Complete Your Profile</p>
          </div>

          {error && (
            <div className="mb-5 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs font-semibold">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full bg-white border border-slate-300 rounded-xl pl-10 pr-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">I am joining as</label>
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
              disabled={isSaving}
              className="w-full bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50 text-white font-black text-sm rounded-xl py-3 uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save and Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
