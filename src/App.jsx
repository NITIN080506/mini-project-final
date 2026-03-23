import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import StudentDashboard from './pages/StudentDashboard';
import AdminDashboard from './pages/AdminDashboard';
import CourseViewerPage from './pages/CourseViewerPage';
import AdminCourseEditor from './pages/AdminCourseEditor';
import AddCoursePage from './pages/AddCoursePage';
import PopupAuthCallbackPage from './pages/PopupAuthCallbackPage';
import CompleteProfilePage from './pages/CompleteProfilePage';

// Layout with Sidebar
function MainLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 p-5 md:p-8 lg:p-10">
        <div className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}

// Protected route wrapper
function ProtectedRoute({ children, requiredRole = null }) {
  const { user, role, loading, needsProfileSetup } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-slate-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-600 font-medium text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (needsProfileSetup) {
    return <Navigate to="/complete-profile" replace />;
  }

  if (requiredRole && role !== requiredRole) {
    return <Navigate to={role === 'admin' ? '/admin' : '/student'} replace />;
  }

  return children;
}

// Auth route wrapper - redirect if already logged in
function AuthRoute({ children }) {
  const { user, role, loading, needsProfileSetup } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-slate-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-600 font-medium text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    if (needsProfileSetup) {
      return <Navigate to="/complete-profile" replace />;
    }
    return <Navigate to={role === 'admin' ? '/admin' : '/student'} replace />;
  }

  return children;
}

// Simple auth check for profile completion page
function ProfileSetupRoute({ children }) {
  const { user, loading, needsProfileSetup } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-slate-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-600 font-medium text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Allow access if profile setup is needed, but redirect away if already complete
  if (!needsProfileSetup) {
    return <Navigate to="/student" replace />;
  }

  return children;
}

// Course route wrapper - shows admin editor for admins, course viewer for students
function CourseRoute() {
  const { role } = useAuth();
  
  if (role === 'admin') {
    return <AdminCourseEditor />;
  }
  
  return <CourseViewerPage />;
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/auth/popup-callback" element={<PopupAuthCallbackPage />} />
          <Route
            path="/complete-profile"
            element={
              <ProfileSetupRoute>
                <CompleteProfilePage />
              </ProfileSetupRoute>
            }
          />

          {/* Auth Routes */}
          <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
          <Route path="/register" element={<AuthRoute><RegisterPage /></AuthRoute>} />

          {/* Student Routes */}
          <Route
            path="/student"
            element={
              <ProtectedRoute requiredRole="student">
                <MainLayout>
                  <StudentDashboard />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          {/* Course Route - Admin Editor or Student Viewer */}
          <Route
            path="/course/:courseId"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <CourseRoute />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          {/* Admin Routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <MainLayout>
                  <AdminDashboard />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/add-course"
            element={
              <ProtectedRoute requiredRole="admin">
                <MainLayout>
                  <AddCoursePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/student" replace />} />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
