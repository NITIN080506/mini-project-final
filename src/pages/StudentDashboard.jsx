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
        // First check for explicit completion flag (saved after course is fully completed)
        const completionFlagKey = `course-completed-${course.id}-${user.id}`;
        const completionFlag = localStorage.getItem(completionFlagKey);
        
        if (completionFlag) {
          try {
            const flagData = JSON.parse(completionFlag);
            if (flagData.completed === true) {
              localMap[course.id] = true;
              return;
            }
          } catch (err) {
            // Fall through to check results
          }
        }
        
        // Fall back to checking if all pages have assessment results
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
          .select('*')
          .eq('user_id', user.id);

        const merged = { ...localMap };
        (data || []).forEach((entry) => {
          // Mark as completed if: explicitly marked OR completion_percent >= 100
          const isCompleted = Boolean(entry.course_completed) || Number(entry.completion_percent || 0) >= 100;
          if (isCompleted) {
            merged[entry.course_id] = true;
            // Also save to localStorage as backup if DB says it's complete
            const completionFlagKey = `course-completed-${entry.course_id}-${user.id}`;
            localStorage.setItem(completionFlagKey, JSON.stringify({
              completed: true,
              completedAt: entry.attempted_at || new Date().toISOString(),
              completionPercent: entry.completion_percent
            }));
          }
        });

        setCourseCompletionMap(merged);
      } catch (err) {
        console.error('Failed to fetch completion status from database:', err);
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
    <div className="max-w-7xl page-enter">
      {/* Header */}
      <div className="mb-12">
        <div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 italic mb-2">STUDENT PORTAL</h1>
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Focus, progress, and consistent daily growth</p>
        </div>
      </div>

      {(activeTab === 'overview' || activeTab === 'my-courses' || activeTab === 'browse') && (
      <div className="mb-12">
        <div className="relative max-w-2xl">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search courses..."
            className="w-full bg-white border border-slate-300 rounded-2xl pl-12 pr-6 py-4 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 font-semibold"
          />
        </div>
      </div>
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12 animate-stagger">
          <div className="app-panel rounded-2xl p-5 hover-lift">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Enrolled</p>
            <p className="text-3xl font-black text-slate-900">{enrolledCourses.length}</p>
          </div>
          <div className="app-panel rounded-2xl p-5 hover-lift">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Available</p>
            <p className="text-3xl font-black text-slate-900">{availableCourses.length}</p>
          </div>
          <div className="app-panel rounded-2xl p-5 hover-lift">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Daily Streak</p>
            <p className="text-3xl font-black text-teal-700">5 Days</p>
          </div>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'my-courses') && (
      <>
        {activeTab === 'overview' && enrolledCourses.length > 0 && (
          <div className="mb-16">
            <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-teal-700" />
              Enrolled Courses
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
              {enrolledCourses.map(course => (
                (() => {
                  const isCompleted = Boolean(courseCompletionMap[course.id]);
                  return (
                <div
                  key={course.id}
                  onClick={() => handleSelectCourse(course)}
                  className={`app-panel rounded-3xl overflow-hidden cursor-pointer transition-all group hover-lift ${isCompleted ? 'hover:border-emerald-500' : 'hover:border-teal-600'}`}
                >
                  <div className="p-6 space-y-4">
                    {isCompleted && (
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-wider">
                        <CheckCircle2 className="w-3 h-3" /> Completed
                      </div>
                    )}
                    <h3 className="text-xl font-black text-slate-900 group-hover:text-teal-700 transition-colors line-clamp-2">{course.title}</h3>
                    <p className="text-slate-600 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
                    <button className={`w-full text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${isCompleted ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500' : 'bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-600 hover:to-cyan-600'}`}>
                      <Play className="w-4 h-4" />
                      {isCompleted ? 'Review Course' : 'Continue Learning'}
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
          <div className="space-y-10 mb-16">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setMyCoursesFilter('in-progress')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  myCoursesFilter === 'in-progress'
                    ? 'bg-cyan-700 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:border-cyan-400'
                }`}
              >
                In Progress ({inProgressEnrolledCourses.length})
              </button>
              <button
                type="button"
                onClick={() => setMyCoursesFilter('completed')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  myCoursesFilter === 'completed'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:border-emerald-400'
                }`}
              >
                Completed Courses ({completedEnrolledCourses.length})
              </button>
            </div>

            {myCoursesFilter === 'in-progress' && (
            <div>
              <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
                <Clock3 className="w-6 h-6 text-cyan-700" />
                In Progress
              </h2>
              {inProgressEnrolledCourses.length === 0 ? (
                <div className="app-panel rounded-2xl p-5 text-slate-500 font-semibold">No in-progress courses.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
                  {inProgressEnrolledCourses.map(course => (
                    <div
                      key={course.id}
                      onClick={() => handleSelectCourse(course)}
                      className="app-panel rounded-3xl overflow-hidden hover:border-cyan-600 cursor-pointer transition-all group hover-lift"
                    >
                      <div className="p-6 space-y-4">
                        <h3 className="text-xl font-black text-slate-900 group-hover:text-cyan-700 transition-colors line-clamp-2">{course.title}</h3>
                        <p className="text-slate-600 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
                        <button className="w-full bg-gradient-to-r from-cyan-700 to-sky-700 hover:from-cyan-600 hover:to-sky-600 text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                          <Play className="w-4 h-4" />
                          Continue Learning
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
              <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                Completed Courses
              </h2>
              {completedEnrolledCourses.length === 0 ? (
                <div className="app-panel rounded-2xl p-5 text-slate-500 font-semibold">No completed courses yet.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
                  {completedEnrolledCourses.map(course => (
                    <div
                      key={course.id}
                      onClick={() => handleSelectCourse(course)}
                      className="app-panel rounded-3xl overflow-hidden border-emerald-200 hover:border-emerald-400 cursor-pointer transition-all group hover-lift"
                    >
                      <div className="p-6 space-y-4">
                        <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-wider">
                          <CheckCircle2 className="w-3 h-3" /> Completed
                        </div>
                        <h3 className="text-xl font-black text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-2">{course.title}</h3>
                        <p className="text-slate-600 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
                        <button className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                          <Play className="w-4 h-4" />
                          Review Course
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
            <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
              <Compass className="w-6 h-6 text-cyan-700" />
              Explore More Courses
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
              {availableCourses.map(course => (
                <div
                  key={course.id}
                  className="app-panel rounded-3xl overflow-hidden hover:border-cyan-600 transition-all group hover-lift"
                >
                  <div className="p-6 space-y-4">
                    <h3 className="text-xl font-black text-slate-900 group-hover:text-cyan-700 transition-colors line-clamp-2">{course.title}</h3>
                    <p className="text-slate-600 text-sm line-clamp-3 leading-relaxed">{course.description}</p>
                    <button
                      onClick={() => enrollCourse(course.id)}
                      className="w-full bg-gradient-to-r from-cyan-700 to-sky-700 hover:from-cyan-600 hover:to-sky-600 text-white font-black text-xs rounded-xl py-3 uppercase tracking-wider transition-all"
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
        <div className="app-panel rounded-3xl p-6 md:p-8">
          <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            Daily Rankings
          </h2>
          <p className="text-slate-500 text-sm mb-6">Top activity snapshots from your enrolled courses today.</p>

          {rankingRows.length === 0 ? (
            <p className="text-slate-500">Enroll in a course to join the rankings.</p>
          ) : (
            <div className="space-y-3">
              {rankingRows.map((row, idx) => (
                <div key={row.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 font-black text-sm grid place-items-center">#{idx + 1}</div>
                    <div>
                      <p className="font-bold text-slate-900 text-sm">{row.title}</p>
                      <p className="text-xs text-slate-500">{row.streak} day streak</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-amber-500 font-black text-sm">
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
        <div className="app-panel rounded-3xl p-6 md:p-8">
          <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-teal-700" />
            My Results
          </h2>
          <p className="text-slate-500 text-sm mb-6">Live performance updates from your completed assessments.</p>

          {resultsLoading ? (
            <div className="py-10 text-center text-slate-500 font-semibold flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
              Loading your results...
            </div>
          ) : resultRows.length === 0 ? (
            <p className="text-slate-500">No results yet. Complete assessments inside a course to see your performance.</p>
          ) : (
            <div className="space-y-3">
              {resultRows.map((row) => (
                <div key={row.id} className="bg-white border border-slate-200 rounded-xl px-4 py-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900 text-sm">{row.title}</p>
                      <p className="text-xs text-slate-500">
                        Score {row.totalScore}/{row.totalQuestions || 0} | Pages {row.completedPages}/{row.totalPages || 0}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-teal-700">{row.completionPercent}%</p>
                      <p className={`text-[11px] font-bold uppercase ${row.isCompleted ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {row.isCompleted ? 'Course Completed' : 'In Progress'}
                      </p>
                    </div>
                  </div>
                  {row.feedback && (
                    <p className="text-xs text-slate-600 mt-2 border-t border-slate-100 pt-2">AI Coach: {row.feedback}</p>
                  )}
                  {row.source === 'local' && (
                    <p className="text-[11px] text-amber-600 mt-2">Waiting to sync to server. Your local result is saved.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(activeTab !== 'daily-rankings' && activeTab !== 'my-results' && filteredCourses.length === 0) && (
          <div className="text-center py-20">
            <p className="text-slate-500 text-lg font-semibold">No courses found</p>
          </div>
      )}
    </div>
  );
}
