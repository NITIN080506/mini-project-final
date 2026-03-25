import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Trash2, Activity, Users, BarChart2, TrendingUp, Loader } from 'lucide-react';

const ASSESSMENT_TABLE = 'student_assessment_results';

const buildDefaultAnalysis = (avgScore, attemptCount, completedCourses) => {
  if (attemptCount === 0) return 'No assessment activity yet. Encourage this student to complete course assessments.';
  if (avgScore >= 8.5) return `Strong performance trend with ${completedCourses} completed courses. Recommend advanced materials.`;
  if (avgScore >= 6) return `Steady progress with ${attemptCount} assessments submitted. Focus on consistency to improve scores.`;
  return `Needs support: low average across ${attemptCount} assessments. Recommend revision sessions and guided practice.`;
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { courses, supabase } = useAuth();
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [studentScores, setStudentScores] = useState({});
  const [aiAnalyses, setAiAnalyses] = useState({});
  const [loadingScores, setLoadingScores] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const activeTab = searchParams.get('tab') === 'performance' ? 'performance' : 'courses';

  useEffect(() => {
    if (activeTab === 'performance') {
      fetchStudentPerformance();

      const poll = setInterval(() => {
        fetchStudentPerformance();
      }, 12000);

      const onFocus = () => fetchStudentPerformance();
      window.addEventListener('focus', onFocus);

      return () => {
        clearInterval(poll);
        window.removeEventListener('focus', onFocus);
      };
    }
  }, [activeTab, supabase]);

  const fetchStudentPerformance = async () => {
    try {
      setLoadingScores(true);
      const { data: enrollments, error: enrollErr } = await supabase
        .from('enrollments')
        .select('user_id, course_id');

      if (enrollErr) throw enrollErr;

      const uniqueUserIds = [...new Set(enrollments.map(e => e.user_id))];

      const { data: profiles, error: profileErr } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('id', uniqueUserIds);

      if (profileErr) throw profileErr;

      setStudents(
        profiles
          .filter((p) => p.role === 'student')
          .map((p) => ({
            ...p,
            full_name: (p.full_name || '').trim() || 'Unnamed Student',
          }))
      );

      const { data: resultData, error: resultErr } = await supabase
        .from(ASSESSMENT_TABLE)
        .select('user_id, course_id, attempted_at, total_score, total_questions, course_completed, ai_feedback')
        .in('user_id', uniqueUserIds);

      if (resultErr) {
        setStudentScores({});
        setAiAnalyses({});
        setLastUpdatedAt(new Date().toISOString());
        return;
      }

      const scoresMap = {};
      const analyses = {};

      resultData?.forEach(row => {
        if (!scoresMap[row.user_id]) {
          scoresMap[row.user_id] = {
            totalScore: 0,
            totalQuestions: 0,
            attemptCount: 0,
            completedCourses: new Set(),
            latestFeedback: '',
            latestAt: null,
          };
        }

        const score = Number(row.total_score || 0);
        const total = Number(row.total_questions || 0);
        scoresMap[row.user_id].totalScore += score;
        scoresMap[row.user_id].totalQuestions += total;
        scoresMap[row.user_id].attemptCount += 1;

        if (row.course_completed && row.course_id) {
          scoresMap[row.user_id].completedCourses.add(row.course_id);
        }

        if (!scoresMap[row.user_id].latestAt || new Date(row.attempted_at) > new Date(scoresMap[row.user_id].latestAt)) {
          scoresMap[row.user_id].latestAt = row.attempted_at;
          scoresMap[row.user_id].latestFeedback = row.ai_feedback || '';
        }
      });

      Object.keys(scoresMap).forEach((userId) => {
        const entry = scoresMap[userId];
        const avgOutOfTen = entry.totalQuestions > 0 ? ((entry.totalScore / entry.totalQuestions) * 10) : 0;
        analyses[userId] = entry.latestFeedback || buildDefaultAnalysis(avgOutOfTen, entry.attemptCount, entry.completedCourses.size);
      });

      setStudentScores(scoresMap);
      setAiAnalyses(analyses);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      alert('Error fetching student performance: ' + err.message);
    } finally {
      setLoadingScores(false);
    }
  };

  const handleDeleteCourse = async (courseId) => {
    if (!window.confirm('Are you sure you want to delete this course?')) return;

    try {
      setLoading(true);
      await supabase.from('courses').delete().eq('id', courseId);
      // Refresh courses
      alert('Course deleted successfully');
    } catch (err) {
      alert('Error deleting course: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl page-enter">
      {/* Header */}
      <div className="mb-12">
        <div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 italic mb-2">ADMIN HUB</h1>
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">
            {activeTab === 'performance' ? 'Track student quiz performance' : 'Manage your courses'}
          </p>
          {activeTab === 'performance' && (
            <p className="text-xs text-teal-700 font-bold mt-2 uppercase tracking-wider">
              Live updates {lastUpdatedAt ? `| Last refresh ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* Courses View */}
      {activeTab === 'courses' && (
      <div className="space-y-4">
        <h2 className="text-2xl font-black text-slate-900 mb-6">Your Courses</h2>
        {courses.length === 0 ? (
          <div className="text-center py-20 app-panel rounded-3xl">
            <Activity className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 text-lg font-semibold">No courses yet. Create your first course to get started!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
            {courses.map(course => (
              <div key={course.id} className="app-panel rounded-3xl p-6 hover:border-teal-500 transition-all hover-lift">
                <h3 className="text-lg font-black text-slate-900 mb-2 line-clamp-2">{course.title}</h3>
                <p className="text-slate-600 text-sm mb-4 line-clamp-2">{course.description}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate(`/course/${course.id}`)}
                    className="flex-1 px-4 py-2 bg-teal-700 hover:bg-teal-600 text-white font-black text-xs rounded-xl uppercase transition-all"
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleDeleteCourse(course.id)}
                    disabled={loading}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-black text-xs rounded-xl uppercase transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Student Performance View */}
      {activeTab === 'performance' && (
      <div className="space-y-6">
        {loadingScores ? (
          <div className="text-center py-20">
            <Loader className="w-12 h-12 text-teal-700 mx-auto animate-spin mb-4" />
            <p className="text-slate-500 text-lg">Loading student performance data...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-20 app-panel rounded-3xl">
            <Users className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 text-lg font-semibold">No enrolled students yet</p>
          </div>
        ) : (
          <div className="space-y-4 animate-stagger">
            {students.map(student => {
              const scores = studentScores[student.id];
              const avgScoreValue = scores && scores.totalQuestions > 0 ? ((scores.totalScore / scores.totalQuestions) * 10) : 0;
              const avgScore = scores && scores.totalQuestions > 0 ? avgScoreValue.toFixed(1) : 'N/A';
              const quizCount = scores?.attemptCount || 0;
              const completedCourses = scores?.completedCourses?.size || 0;
              const aiAnalysis = aiAnalyses[student.id];

              return (
                <div key={student.id} className="app-panel rounded-2xl p-6 hover:border-cyan-500 transition-all hover-lift">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase mb-1">Student Name</p>
                      <p className="text-slate-900 font-bold text-sm">{student.full_name}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase mb-1">Assessments Submitted</p>
                      <div className="flex items-center gap-2">
                        <p className="text-slate-900 font-black text-2xl">{quizCount}</p>
                        <Activity className="w-5 h-5 text-teal-700" />
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase mb-1">Average Score</p>
                      <div className="flex items-center gap-2">
                        <p className="text-slate-900 font-black text-2xl">{avgScore}</p>
                        <span className="text-slate-500 text-sm">/10</span>
                        <TrendingUp className="w-5 h-5 text-green-400" />
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase mb-1">Completed Courses</p>
                      <p className="text-slate-900 font-black text-2xl">{completedCourses}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase mb-1">Performance</p>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            avgScoreValue >= 8 ? 'bg-green-500' : avgScoreValue >= 6 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${quizCount > 0 ? Math.max(4, (avgScoreValue / 10) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {aiAnalysis && (
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                      <p className="text-slate-500 text-xs font-bold uppercase mb-2 flex items-center gap-2">
                        <BarChart2 className="w-4 h-4" />
                        AI Analysis
                      </p>
                      <p className="text-slate-700 text-sm leading-relaxed">{aiAnalysis}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
