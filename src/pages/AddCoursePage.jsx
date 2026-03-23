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
    <div className="min-h-screen bg-slate-50 p-5 md:p-8 page-enter">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate('/admin')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium text-sm mb-6 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Create New Course</h1>
            <p className="text-slate-500 text-sm">Fill in the details to add a new course</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-600 text-sm font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Course Title <span className="text-red-500">*</span></label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="e.g., Introduction to Machine Learning"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm"
              />
            </div>

            {/* Description with AI */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700">Course Description <span className="text-red-500">*</span></label>
                <button
                  type="button"
                  onClick={handleGenerateDescription}
                  disabled={isLoading || !formData.title.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-600 rounded-lg font-medium text-xs transition-all"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Generate with AI
                </button>
              </div>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Describe what students will learn in this course..."
                rows="4"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all placeholder-slate-400 text-sm resize-none"
              />
            </div>

            {/* Video Section */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">
                Video Content <span className="text-slate-400 font-normal">(Optional)</span>
              </h3>
              
              {!videoMethod ? (
                <div className="space-y-3">
                  <p className="text-slate-500 text-sm">Choose how to add video:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setVideoMethod('link')}
                      className="p-4 bg-white border border-slate-200 hover:border-teal-300 hover:bg-teal-50/50 rounded-xl transition-all text-slate-700 text-sm font-medium text-center"
                    >
                      <Link2 className="w-5 h-5 mx-auto mb-2 text-slate-400" />
                      Paste Link
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoMethod('upload')}
                      className="p-4 bg-white border border-slate-200 hover:border-teal-300 hover:bg-teal-50/50 rounded-xl transition-all text-slate-700 text-sm font-medium text-center"
                    >
                      <Upload className="w-5 h-5 mx-auto mb-2 text-slate-400" />
                      Upload File
                    </button>
                  </div>
                </div>
              ) : videoMethod === 'link' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Video URL</label>
                    <input
                      type="text"
                      value={formData.videoUrl}
                      onChange={(e) => setFormData(prev => ({ ...prev, videoUrl: e.target.value }))}
                      placeholder="https://youtube.com/watch?v=..."
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all text-sm"
                    />
                    <p className="text-slate-400 text-xs mt-1.5">YouTube, Vimeo, or direct video links</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoMethod(null);
                      setFormData(prev => ({ ...prev, videoUrl: '' }));
                    }}
                    className="text-slate-500 hover:text-slate-700 text-sm font-medium"
                  >
                    ← Change method
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Upload Video File</label>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(e) => setVideoFile(e.target.files[0])}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-700 outline-none focus:border-teal-500 transition-colors text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-white"
                    />
                    {videoFile && <p className="text-emerald-600 text-sm mt-2">Selected: {videoFile.name}</p>}
                  </div>
                  {videoFile && (
                    <button
                      type="button"
                      onClick={handleUploadVideo}
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-all"
                    >
                      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {isLoading ? 'Uploading...' : 'Upload Video'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setVideoMethod(null);
                      setVideoFile(null);
                    }}
                    className="text-slate-500 hover:text-slate-700 text-sm font-medium"
                  >
                    ← Change method
                  </button>
                </div>
              )}
              {formData.videoUrl && <p className="text-emerald-600 text-sm mt-3 font-medium">Video added successfully</p>}
            </div>

            {/* Materials Section */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">
                Course Materials <span className="text-slate-400 font-normal">(Optional)</span>
              </h3>
              
              <div className="space-y-3">
                <p className="text-slate-500 text-sm">Upload a document for AI to generate course content:</p>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={(e) => setMaterialFile(e.target.files[0])}
                  disabled={isMaterialUploading}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-700 outline-none focus:border-teal-500 transition-colors text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-white disabled:opacity-50"
                />
                {materialFile && (
                  <p className="text-emerald-600 text-sm">Selected: {materialFile.name}</p>
                )}

                {isMaterialUploading && (
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />
                      <p className="text-slate-700 text-sm font-medium">Processing...</p>
                    </div>
                    <p className="text-slate-500 text-sm">{materialProgress}</p>
                  </div>
                )}

                {materialFile && !isMaterialUploading && (
                  <button
                    type="button"
                    onClick={handleUploadMaterial}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-all"
                  >
                    <Wand2 className="w-4 h-4" />
                    Generate with AI
                  </button>
                )}

                {formData.material && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    <p className="text-emerald-700 text-sm font-medium">
                      Materials generated ({JSON.parse(formData.material).pages?.length || 0} pages)
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => navigate('/admin')}
                disabled={isLoading || isMaterialUploading}
                className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-semibold text-sm rounded-xl py-3 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || isMaterialUploading || !formData.title.trim() || !formData.description.trim()}
                className="flex-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl py-3 flex items-center justify-center gap-2 transition-all"
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
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
