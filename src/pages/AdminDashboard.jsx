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

      const channel = supabase
        .channel('admin_performance_live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: ASSESSMENT_TABLE }, fetchStudentPerformance)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: ASSESSMENT_TABLE }, fetchStudentPerformance)
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
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
        .select('id, email, role')
        .in('id', uniqueUserIds);

      if (profileErr) throw profileErr;

      setStudents(profiles.filter(p => p.role === 'student'));

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
    <div className="max-w-6xl page-enter">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-1">Admin Dashboard</h1>
        <p className="text-slate-500 text-sm">
          {activeTab === 'performance' ? 'Track student quiz performance' : 'Manage and organize your courses'}
        </p>
        {activeTab === 'performance' && lastUpdatedAt && (
          <p className="text-xs text-teal-600 font-medium mt-2">
            Last updated: {new Date(lastUpdatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Courses View */}
      {activeTab === 'courses' && (
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-900">Your Courses</h2>
          <span className="text-sm text-slate-500">{courses.length} courses</span>
        </div>
        {courses.length === 0 ? (
          <div className="text-center py-16 bg-white border border-slate-200 rounded-xl">
            <Activity className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">No courses yet</p>
            <p className="text-slate-400 text-sm">Create your first course to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {courses.map(course => (
              <div key={course.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-lg hover:border-slate-300 transition-all">
                <h3 className="text-base font-semibold text-slate-900 mb-2 line-clamp-2">{course.title}</h3>
                <p className="text-slate-500 text-sm mb-4 line-clamp-2">{course.description}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate(`/course/${course.id}`)}
                    className="flex-1 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-lg transition-all"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteCourse(course.id)}
                    disabled={loading}
                    className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-all disabled:opacity-50"
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
      <div>
        {loadingScores ? (
          <div className="text-center py-16">
            <Loader className="w-8 h-8 text-teal-600 mx-auto animate-spin mb-3" />
            <p className="text-slate-500 text-sm">Loading student performance...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-16 bg-white border border-slate-200 rounded-xl">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">No enrolled students yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {students.map(student => {
              const scores = studentScores[student.id];
              const avgScoreValue = scores && scores.totalQuestions > 0 ? ((scores.totalScore / scores.totalQuestions) * 10) : 0;
              const avgScore = scores && scores.totalQuestions > 0 ? avgScoreValue.toFixed(1) : 'N/A';
              const quizCount = scores?.attemptCount || 0;
              const completedCourses = scores?.completedCourses?.size || 0;
              const aiAnalysis = aiAnalyses[student.id];

              return (
                <div key={student.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-all">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div className="col-span-2 md:col-span-1">
                      <p className="text-slate-400 text-xs font-medium mb-1">Student</p>
                      <p className="text-slate-900 font-medium text-sm truncate">{student.email}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs font-medium mb-1">Assessments</p>
                      <div className="flex items-center gap-2">
                        <p className="text-slate-900 font-bold text-xl">{quizCount}</p>
                        <Activity className="w-4 h-4 text-teal-600" />
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs font-medium mb-1">Avg Score</p>
                      <div className="flex items-center gap-1">
                        <p className="text-slate-900 font-bold text-xl">{avgScore}</p>
                        <span className="text-slate-400 text-sm">/10</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs font-medium mb-1">Completed</p>
                      <p className="text-slate-900 font-bold text-xl">{completedCourses}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs font-medium mb-2">Progress</p>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            avgScoreValue >= 8 ? 'bg-emerald-500' : avgScoreValue >= 6 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${quizCount > 0 ? Math.max(4, (avgScoreValue / 10) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {aiAnalysis && (
                    <div className="bg-slate-50 rounded-lg p-4 mt-4">
                      <p className="text-slate-500 text-xs font-medium mb-2 flex items-center gap-1.5">
                        <BarChart2 className="w-3.5 h-3.5" />
                        AI Analysis
                      </p>
                      <p className="text-slate-600 text-sm leading-relaxed">{aiAnalysis}</p>
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
