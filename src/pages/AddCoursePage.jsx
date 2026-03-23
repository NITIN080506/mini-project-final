import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { extractTextFromDocument, splitTextIntoPages, GROQ_API_KEY, GROQ_MODEL } from '../utils/helpers';
import { ArrowLeft, BookOpen, Loader2, AlertCircle, Wand2, Link2, Upload } from 'lucide-react';

export default function AddCoursePage() {
  const navigate = useNavigate();
  const { supabase, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    videoUrl: '',
    material: '',
  });

  // Video section states
  const [videoMethod, setVideoMethod] = useState(null); // 'link' or 'upload'
  const [videoFile, setVideoFile] = useState(null);

  // Material upload state
  const [materialFile, setMaterialFile] = useState(null);
  const [isMaterialUploading, setIsMaterialUploading] = useState(false);
  const [materialProgress, setMaterialProgress] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleGenerateDescription = async () => {
    if (!formData.title.trim()) {
      setError('Please enter a course title first');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const prompt = `Generate a professional and engaging course description for a course titled "${formData.title}". 
The description should be 2-3 sentences, highlight key learning outcomes, and be suitable for an educational platform.`;

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
          max_tokens: 300,
        }),
      });

      if (!response.ok) throw new Error('AI generation failed');

      const data = await response.json();
      const generatedDescription = data.choices[0].message.content.trim();
      setFormData(prev => ({ ...prev, description: generatedDescription }));
    } catch (err) {
      setError('Error generating description: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadVideo = async () => {
    if (!videoFile) {
      setError('Please select a video file');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const fileExt = videoFile.name.split('.').pop();
      const fileName = `course-video-${Date.now()}.${fileExt}`;
      
      const { data, error: uploadError } = await supabase
        .storage
        .from('videos')
        .upload(fileName, videoFile);

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase
        .storage
        .from('videos')
        .getPublicUrl(fileName);

      setFormData(prev => ({ ...prev, videoUrl: publicData.publicUrl }));
      setVideoFile(null);
      setVideoMethod(null);
    } catch (err) {
      setError('Error uploading video: ' + err.message);
    } finally {
      setIsLoading(false);
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
      
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

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

  const handleUploadMaterial = async () => {
    if (!materialFile) {
      setError('Please select a file');
      return;
    }

    setIsMaterialUploading(true);
    setMaterialProgress('Extracting text from document...');
    setError(null);

    try {
      const docText = await extractTextFromDocument(materialFile);
      if (!docText || docText.trim().length < 50) {
        throw new Error('No readable text found in the document');
      }

      setMaterialProgress('Generating course materials with AI...');
      const pageTexts = splitTextIntoPages(docText, 220);
      const pages = [];

      for (let i = 0; i < Math.min(pageTexts.length, 20); i++) {
        setMaterialProgress(`Processing page ${i + 1} of ${Math.min(pageTexts.length, 20)}...`);
        const pageData = await generatePageWithAI(pageTexts[i], i + 1);
        pages.push(pageData);
      }

      const materialJson = JSON.stringify({ pages }, null, 2);
      setFormData(prev => ({ ...prev, material: materialJson }));
      setMaterialFile(null);
    } catch (err) {
      setError('Error processing file: ' + err.message);
    } finally {
      setIsMaterialUploading(false);
      setMaterialProgress('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!formData.title.trim()) {
      setError('Course title is required');
      return;
    }

    if (!formData.description.trim()) {
      setError('Course description is required');
      return;
    }

    setIsLoading(true);
    try {
      const { error: insertError } = await supabase.from('courses').insert([
        {
          title: formData.title,
          description: formData.description,
          video_url: formData.videoUrl,
          material: formData.material || '',
          created_by: user.id,
        },
      ]);

      if (insertError) throw insertError;
      navigate('/admin');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-shell soft-grid min-h-screen p-6 md:p-8 page-enter">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate('/admin')}
          className="flex items-center gap-2 text-teal-700 hover:text-teal-600 font-bold text-sm uppercase mb-8 transition-all hover:-translate-x-0.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Courses
        </button>

        <div className="app-panel panel-strong rounded-3xl p-7 md:p-12">
          <div className="flex items-center gap-4 mb-10 animate-stagger">
            <div className="bg-teal-100 p-3 rounded-2xl">
              <BookOpen className="w-8 h-8 text-teal-700" />
            </div>
            <div>
              <h1 className="text-4xl font-black text-slate-900 italic">CREATE COURSE</h1>
              <p className="text-slate-500 text-sm uppercase tracking-widest font-bold">Add a new course</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 text-sm font-semibold">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6 animate-stagger">
            {/* Title */}
            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-3 tracking-widest">Course Title *</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="Enter course title"
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm"
              />
            </div>

            {/* Description with AI */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-black uppercase text-slate-500 tracking-widest">Course Description *</label>
                <button
                  type="button"
                  onClick={handleGenerateDescription}
                  disabled={isLoading || !formData.title.trim()}
                  className="flex items-center gap-1 px-3 py-1 bg-cyan-50 hover:bg-cyan-100 disabled:opacity-50 border border-cyan-200 hover:border-cyan-400 text-cyan-700 rounded-lg font-bold text-xs transition-all"
                >
                  <Wand2 className="w-3 h-3" />
                  AI Describe
                </button>
              </div>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Enter course description or click 'AI Describe' to auto-generate"
                rows="4"
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors placeholder-slate-400 text-sm resize-none"
              />
            </div>

            {/* Video Section */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 hover-lift">
              <h3 className="text-sm font-black text-slate-900 mb-4 flex items-center gap-2">
                Video Content (Optional)
              </h3>
              
              {!videoMethod ? (
                <div className="space-y-3">
                  <p className="text-slate-500 text-xs font-bold">Choose how to add video:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setVideoMethod('link')}
                      className="p-3 bg-teal-50 border border-teal-200 hover:border-teal-400 rounded-xl transition-all text-teal-700 font-bold text-xs text-center hover:-translate-y-0.5"
                    >
                      <Link2 className="w-4 h-4 mx-auto mb-1" />
                      Video Link
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoMethod('upload')}
                      className="p-3 bg-cyan-50 border border-cyan-200 hover:border-cyan-400 rounded-xl transition-all text-cyan-700 font-bold text-xs text-center hover:-translate-y-0.5"
                    >
                      <Upload className="w-4 h-4 mx-auto mb-1" />
                      Upload File
                    </button>
                  </div>
                </div>
              ) : videoMethod === 'link' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">Video URL</label>
                    <input
                      type="text"
                      value={formData.videoUrl}
                      onChange={(e) => setFormData(prev => ({ ...prev, videoUrl: e.target.value }))}
                      placeholder="https://youtube.com/..."
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-colors text-sm"
                    />
                    <p className="text-slate-500 text-xs mt-1">YouTube, Vimeo, or direct video links</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoMethod(null);
                      setFormData(prev => ({ ...prev, videoUrl: '' }));
                    }}
                    className="text-slate-500 hover:text-slate-700 text-xs font-bold"
                  >
                    ← Change method
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">Upload Video File</label>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(e) => setVideoFile(e.target.files[0])}
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-700 outline-none focus:border-cyan-500 transition-colors text-xs file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-cyan-600 file:text-white"
                    />
                    {videoFile && <p className="text-green-400 text-xs mt-2">✓ {videoFile.name}</p>}
                  </div>
                  {videoFile && (
                    <button
                      type="button"
                      onClick={handleUploadVideo}
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase transition-all"
                    >
                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      {isLoading ? 'Uploading...' : 'Upload Video'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setVideoMethod(null);
                      setVideoFile(null);
                    }}
                    className="text-slate-500 hover:text-slate-700 text-xs font-bold"
                  >
                    ← Change method
                  </button>
                </div>
              )}
              {formData.videoUrl && <p className="text-green-600 text-xs mt-3 flex items-center gap-1">✓ Video added</p>}
            </div>

            {/* Materials Section */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 hover-lift">
              <h3 className="text-sm font-black text-slate-900 mb-4 flex items-center gap-2">
                Course Materials (Optional)
              </h3>
              
              <div className="space-y-3">
                <p className="text-slate-500 text-xs font-bold">Upload PDF, Word, or Text file for AI to generate course content:</p>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={(e) => setMaterialFile(e.target.files[0])}
                  disabled={isMaterialUploading}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-700 outline-none focus:border-cyan-500 transition-colors text-xs file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-cyan-600 file:text-white disabled:opacity-50"
                />
                {materialFile && (
                  <p className="text-green-600 text-xs">✓ Selected: {materialFile.name}</p>
                )}

                {isMaterialUploading && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Loader2 className="w-4 h-4 text-cyan-700 animate-spin" />
                      <p className="text-slate-800 text-xs font-bold">Processing...</p>
                    </div>
                    <p className="text-slate-500 text-xs">{materialProgress}</p>
                  </div>
                )}

                {materialFile && !isMaterialUploading && (
                  <button
                    type="button"
                    onClick={handleUploadMaterial}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-cyan-700 hover:bg-cyan-600 text-white rounded-xl font-bold text-xs uppercase transition-all"
                  >
                    <Upload className="w-3 h-3" />
                    Generate Materials with AI
                  </button>
                )}

                {formData.material && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3">
                    <p className="text-green-400 text-xs font-bold flex items-center gap-2">
                      ✓ Materials generated! ({JSON.parse(formData.material).pages?.length || 0} pages)
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={isLoading || isMaterialUploading || !formData.title.trim() || !formData.description.trim()}
                className="flex-1 bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50 text-white font-black text-sm rounded-xl py-3 uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg transition-all hover:-translate-y-0.5"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Course'
                )}
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin')}
                disabled={isLoading || isMaterialUploading}
                className="flex-1 bg-white border border-slate-300 hover:border-slate-400 disabled:opacity-50 text-slate-700 font-black text-sm rounded-xl py-3 uppercase tracking-widest transition-all hover:-translate-y-0.5"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
