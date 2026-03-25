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
  const { role, displayName, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

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
    { label: 'Goals', path: '/student?tab=goals', icon: Target },
    { label: 'Personal AI Study Library', path: '/student?tab=help', icon: HelpCircle },
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
        className="fixed top-4 left-4 z-50 lg:hidden p-2 bg-white border border-slate-200 rounded-xl text-slate-800 shadow-sm hover:bg-slate-50 transition-all hover:-translate-y-0.5"
      >
        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/30 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen w-72 panel-strong border-r border-slate-200 z-40 transition-transform duration-300 overflow-y-auto backdrop-blur-md lg:translate-x-0 lg:transition-[width] lg:duration-300 ${isCollapsed ? 'lg:w-20' : 'lg:w-72'} ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className={`p-6 space-y-8 h-full flex flex-col page-enter ${isCollapsed ? 'lg:px-3' : 'lg:px-6'}`}>
          <div className="hidden lg:flex justify-end">
            <button
              type="button"
              onClick={() => setIsCollapsed((prev) => !prev)}
              className="p-2 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-all"
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>

          {/* Logo/Branding */}
          <div className={`flex items-center group cursor-pointer ${isCollapsed ? 'lg:justify-center' : 'gap-3'}`} onClick={() => {
            navigate(role === 'admin' ? '/admin' : '/student');
            setIsOpen(false);
          }}>
            <div className="bg-teal-100 p-3 rounded-xl group-hover:bg-teal-200 transition-all">
              <BookOpen className="w-6 h-6 text-teal-700" />
            </div>
            <div className={isCollapsed ? 'lg:hidden' : ''}>
              <p className="text-slate-900 font-black text-xl italic">EduFlow</p>
              <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Learning Hub</p>
            </div>
          </div>

          {/* Navigation Sections */}
          <nav className="flex-1 space-y-6">
            {/* Main Navigation */}
            <div>
              <p className={`text-slate-500 text-xs font-black uppercase tracking-widest mb-3 ${isCollapsed ? 'lg:hidden' : ''}`}>Navigation</p>
              <div className="space-y-2 animate-stagger">
                {navigation.map((item, index) => (
                  <button
                    key={item.label}
                    onClick={() => handleNavClick(item.path, item.disabled)}
                    disabled={item.disabled}
                    title={item.label}
                    style={{ animationDelay: `${index * 55}ms` }}
                    className={`w-full flex items-center rounded-xl font-bold text-sm uppercase tracking-wide transition-all ${isCollapsed ? 'lg:justify-center lg:px-3 px-4 py-3' : 'gap-3 px-4 py-3'} ${
                      isActive(item.path)
                        ? 'bg-teal-700 text-white shadow-lg shadow-teal-200'
                        : item.disabled
                        ? 'text-slate-400 cursor-not-allowed opacity-60'
                        : 'text-slate-700 hover:bg-teal-50 hover:text-teal-800 hover:-translate-y-0.5'
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span className={isCollapsed ? 'lg:hidden' : ''}>{item.label}</span>
                    {item.disabled && <span className={`text-xs ml-auto ${isCollapsed ? 'lg:hidden' : ''}`}>Soon</span>}
                  </button>
                ))}
              </div>
            </div>



            {/* User Section */}
            <div>
              <p className={`text-slate-500 text-xs font-black uppercase tracking-widest mb-3 ${isCollapsed ? 'lg:hidden' : ''}`}>Account</p>
              <div className="space-y-2">
                <button
                  onClick={() => handleNavClick('/student?tab=profile', false)}
                  title="Profile"
                  className={`w-full flex items-center rounded-xl font-bold text-sm uppercase tracking-wide transition-all ${isCollapsed ? 'lg:justify-center lg:px-3 px-4 py-3' : 'gap-3 px-4 py-3'} ${
                    isActive('/student?tab=profile')
                      ? 'bg-teal-700 text-white shadow-lg shadow-teal-200'
                      : 'text-slate-700 hover:bg-teal-50 hover:text-teal-800 hover:-translate-y-0.5'
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span className={isCollapsed ? 'lg:hidden' : ''}>Profile</span>
                </button>
              </div>
            </div>
          </nav>

          {/* User Info and Logout */}
          <div className="border-t border-slate-200 pt-6 space-y-4">
            <div className={`bg-slate-100 rounded-xl p-4 border border-slate-200 hover-lift ${isCollapsed ? 'lg:hidden' : ''}`}>
              <p className="text-slate-500 text-xs font-bold mb-1">Logged in as</p>
              <p className="text-slate-900 font-bold text-sm truncate">{displayName || 'User'}</p>
              <p className="text-teal-700 text-xs font-bold uppercase tracking-wide mt-1">
                {role === 'admin' ? 'Administrator' : 'Student'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className={`w-full flex items-center justify-center bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg hover:-translate-y-0.5 ${isCollapsed ? 'lg:px-2 px-4 py-3' : 'gap-2 px-4 py-3'}`}
            >
              <LogOut className="w-4 h-4" />
              <span className={isCollapsed ? 'lg:hidden' : ''}>Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content margin on desktop */}
      <div className={`hidden lg:block ${isCollapsed ? 'w-20' : 'w-72'}`} />
    </>
  );
}
