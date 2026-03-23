import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  BookOpen, 
  Home, 
  LogOut, 
  Menu, 
  X, 
  Plus, 
  Settings,
  User,
  BarChart3,
  BarChart2,
  Clock,
  HelpCircle,
  Trophy,
  LayoutDashboard,
  Compass,
  Target,
  FileCheck
} from 'lucide-react';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getQueryParam = (name) => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get(name);
  };

  const isActive = (path) => {
    if (path.includes('?')) {
      const [pathPart, queryPart] = path.split('?');
      const [key, value] = queryPart.split('=');
      return location.pathname === pathPart && getQueryParam(key) === value;
    }
    return location.pathname === path;
  };

  const StudentNavigation = [
    { label: 'Overview', path: '/student?tab=overview', icon: LayoutDashboard },
    { label: 'My Courses', path: '/student?tab=my-courses', icon: BookOpen },
    { label: 'Browse Courses', path: '/student?tab=browse', icon: Compass },
    { label: 'My Results', path: '/student?tab=my-results', icon: FileCheck },
    { label: 'Daily Rankings', path: '/student?tab=daily-rankings', icon: Trophy },
    { label: 'Goals', path: '', icon: Target, disabled: true },
    { label: 'Help', path: '', icon: HelpCircle, disabled: true },
  ];

  const AdminNavigation = [
    { label: 'Dashboard', path: '/admin', icon: Home },
    { label: 'Add Course', path: '/add-course', icon: Plus },
    { label: 'Student Performance', path: '/admin?tab=performance', icon: BarChart2 },
    { label: 'Analytics', path: '', icon: BarChart3, disabled: true },
    { label: 'Settings', path: '', icon: Settings, disabled: true },
  ];

  const navigation = role === 'admin' ? AdminNavigation : StudentNavigation;

  const handleNavClick = (path, disabled) => {
    if (!disabled && path) {
      navigate(path);
      setIsOpen(false);
    }
  };

  return (
    <>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2.5 bg-white border border-slate-200 rounded-xl text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
      >
        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen w-72 bg-white border-r border-slate-200/80 z-40 transition-transform duration-300 overflow-y-auto lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-5 flex flex-col h-full page-enter">
          {/* Logo/Branding */}
          <div 
            className="flex items-center gap-3 mb-8 cursor-pointer group" 
            onClick={() => {
              navigate(role === 'admin' ? '/admin' : '/student');
              setIsOpen(false);
            }}
          >
            <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-slate-900 font-bold text-lg tracking-tight">EduFlow</p>
              <p className="text-slate-400 text-xs font-medium">Learning Platform</p>
            </div>
          </div>

          {/* Navigation Sections */}
          <nav className="flex-1 space-y-6">
            {/* Main Navigation */}
            <div>
              <p className="section-label px-3">Menu</p>
              <div className="space-y-1">
                {navigation.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => handleNavClick(item.path, item.disabled)}
                    disabled={item.disabled}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive(item.path)
                        ? 'bg-teal-50 text-teal-700 font-semibold'
                        : item.disabled
                        ? 'text-slate-300 cursor-not-allowed'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <item.icon className={`w-[18px] h-[18px] ${isActive(item.path) ? 'text-teal-600' : ''}`} />
                    {item.label}
                    {item.disabled && (
                      <span className="ml-auto text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Soon</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* User Section */}
            <div>
              <p className="section-label px-3">Account</p>
              <div className="space-y-1">
                <button
                  disabled
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 cursor-not-allowed"
                >
                  <User className="w-[18px] h-[18px]" />
                  Profile
                  <span className="ml-auto text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Soon</span>
                </button>
              </div>
            </div>
          </nav>

          {/* User Info and Logout */}
          <div className="border-t border-slate-100 pt-5 mt-4 space-y-3">
            <div className="bg-slate-50 rounded-xl p-3.5">
              <p className="text-slate-400 text-[11px] font-medium uppercase tracking-wide mb-1">Signed in as</p>
              <p className="text-slate-900 font-semibold text-sm truncate">{user?.email}</p>
              <span className={`inline-block mt-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                role === 'admin' 
                  ? 'bg-purple-100 text-purple-700' 
                  : 'bg-teal-100 text-teal-700'
              }`}>
                {role === 'admin' ? 'Administrator' : 'Student'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-sm transition-all"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content margin on desktop */}
      <div className="hidden lg:block w-72" />
    </>
  );
}
