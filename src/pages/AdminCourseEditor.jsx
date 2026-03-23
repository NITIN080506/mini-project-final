import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { extractTextFromDocument, splitTextIntoPages, GROQ_API_KEY, GROQ_MODEL } from '../utils/helpers';
import { ArrowLeft, Save, Trash2, Edit2, FileText, Video, BookOpen, Eye, Upload, Loader2, X } from 'lucide-react';

export default function AdminCourseEditor() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { courses, supabase } = useAuth();
  
  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Course basic info
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [material, setMaterial] = useState('');
  
  // For editing specific sections
  const [editMode, setEditMode] = useState(null); // 'basic' | 'video-update' | 'video-view' | 'material-view' | 'material-update' | 'material-upload'
  
  // File upload state
  const [uploadFile, setUploadFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  
  // Video update method state
  const [videoUpdateMethod, setVideoUpdateMethod] = useState(null); // 'link' or 'upload'
  const [newVideoFile, setNewVideoFile] = useState(null);

  useEffect(() => {
    const foundCourse = courses.find(c => c.id === courseId);
    if (foundCourse) {
      setCourse(foundCourse);
      setTitle(foundCourse.title || '');
      setDescription(foundCourse.description || '');
      setVideoUrl(foundCourse.video_url || '');
      setMaterial(foundCourse.material || '');
    }
    setLoading(false);
  }, [courseId, courses]);

  const handleSaveBasicInfo = async () => {
    if (!title.trim()) {
      alert('Course title is required');
      return;
    }
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('courses')
        .update({ title, description })
        .eq('id', courseId);
      
      if (error) throw error;
      alert('Course information updated successfully!');
      setEditMode(null);
    } catch (err) {
      alert('Error updating course: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveVideo = async () => {
    if (videoUpdateMethod === 'link') {
      if (!videoUrl.trim()) {
        alert('Please enter a video URL');
        return;
      }
      setSaving(true);
      try {
        const { error } = await supabase
          .from('courses')
          .update({ video_url: videoUrl })
          .eq('id', courseId);
        
        if (error) throw error;
        alert('Video URL updated successfully!');
        setCourse({ ...course, video_url: videoUrl });
        setEditMode(null);
        setVideoUpdateMethod(null);
      } catch (err) {
        alert('Error updating video: ' + err.message);
      } finally {
        setSaving(false);
      }
    } else if (videoUpdateMethod === 'upload') {
      if (!newVideoFile) {
        alert('Please select a video file');
        return;
      }
      setSaving(true);
      try {
        const fileExt = newVideoFile.name.split('.').pop();
        const fileName = `${courseId}-${Date.now()}.${fileExt}`;
        const { data, error: uploadError } = await supabase
          .storage
          .from('videos')
          .upload(fileName, newVideoFile);

        if (uploadError) throw uploadError;

        const { data: publicData } = supabase
          .storage
          .from('videos')
          .getPublicUrl(fileName);

        const newUrl = publicData.publicUrl;

        const { error: updateError } = await supabase
          .from('courses')
          .update({ video_url: newUrl })
          .eq('id', courseId);

        if (updateError) throw updateError;

        setVideoUrl(newUrl);
        setCourse({ ...course, video_url: newUrl });
        alert('Video uploaded and updated successfully!');
        setEditMode(null);
        setVideoUpdateMethod(null);
        setNewVideoFile(null);
      } catch (err) {
        alert('Error uploading video: ' + err.message);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDeleteVideo = async () => {
    if (!window.confirm('Are you sure you want to delete the video?')) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('courses')
        .update({ video_url: '' })
        .eq('id', courseId);
      
      if (error) throw error;
      setVideoUrl('');
      setCourse({ ...course, video_url: '' });
      alert('Video deleted successfully!');
      setEditMode(null);
    } catch (err) {
      alert('Error deleting video: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMaterial = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('courses')
        .update({ material })
        .eq('id', courseId);
      
      if (error) throw error;
      alert('Course materials updated successfully!');
      setCourse({ ...course, material });
      setEditMode(null);
    } catch (err) {
      alert('Error updating materials: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMaterial = async () => {
    if (!window.confirm('Are you sure you want to delete all course materials?')) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('courses')
        .update({ material: '' })
        .eq('id', courseId);
      
      if (error) throw error;
      setMaterial('');
      setCourse({ ...course, material: '' });
      alert('Materials deleted successfully!');
      setEditMode(null);
    } catch (err) {
      alert('Error deleting materials: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async () => {
    if (!uploadFile) {
      alert('Please select a file to upload');
      return;
    }

    setIsUploading(true);
    setUploadProgress('Extracting text from document...');

    try {
      const docText = await extractTextFromDocument(uploadFile);
      if (!docText || docText.trim().length < 50) {
        throw new Error('No readable text found in the document');
      }

      setUploadProgress('Generating course materials with AI...');
      const pageTexts = splitTextIntoPages(docText, 220);
      const pages = [];

      for (let i = 0; i < Math.min(pageTexts.length, 20); i++) {
        setUploadProgress(`Processing page ${i + 1} of ${Math.min(pageTexts.length, 20)}...`);
        const pageData = await generatePageWithAI(pageTexts[i], i + 1);
        pages.push(pageData);
      }

      const materialJson = JSON.stringify({ pages }, null, 2);
      
      setUploadProgress('Saving to database...');
      const { error } = await supabase
        .from('courses')
        .update({ material: materialJson })
        .eq('id', courseId);

      if (error) throw error;

      setMaterial(materialJson);
      setCourse({ ...course, material: materialJson });
      alert('Course materials generated and saved successfully!');
      setEditMode(null);
      setUploadFile(null);
    } catch (err) {
      alert('Error processing file: ' + err.message);
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  const generatePageWithAI = async (pageText, pageNum) => {
    try {
      const prompt = `You are an educational content creator. Based on the following text, create a structured learning page.

Text:
${pageText}

Return a JSON object with this exact structure:
{
  "title": "Brief title for this section (5-7 words)",
  "content": {
    "text": "A clear, educational summary of the text (100-150 words)",
    "assessment": {
      "quiz": {
        "question": "A thought-provoking multiple choice question about the content",
        "choices": ["Option A", "Option B", "Option C", "Option D"],
        "correct": 0
      },
      "fillBlank": {
        "question": "A sentence with a _____ blank to fill",
        "correct": "the correct answer word"
      }
    }
  }
}

Important: Return ONLY valid JSON, no markdown, no explanations.`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) throw new Error('AI generation failed');

      const data = await response.json();
      const aiContent = data.choices[0].message.content.trim();
      
      // Try to parse AI response
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // Fallback if AI fails
      return {
        title: `Page ${pageNum}`,
        content: {
          text: pageText.substring(0, 500),
          assessment: {
            quiz: {
              question: 'What is the main topic of this page?',
              choices: ['Topic A', 'Topic B', 'Topic C', 'Topic D'],
              correct: 0
            },
            fillBlank: {
              question: 'The main concept discussed is _____.',
              correct: 'concept'
            }
          }
        }
      };
    } catch (err) {
      console.error('AI generation error:', err);
      return {
        title: `Page ${pageNum}`,
        content: {
          text: pageText.substring(0, 500),
          assessment: {
            quiz: {
              question: 'What is covered in this section?',
              choices: ['Option A', 'Option B', 'Option C', 'Option D'],
              correct: 0
            },
            fillBlank: {
              question: 'This section covers _____.',
              correct: 'topic'
            }
          }
        }
      };
    }
  };

  const handleDeleteCourse = async () => {
    if (!window.confirm('Are you sure you want to delete this course? This action cannot be undone.')) {
      return;
    }
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('courses')
        .delete()
        .eq('id', courseId);
      
      if (error) throw error;
      alert('Course deleted successfully!');
      navigate('/admin');
    } catch (err) {
      alert('Error deleting course: ' + err.message);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="app-shell soft-grid min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-slate-300 border-t-teal-700 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-900 font-black text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="app-shell soft-grid min-h-screen flex items-center justify-center">
        <div className="app-panel panel-strong rounded-3xl p-8 text-center page-enter">
          <p className="text-slate-900 text-xl font-black">Course not found</p>
          <button onClick={() => navigate('/admin')} className="mt-4 px-6 py-3 bg-teal-700 hover:bg-teal-600 text-white rounded-xl font-bold transition-all hover:-translate-y-0.5">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell soft-grid min-h-screen p-6 md:p-8 page-enter">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate('/admin')}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:border-teal-400 text-slate-800 rounded-xl font-bold transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          <button
            onClick={handleDeleteCourse}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl font-black text-xs uppercase transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Delete Course
          </button>
        </div>

        <h1 className="text-4xl font-black text-slate-900 mb-2">Edit Course</h1>
        <p className="text-slate-500 text-sm mb-8">Manage your course content and settings</p>

        {/* Basic Information Section */}
        <div className="app-panel panel-strong rounded-3xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-teal-700" />
              Basic Information
            </h2>
            {editMode !== 'basic' ? (
              <button
                onClick={() => setEditMode('basic')}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs uppercase transition-all"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleSaveBasicInfo}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <Save className="w-4 h-4" />
                  Save
                </button>
                <button
                  onClick={() => {
                    setTitle(course.title);
                    setDescription(course.description);
                    setEditMode(null);
                  }}
                  className="px-4 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-xl font-bold text-xs uppercase transition-all"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          
          {editMode === 'basic' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-slate-500 text-sm font-bold mb-2">Course Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors"
                  placeholder="Enter course title"
                />
              </div>
              <div>
                <label className="block text-slate-500 text-sm font-bold mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors resize-none"
                  placeholder="Enter course description"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-slate-500 text-xs font-bold mb-1">TITLE</p>
                <p className="text-slate-900 font-semibold">{title || 'No title set'}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs font-bold mb-1">DESCRIPTION</p>
                <p className="text-slate-700 text-sm">{description || 'No description set'}</p>
              </div>
            </div>
          )}
        </div>

        {/* Video Section */}
        <div className="app-panel panel-strong rounded-3xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Video className="w-5 h-5 text-cyan-700" />
              Video Content
            </h2>
            <div className="flex gap-2">
              {videoUrl && editMode !== 'video-view' && editMode !== 'video-update' && (
                <button
                  onClick={() => setEditMode('video-view')}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <Eye className="w-4 h-4" />
                  View
                </button>
              )}
              {editMode !== 'video-update' && editMode !== 'video-view' && (
                <button
                  onClick={() => setEditMode('video-update')}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <Edit2 className="w-4 h-4" />
                  Update
                </button>
              )}
              {videoUrl && editMode !== 'video-view' && editMode !== 'video-update' && (
                <button
                  onClick={handleDeleteVideo}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
              {(editMode === 'video-view' || editMode === 'video-update') && (
                <button
                  onClick={() => {
                    setVideoUrl(course.video_url);
                    setEditMode(null);
                    setVideoUpdateMethod(null);
                    setNewVideoFile(null);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <X className="w-4 h-4" />
                  Close
                </button>
              )}
            </div>
          </div>
          
          {editMode === 'video-view' && videoUrl ? (
            <div className="space-y-4">
              <p className="text-slate-500 text-sm font-bold">VIDEO PREVIEW</p>
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  src={videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be') 
                    ? videoUrl.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')
                    : videoUrl}
                  className="absolute top-0 left-0 w-full h-full rounded-xl border border-slate-300"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <p className="text-slate-500 text-xs break-all">URL: {videoUrl}</p>
            </div>
          ) : editMode === 'video-update' ? (
            <div className="space-y-4">
              {!videoUpdateMethod ? (
                <div className="space-y-3">
                  <p className="text-slate-600 text-sm font-bold">Choose how to update the video:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setVideoUpdateMethod('link')}
                      className="p-4 bg-indigo-600/20 border border-indigo-500/50 hover:border-indigo-500 rounded-xl transition-all text-indigo-400 font-bold text-sm text-center"
                    >
                      🔗 Add Link
                    </button>
                    <button
                      onClick={() => setVideoUpdateMethod('upload')}
                      className="p-4 bg-cyan-600/20 border border-cyan-500/50 hover:border-cyan-500 rounded-xl transition-all text-cyan-400 font-bold text-sm text-center"
                    >
                      📤 Upload Video
                    </button>
                  </div>
                </div>
              ) : videoUpdateMethod === 'link' ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-slate-500 text-sm font-bold">Video URL Link</p>
                      <button
                        onClick={() => {
                          setVideoUpdateMethod(null);
                          setVideoUrl(course.video_url);
                        }}
                        className="text-slate-500 hover:text-slate-700 text-xs"
                      >
                        Change method
                      </button>
                    </div>
                    <input
                      type="text"
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 transition-colors"
                      placeholder="Enter video URL (YouTube, Vimeo, etc.)"
                    />
                    <p className="text-slate-500 text-xs mt-2">Supports YouTube, Vimeo, and direct video links</p>
                  </div>
                  <button
                    onClick={handleSaveVideo}
                    disabled={saving || !videoUrl.trim()}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase transition-all"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Video Link'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-slate-500 text-sm font-bold">Upload Video File</p>
                      <button
                        onClick={() => {
                          setVideoUpdateMethod(null);
                          setNewVideoFile(null);
                        }}
                        className="text-slate-500 hover:text-slate-700 text-xs"
                      >
                        Change method
                      </button>
                    </div>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(e) => setNewVideoFile(e.target.files[0])}
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-700 outline-none focus:border-cyan-500 transition-colors file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-600 file:text-white hover:file:bg-cyan-500"
                    />
                    {newVideoFile && (
                      <p className="text-green-400 text-sm mt-2 flex items-center gap-2">
                        ✓ Selected: {newVideoFile.name} ({(newVideoFile.size / 1024 / 1024).toFixed(2)} MB)
                      </p>
                    )}
                    <p className="text-slate-500 text-xs mt-2">Supported: MP4, WebM, OGG, and other video formats</p>
                  </div>
                  <button
                    onClick={handleSaveVideo}
                    disabled={saving || !newVideoFile}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase transition-all"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Upload & Save Video
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="text-slate-500 text-xs font-bold mb-2">CURRENT STATUS</p>
              {videoUrl ? (
                <p className="text-slate-900 font-semibold">✓ Video URL configured</p>
              ) : (
                <p className="text-slate-500">No video set - Click "Update" to add a video</p>
              )}
            </div>
          )}
        </div>

        {/* Materials Section */}
        <div className="app-panel panel-strong rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyan-700" />
              Course Materials & Assessments
            </h2>
            <div className="flex gap-2 flex-wrap">
              {material && editMode !== 'material-view' && editMode !== 'material-update' && editMode !== 'material-upload' && (
                <button
                  onClick={() => setEditMode('material-view')}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <Eye className="w-4 h-4" />
                  View
                </button>
              )}
              {editMode !== 'material-view' && editMode !== 'material-update' && editMode !== 'material-upload' && (
                <button
                  onClick={() => setEditMode('material-update')}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <Edit2 className="w-4 h-4" />
                  Update
                </button>
              )}
              {editMode !== 'material-view' && editMode !== 'material-update' && editMode !== 'material-upload' && (
                <button
                  onClick={() => setEditMode('material-upload')}
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <Upload className="w-4 h-4" />
                  Upload File
                </button>
              )}
              {material && editMode !== 'material-view' && editMode !== 'material-update' && editMode !== 'material-upload' && (
                <button
                  onClick={handleDeleteMaterial}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
              {(editMode === 'material-view' || editMode === 'material-update' || editMode === 'material-upload') && (
                <button
                  onClick={() => {
                    setMaterial(course.material);
                    setEditMode(null);
                    setUploadFile(null);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-xl font-bold text-xs uppercase transition-all"
                >
                  <X className="w-4 h-4" />
                  Close
                </button>
              )}
            </div>
          </div>
          
          {editMode === 'material-view' && material ? (
            <div className="space-y-4">
              <p className="text-slate-500 text-sm font-bold">MATERIALS PREVIEW</p>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <pre className="text-slate-700 text-xs overflow-x-auto max-h-96 whitespace-pre-wrap">
                  {material}
                </pre>
              </div>
              {(() => {
                try {
                  const parsed = JSON.parse(material);
                  return (
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                      <p className="text-slate-500 text-xs font-bold mb-2">STATISTICS</p>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-slate-500">Total Pages:</p>
                          <p className="text-slate-900 font-bold">{parsed.pages?.length || 0}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Has Assessments:</p>
                          <p className="text-slate-900 font-bold">{parsed.pages?.some(p => p.content?.assessment) ? 'Yes' : 'No'}</p>
                        </div>
                      </div>
                    </div>
                  );
                } catch {
                  return null;
                }
              })()}
            </div>
          ) : editMode === 'material-update' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-slate-500 text-sm font-bold mb-2">Materials (JSON format)</label>
                <textarea
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  rows={15}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 transition-colors resize-none font-mono text-sm"
                  placeholder='Enter course materials in JSON format...'
                />
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-slate-500 text-xs font-bold mb-2">FORMAT GUIDE:</p>
                <pre className="text-slate-700 text-xs overflow-x-auto">
{`{
  "pages": [
    {
      "title": "Page Title",
      "content": {
        "text": "Text content...",
        "assessment": {
          "quiz": {
            "question": "Question?",
            "choices": ["A", "B", "C", "D"],
            "correct": 0
          },
          "fillBlank": {
            "question": "Fill in: ____",
            "correct": "answer"
          }
        }
      }
    }
  ]
}`}
                </pre>
              </div>
              <button
                onClick={handleSaveMaterial}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase transition-all"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          ) : editMode === 'material-upload' ? (
            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                <p className="text-blue-700 text-sm font-bold mb-2">AI-Powered Material Generation</p>
                <p className="text-slate-600 text-xs">Upload a PDF, Word, or Text file and AI will automatically generate structured course materials with quizzes and assessments.</p>
              </div>
              
              <div>
                <label className="block text-slate-500 text-sm font-bold mb-3">Select File</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={(e) => setUploadFile(e.target.files[0])}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-700 outline-none focus:border-cyan-500 transition-colors file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-600 file:text-white hover:file:bg-cyan-500"
                />
                {uploadFile && (
                  <p className="text-green-400 text-sm mt-2 flex items-center gap-2">
                    ✓ Selected: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(2)} KB)
                  </p>
                )}
              </div>

              {isUploading && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Loader2 className="w-5 h-5 text-cyan-500 animate-spin" />
                    <p className="text-slate-900 font-bold">Processing...</p>
                  </div>
                  <p className="text-slate-500 text-sm">{uploadProgress}</p>
                </div>
              )}

              <button
                onClick={handleFileUpload}
                disabled={!uploadFile || isUploading}
                className="flex items-center gap-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-xs uppercase transition-all"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Generate Materials
                  </>
                )}
              </button>

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                <p className="text-yellow-700 text-xs font-bold mb-1">Note:</p>
                <p className="text-slate-600 text-xs">This will replace existing materials. Processing may take 1-2 minutes depending on file length.</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-slate-500 text-xs font-bold mb-2">CURRENT STATUS</p>
              {material ? (
                <p className="text-slate-900 font-semibold">✓ Course materials configured</p>
              ) : (
                <p className="text-slate-500">No materials set - Click "Update" to edit manually or "Upload File" to generate with AI</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
