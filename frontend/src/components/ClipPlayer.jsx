// frontend/src/components/ClipPlayer.jsx
import React, { useState, useRef, useEffect } from 'react';

export default function ClipPlayer({ clip, token, onPostSuccess }) {
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [postTitle, setPostTitle] = useState(clip.title);
  const [hashtags, setHashtags] = useState('#viral #autoclip #trending');
  const [posting, setPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState('');
  const [postError, setPostError] = useState('');

  // Extract transcript
  const transcript = Array.isArray(clip.transcriptJson) ? clip.transcriptJson : [];

  // Track playback time
  const handleTimeUpdate = (e) => {
    const time = e.target.currentTime;
    setCurrentTime(time);
    
    // Find active word
    const index = transcript.findIndex(
      (w) => time >= w.start && time <= w.end
    );
    setActiveWordIndex(index);
  };

  // Click word to jump video
  const handleWordClick = (startTime) => {
    if (videoRef.current) {
      videoRef.current.currentTime = startTime;
      videoRef.current.play();
    }
  };

  const handlePostTikTok = async (e) => {
    e.preventDefault();
    setPostError('');
    setPostSuccess('');
    setPosting(true);

    const hashtagArray = hashtags
      .split(' ')
      .map(t => t.replace('#', '').trim())
      .filter(t => t.length > 0);

    try {
      const response = await fetch('http://localhost:3000/api/post/tiktok', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          clipId: clip.id,
          title: postTitle,
          hashtags: hashtagArray,
          privacyLevel: 'PUBLIC_TO_EVERYONE'
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to post to TikTok.');
      }

      setPostSuccess('Successfully queued for auto-posting on TikTok! 🎉');
      if (onPostSuccess) onPostSuccess(clip.id);
    } catch (err) {
      setPostError(err.message || 'Direct posting error. Check TikTok OAuth status.');
    } finally {
      setPosting(false);
    }
  };

  // Sync title when active clip changes
  useEffect(() => {
    setPostTitle(clip.title);
    setPostSuccess('');
    setPostError('');
  }, [clip]);

  // Determine video URL
  const videoUrl = clip.finalVideoUrl || clip.rawVideoUrl;

  return (
    <div className="glass-panel p-6" style={{ marginTop: '32px', border: '1px solid var(--border-light)' }}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <span className="badge badge-success" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-purple)' }}>
            Active Session
          </span>
          <h3 style={{ fontSize: '22px', fontWeight: 800, marginTop: '8px', fontFamily: 'var(--font-display)' }}>
            {clip.title}
          </h3>
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Mode: <strong style={{ color: clip.finalVideoUrl ? 'var(--accent-teal)' : 'var(--accent-purple)' }}>
            {clip.finalVideoUrl ? '✨ Subtitles Embedded' : '🎬 Raw Vertical'}
          </strong>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* Left: 9:16 Video Player Container */}
        <div className="flex justify-center items-center" style={{ background: '#04030a', borderRadius: '12px', padding: '16px', border: '1px solid var(--border-light)' }}>
          {videoUrl ? (
            <video 
              ref={videoRef}
              src={videoUrl}
              controls
              onTimeUpdate={handleTimeUpdate}
              style={{
                maxHeight: '480px',
                borderRadius: '8px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                aspectRatio: '9/16'
              }}
            />
          ) : (
            <div style={{ padding: '60px', color: 'var(--text-muted)' }}>
              No media url loaded.
            </div>
          )}
        </div>

        {/* Right: Interactive Speech Transcript */}
        <div className="flex flex-col" style={{ minHeight: '400px', maxHeight: '512px' }}>
          <h4 style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '12px', fontWeight: 700 }}>
            🎙️ AI Interactive Word Transcript
          </h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Click on any word to jump playback directly to that speech timestamp!
          </p>

          <div 
            className="input-field flex-grow"
            style={{
              overflowY: 'auto',
              maxHeight: '260px',
              padding: '16px',
              borderRadius: '12px',
              lineHeight: 1.8,
              textAlign: 'left',
              display: 'block',
              whiteSpace: 'normal',
              background: 'rgba(10, 9, 20, 0.4)'
            }}
          >
            {transcript.length > 0 ? (
              transcript.map((w, index) => {
                const isActive = activeWordIndex === index;
                return (
                  <span 
                    key={index}
                    onClick={() => handleWordClick(w.start)}
                    style={{
                      display: 'inline-block',
                      marginRight: '6px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '15px',
                      fontWeight: isActive ? 700 : 400,
                      background: isActive ? 'var(--accent-purple)' : 'transparent',
                      color: isActive ? '#fff' : 'var(--text-primary)',
                      boxShadow: isActive ? 'var(--shadow-glow)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                    title={`${w.start}s - ${w.end}s`}
                  >
                    {w.word}
                  </span>
                );
              })
            ) : (
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No word timestamps available for this segment.
              </span>
            )}
          </div>

          {/* Direct Posting to TikTok Container */}
          <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-light)', paddingTop: '20px' }}>
            <h4 style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '12px', fontWeight: 700 }}>
              🚀 Publish directly to TikTok
            </h4>

            {postSuccess && (
              <div className="badge-success w-full text-center" style={{ padding: '8px', fontSize: '12px', borderRadius: '6px', marginBottom: '12px', textTransform: 'none', display: 'block' }}>
                {postSuccess}
              </div>
            )}
            {postError && (
              <div className="badge-failed w-full text-center" style={{ padding: '8px', fontSize: '12px', borderRadius: '6px', marginBottom: '12px', textTransform: 'none', display: 'block' }}>
                ⚠️ {postError}
              </div>
            )}

            <form onSubmit={handlePostTikTok} className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-4">
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Post title" 
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                  disabled={posting || !clip.finalVideoKey}
                  required
                />
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Hashtags" 
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                  disabled={posting || !clip.finalVideoKey}
                />
              </div>

              <button 
                type="submit" 
                className="btn btn-primary w-full mt-2" 
                style={{ padding: '10px', fontSize: '14px' }}
                disabled={posting || !clip.finalVideoKey}
              >
                {posting ? (
                  <>
                    <span className="spin" style={{ display: 'inline-block' }}>⚡</span>
                    Publishing...
                  </>
                ) : clip.finalVideoKey ? (
                  '🚀 Post Direct to TikTok'
                ) : (
                  '🔒 Burn Captions First to Enable Direct Post'
                )}
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
