import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BookOpen, Search, Play, Compass, Trophy, Star, Loader2, BarChart3, CheckCircle2, Clock3 } from 'lucide-react';

const ASSESSMENT_TABLE = 'student_assessment_results';

export default function StudentDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { courses, enrollments, enrollCourse, supabase, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [resultRows, setResultRows] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [courseCompletionMap, setCourseCompletionMap] = useState({});
  const [myCoursesFilter, setMyCoursesFilter] = useState('in-progress');
  const activeTab = searchParams.get('tab') || 'overview';
  
  const filteredCourses = courses.filter(c => 
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const enrolledCourses = filteredCourses.filter(c => enrollments.includes(c.id));
  const availableCourses = filteredCourses.filter(c => !enrollments.includes(c.id));
  const completedEnrolledCourses = enrolledCourses.filter((course) => Boolean(courseCompletionMap[course.id]));
  const inProgressEnrolledCourses = enrolledCourses.filter((course) => !courseCompletionMap[course.id]);

  const handleSelectCourse = (course) => {
    navigate(`/course/${course.id}`);
  };

  const rankingRows = enrolledCourses.slice(0, 5).map((course, index) => ({
    id: course.id,
    title: course.title,
    streak: 7 - index,
    xp: 860 - index * 75,
  }));

  useEffect(() => {
    if (!user?.id || !courses.length) {
      setCourseCompletionMap({});
      return;
    }

    const getCoursePageCount = (course) => {
      try {
        const parsed = JSON.parse(course?.material || '{}');
        return Array.isArray(parsed?.pages) ? parsed.pages.length : 0;
      } catch (err) {
        return 0;
      }
    };

    const buildLocalCompletionMap = () => {
      const localMap = {};
      courses.forEach((course) => {
        const key = `course-results-${course.id}-${user.id}`;
        const raw = localStorage.getItem(key);
        if (!raw) {
          localMap[course.id] = false;
          return;
        }

        try {
          const parsed = JSON.parse(raw);
          const completedPages = Object.keys(parsed || {}).length;
          const totalPages = getCoursePageCount(course);
          localMap[course.id] = totalPages > 0 ? completedPages >= totalPages : completedPages > 0;
        } catch (err) {
          localMap[course.id] = false;
        }
      });
      return localMap;
    };

    const refreshCompletionMap = async () => {
      const localMap = buildLocalCompletionMap();

      if (!supabase) {
        setCourseCompletionMap(localMap);
        return;
      }

      try {
        const { data } = await supabase
          .from(ASSESSMENT_TABLE)
          .select('course_id, course_completed, completion_percent')
          .eq('user_id', user.id);

        const merged = { ...localMap };
        (data || []).forEach((entry) => {
          const isCompleted = Boolean(entry.course_completed) || Number(entry.completion_percent || 0) >= 100;
          if (isCompleted) merged[entry.course_id] = true;
        });

        setCourseCompletionMap(merged);
      } catch (err) {
        // Table not ready or query failed: keep local completion only.
        setCourseCompletionMap(localMap);
      }
    };

    refreshCompletionMap();

    if (!supabase) return;

    const channel = supabase
      .channel('student_course_completion_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: ASSESSMENT_TABLE, filter: `user_id=eq.${user.id}` }, refreshCompletionMap)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: ASSESSMENT_TABLE, filter: `user_id=eq.${user.id}` }, refreshCompletionMap)
      .subscribe();

    const handleFocus = () => refreshCompletionMap();
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      supabase.removeChannel(channel);
    };
  }, [courses, user?.id, supabase]);

  useEffect(() => {
    if (activeTab !== 'my-results' || !supabase || !user?.id) return;

    const getCoursePageCount = (course) => {
      try {
        const parsed = JSON.parse(course?.material || '{}');
        return Array.isArray(parsed?.pages) ? parsed.pages.length : 0;
      } catch (err) {
        return 0;
      }
    };

    const getLocalRows = () => {
      const rows = [];
      courses.forEach((course) => {
        const key = `course-results-${course.id}-${user.id}`;
        const raw = localStorage.getItem(key);
        if (!raw) return;

        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object') return;

          const entries = Object.values(parsed);
          if (entries.length === 0) return;

          const totalScore = entries.reduce((acc, item) => acc + Number(item?.score || 0), 0);
          const totalQuestions = entries.reduce((acc, item) => acc + Number(item?.total || 0), 0);
          const completedPages = entries.length;
          const totalPages = getCoursePageCount(course) || completedPages;
          const latestAttempt = entries.reduce((latest, item) => {
            const t = item?.attemptedAt ? new Date(item.attemptedAt).getTime() : 0;
            return t > latest ? t : latest;
          }, 0);

          rows.push({
            id: `local-${course.id}`,
            courseId: course.id,
            title: course.title || 'Untitled Course',
            totalScore,
            totalQuestions,
            completionPercent: totalQuestions > 0 ? Math.round((totalScore / totalQuestions) * 100) : 0,
            completedPages,
            totalPages,
            isCompleted: completedPages >= totalPages,
            feedback: '',
            createdAt: latestAttempt ? new Date(latestAttempt).toISOString() : new Date().toISOString(),
            source: 'local',
          });
        } catch (err) {
          // Ignore malformed local cache entries.
        }
      });
      return rows;
    };

    const mapRows = (records) => {
      const byCourse = {};
      records.forEach((item) => {
        const courseKey = item.course_id;
        if (!byCourse[courseKey] || new Date(item.attempted_at) > new Date(byCourse[courseKey].attempted_at)) {
          byCourse[courseKey] = item;
        }
      });

      const rows = Object.values(byCourse).map((item) => {
        const courseInfo = courses.find((course) => course.id === item.course_id);
        return {
          id: item.course_id,
          courseId: item.course_id,
          title: item.course_title || courseInfo?.title || 'Untitled Course',
          totalScore: item.total_score || 0,
          totalQuestions: item.total_questions || 0,
          completionPercent: item.completion_percent || 0,
          isCompleted: Boolean(item.course_completed),
          feedback: item.ai_feedback || '',
          createdAt: item.attempted_at,
          source: 'server',
        };
      });

      const localRows = getLocalRows();
      localRows.forEach((localRow) => {
        const existing = rows.find((row) => row.courseId === localRow.courseId);
        if (!existing) {
          rows.push(localRow);
          return;
        }

        if (new Date(localRow.createdAt) > new Date(existing.createdAt)) {
          const index = rows.findIndex((row) => row.courseId === localRow.courseId);
          if (index >= 0) rows[index] = localRow;
        }
      });

      rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setResultRows(rows);
    };

    const fetchResults = async () => {
      setResultsLoading(true);
      try {
        const { data } = await supabase
          .from(ASSESSMENT_TABLE)
          .select('course_id, attempted_at, course_title, total_score, total_questions, completion_percent, course_completed, ai_feedback')
          .eq('user_id', user.id)
          .order('attempted_at', { ascending: false });
        mapRows(data || []);
      } catch (err) {
        // Table not ready or query failed: show local rows only.
        mapRows([]);
      } finally {
        setResultsLoading(false);
      }
    };

    fetchResults();

    const channel = supabase
      .channel('student_results_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: ASSESSMENT_TABLE, filter: `user_id=eq.${user.id}` }, fetchResults)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: ASSESSMENT_TABLE, filter: `user_id=eq.${user.id}` }, fetchResults)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab, supabase, user?.id, courses]);

  return (
    <div className="max-w-6xl page-enter">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-1">Student Dashboard</h1>
        <p className="text-slate-500 text-sm">Track your progress and continue learning</p>
      </div>

      {(activeTab === 'overview' || activeTab === 'my-courses' || activeTab === 'browse') && (
      <div className="mb-8">
        <div className="relative max-w-md">
          <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search courses..."
            className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-4 py-2.5 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm"
          />
        </div>
      </div>
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-500 text-sm font-medium">Enrolled Courses</span>
              <BookOpen className="w-5 h-5 text-teal-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{enrolledCourses.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-500 text-sm font-medium">Available</span>
              <Compass className="w-5 h-5 text-indigo-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{availableCourses.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-500 text-sm font-medium">Daily Streak</span>
              <Trophy className="w-5 h-5 text-amber-500" />
            </div>
            <p className="text-3xl font-bold text-teal-600">5 Days</p>
          </div>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'my-courses') && (
      <>
        {activeTab === 'overview' && enrolledCourses.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-slate-900">My Courses</h2>
              <span className="text-sm text-slate-500">{enrolledCourses.length} enrolled</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {enrolledCourses.map(course => (
                (() => {
                  const isCompleted = Boolean(courseCompletionMap[course.id]);
                  return (
                <div
                  key={course.id}
                  onClick={() => handleSelectCourse(course)}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:border-slate-300 group"
                >
                  <div className="p-5">
                    {isCompleted && (
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-600 px-2.5 py-1 text-xs font-semibold mb-3">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                      </div>
                    )}
                    <h3 className="text-base font-semibold text-slate-900 group-hover:text-teal-600 transition-colors line-clamp-2 mb-2">{course.title}</h3>
                    <p className="text-slate-500 text-sm line-clamp-2 leading-relaxed mb-4">{course.description}</p>
                    <button className={`w-full font-semibold text-sm rounded-lg py-2.5 transition-all flex items-center justify-center gap-2 ${
                      isCompleted 
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white' 
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}>
                      <Play className="w-4 h-4" />
                      {isCompleted ? 'Review' : 'Continue'}
                    </button>
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
          </div>
        )}

        {activeTab === 'my-courses' && (
          <div className="space-y-8 mb-12">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMyCoursesFilter('in-progress')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  myCoursesFilter === 'in-progress'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                In Progress ({inProgressEnrolledCourses.length})
              </button>
              <button
                type="button"
                onClick={() => setMyCoursesFilter('completed')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  myCoursesFilter === 'completed'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                Completed ({completedEnrolledCourses.length})
              </button>
            </div>

            {myCoursesFilter === 'in-progress' && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-5 flex items-center gap-2">
                <Clock3 className="w-5 h-5 text-slate-400" />
                In Progress
              </h2>
              {inProgressEnrolledCourses.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-slate-500 text-center">No in-progress courses.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {inProgressEnrolledCourses.map(course => (
                    <div
                      key={course.id}
                      onClick={() => handleSelectCourse(course)}
                      className="bg-white border border-slate-200 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:border-slate-300 group"
                    >
                      <div className="p-5">
                        <h3 className="text-base font-semibold text-slate-900 group-hover:text-teal-600 transition-colors line-clamp-2 mb-2">{course.title}</h3>
                        <p className="text-slate-500 text-sm line-clamp-2 leading-relaxed mb-4">{course.description}</p>
                        <button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-lg py-2.5 transition-all flex items-center justify-center gap-2">
                          <Play className="w-4 h-4" />
                          Continue
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {myCoursesFilter === 'completed' && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-5 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                Completed Courses
              </h2>
              {completedEnrolledCourses.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-slate-500 text-center">No completed courses yet.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {completedEnrolledCourses.map(course => (
                    <div
                      key={course.id}
                      onClick={() => handleSelectCourse(course)}
                      className="bg-white border border-slate-200 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:border-emerald-200 group"
                    >
                      <div className="p-5">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-600 px-2.5 py-1 text-xs font-semibold mb-3">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                        </div>
                        <h3 className="text-base font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors line-clamp-2 mb-2">{course.title}</h3>
                        <p className="text-slate-500 text-sm line-clamp-2 leading-relaxed mb-4">{course.description}</p>
                        <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-lg py-2.5 transition-all flex items-center justify-center gap-2">
                          <Play className="w-4 h-4" />
                          Review
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        )}
      </>
      )}

      {(activeTab === 'overview' || activeTab === 'browse') && (
      <>
        {availableCourses.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-slate-900">Explore Courses</h2>
              <span className="text-sm text-slate-500">{availableCourses.length} available</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {availableCourses.map(course => (
                <div
                  key={course.id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-lg hover:border-slate-300 transition-all group"
                >
                  <div className="p-5">
                    <h3 className="text-base font-semibold text-slate-900 group-hover:text-teal-600 transition-colors line-clamp-2 mb-2">{course.title}</h3>
                    <p className="text-slate-500 text-sm line-clamp-2 leading-relaxed mb-4">{course.description}</p>
                    <button
                      onClick={() => enrollCourse(course.id)}
                      className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm rounded-lg py-2.5 transition-all"
                    >
                      Enroll Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
      )}

      {activeTab === 'daily-rankings' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
              <Trophy className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Daily Rankings</h2>
              <p className="text-slate-500 text-sm">Top activity from your enrolled courses</p>
            </div>
          </div>

          {rankingRows.length === 0 ? (
            <p className="text-slate-500 text-sm">Enroll in a course to join the rankings.</p>
          ) : (
            <div className="space-y-2">
              {rankingRows.map((row, idx) => (
                <div key={row.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 font-semibold text-sm grid place-items-center">#{idx + 1}</div>
                    <div>
                      <p className="font-medium text-slate-900 text-sm">{row.title}</p>
                      <p className="text-xs text-slate-500">{row.streak} day streak</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-amber-600 font-semibold text-sm">
                    <Star className="w-4 h-4" />
                    {row.xp} XP
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'my-results' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">My Results</h2>
              <p className="text-slate-500 text-sm">Performance from your completed assessments</p>
            </div>
          </div>

          {resultsLoading ? (
            <div className="py-10 text-center text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
              <span className="text-sm">Loading your results...</span>
            </div>
          ) : resultRows.length === 0 ? (
            <p className="text-slate-500 text-sm">No results yet. Complete assessments inside a course to see your performance.</p>
          ) : (
            <div className="space-y-2">
              {resultRows.map((row) => (
                <div key={row.id} className="bg-slate-50 rounded-lg px-4 py-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900 text-sm">{row.title}</p>
                      <p className="text-xs text-slate-500">
                        Score {row.totalScore}/{row.totalQuestions || 0} | Pages {row.completedPages}/{row.totalPages || 0}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-teal-600">{row.completionPercent}%</p>
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                        row.isCompleted ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {row.isCompleted ? 'Completed' : 'In Progress'}
                      </span>
                    </div>
                  </div>
                  {row.feedback && (
                    <p className="text-xs text-slate-600 mt-3 pt-3 border-t border-slate-200">AI Coach: {row.feedback}</p>
                  )}
                  {row.source === 'local' && (
                    <p className="text-xs text-amber-600 mt-2">Waiting to sync to server.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(activeTab !== 'daily-rankings' && activeTab !== 'my-results' && filteredCourses.length === 0) && (
          <div className="text-center py-16">
            <p className="text-slate-500">No courses found</p>
          </div>
      )}
    </div>
  );
}
